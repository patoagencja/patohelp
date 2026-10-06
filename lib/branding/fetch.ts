import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

import { safeLogoUrl } from "@/lib/dashboard/branding";

import {
  COLOR_RANK,
  RANK,
  parseBrandingHtml,
  parseManifest,
  sortColors,
  sortLogos,
  type ColorCandidate,
  type ColorSource,
  type Confidence,
  type LogoCandidate,
  type LogoKind,
} from "./parse";
import { URL_PROBLEM_MESSAGE, parseWebsiteUrl, urlProblem } from "./website";

// "Pobierz branding ze strony klienta": fetch a client's public homepage and
// find their logo + brand colour. SERVER ONLY, and only ever from an agency
// Server Action (settings preview, the bulk button on /clients) - never on
// page load: it hits a third-party site and can take seconds.
//
// The URL is typed by a user, so this is an SSRF surface. Defences:
// - http/https only, default ports, no credentials, no IP literals;
// - every DNS answer is checked against private/reserved ranges INSIDE the
//   socket's lookup hook, so the address we vet is the one we connect to
//   (no DNS-rebinding gap between "check" and "fetch");
// - redirects are followed by hand (max 3), each hop re-validated;
// - 8 s budget per fetch (AbortController), 1.5 MB body cap after
//   decompression, fresh socket per request (no keep-alive reuse).

export const BOT_USER_AGENT = "PatoDashboardBot/1.0 (+https://patoagencja.com)";
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_REDIRECTS = 3;
export const MAX_PREVIEW_LOGOS = 4;
// Image checks run in parallel; this bounds the fan-out per site.
const MAX_LOGO_CHECKS = 6;

export type BrandingErrorCode =
  | "invalid_url"
  | "blocked_host"
  | "dns"
  | "timeout"
  | "too_many_redirects"
  | "http_error"
  | "not_html"
  | "tls"
  | "network";

export class BrandingFetchError extends Error {
  constructor(
    public readonly code: BrandingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BrandingFetchError";
  }
}

const MESSAGES: Record<Exclude<BrandingErrorCode, "invalid_url" | "http_error">, string> = {
  blocked_host: "Ten adres prowadzi do sieci wewnętrznej - nie pobieramy z niego danych.",
  dns: "Nie znaleziono takiej domeny - sprawdź adres strony.",
  timeout: `Strona nie odpowiedziała w ${FETCH_TIMEOUT_MS / 1000} s.`,
  too_many_redirects: `Strona przekierowuje zbyt wiele razy (limit ${MAX_REDIRECTS}).`,
  not_html: "Pod tym adresem nie ma strony HTML.",
  tls: "Strona ma nieprawidłowy certyfikat SSL - nie da się jej bezpiecznie pobrać.",
  network: "Nie udało się połączyć ze stroną.",
};

function fail(code: Exclude<BrandingErrorCode, "invalid_url" | "http_error">): never {
  throw new BrandingFetchError(code, MESSAGES[code]);
}

// ---------------------------------------------------------------------------
// Address checks

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isPrivateIPv4(ip: string): boolean {
  const o = parseIPv4(ip);
  if (!o) return true; // unparsable: refuse rather than guess
  const [a, b, c] = o;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** "::ffff:10.0.0.1" / "fe80::1%eth0" -> eight 16-bit groups, or null. */
function parseIPv6(input: string): number[] | null {
  let ip = input.toLowerCase().split("%")[0];
  // Embedded IPv4 tail -> two hex groups.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) {
    const o = parseIPv4(v4[1]);
    if (!o) return null;
    ip = ip.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true;
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return true; // ::
  if (zeros(0, 7) && g[7] === 1) return true; // ::1
  if (zeros(0, 5) && g[5] === 0xffff) return isPrivateIPv4(v4FromGroups(g[6], g[7])); // IPv4-mapped
  if (zeros(0, 6)) return isPrivateIPv4(v4FromGroups(g[6], g[7])); // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPrivateIPv4(v4FromGroups(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateIPv4(v4FromGroups(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo - embeds arbitrary IPv4
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  // Everything outside global unicast 2000::/3: ULA fc00::/7, link-local
  // fe80::/10, multicast ff00::/8, 64:ff9b:1::/48, 100::/64 discard...
  return (g[0] & 0xe000) !== 0x2000;
}

/** True for any address a public website must not resolve to. */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

class BlockedAddressError extends Error {
  code = "EBLOCKED";
}

/**
 * dns.lookup that refuses to hand the socket a private address. Node calls
 * it with `all: true` when happy-eyeballs (autoSelectFamily) is on, so both
 * callback shapes are supported. Any private answer fails the whole lookup:
 * a host that resolves to 10.0.0.5 AND a public IP is not a public site.
 */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family, hints: options.hints }, (err, addresses) => {
    if (err) return callback(err, "");
    if (!addresses.length) {
      return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
    }
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(new BlockedAddressError(`Blocked private address for ${hostname}`), "");
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

function assertFetchableUrl(url: URL): void {
  const problem = urlProblem(url);
  if (!problem) return;
  if (problem === "ip" || problem === "internal") fail("blocked_host");
  throw new BrandingFetchError("invalid_url", URL_PROBLEM_MESSAGE[problem]);
}

// ---------------------------------------------------------------------------
// HTTP

interface SafeGetOptions {
  accept: string;
  maxBytes: number;
  /** Resolve as soon as headers arrive (image checks). */
  headersOnly?: boolean;
}

export interface SafeResponse {
  status: number;
  contentType: string;
  body: Buffer;
  truncated: boolean;
  finalUrl: URL;
}

interface HopResult {
  status: number;
  contentType: string;
  location: string | null;
  body: Buffer;
  truncated: boolean;
}

function networkError(err: unknown): BrandingFetchError {
  if (err instanceof BrandingFetchError) return err;
  const code = String((err as { code?: unknown })?.code ?? "");
  if (code === "EBLOCKED") return new BrandingFetchError("blocked_host", MESSAGES.blocked_host);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") return new BrandingFetchError("dns", MESSAGES.dns);
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH/i.test(code)) {
    return new BrandingFetchError("tls", MESSAGES.tls);
  }
  return new BrandingFetchError("network", MESSAGES.network);
}

function requestOnce(url: URL, opts: SafeGetOptions, signal: AbortSignal): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": BOT_USER_AGENT,
          Accept: opts.accept,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "pl,en;q=0.8",
        },
        lookup: safeLookup,
        // A pooled keep-alive socket could skip our lookup for a host that
        // was vetted earlier; a fresh connection always goes through it.
        agent: false,
        signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const isRedirect = status >= 300 && status < 400 && status !== 304 && location !== null;

        if (isRedirect || opts.headersOnly || opts.maxBytes <= 0) {
          res.destroy();
          resolve({ status, contentType, location: isRedirect ? location : null, body: Buffer.alloc(0), truncated: false });
          return;
        }

        const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
        let stream: Readable = res;
        if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());

        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = (truncated: boolean) => {
          if (done) return;
          done = true;
          if (stream !== res) stream.destroy();
          res.destroy();
          resolve({ status, contentType, location: null, body: Buffer.concat(chunks), truncated });
        };
        const onError = (err: unknown) => {
          if (done) return;
          // Cut off mid-body (timeout, reset, truncated gzip): the <head> and
          // header we need are usually already in what arrived.
          if (size > 0) finish(true);
          else {
            done = true;
            res.destroy();
            reject(networkError(err));
          }
        };
        // Count DECOMPRESSED bytes, so a gzip bomb stops at the cap too.
        stream.on("data", (chunk: Buffer) => {
          if (done) return;
          const room = opts.maxBytes - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            size += room;
            finish(true);
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on("end", () => finish(false));
        stream.on("error", onError);
        if (stream !== res) res.on("error", onError);
        res.on("aborted", () => onError(new Error("aborted")));
      }
    );
    req.on("error", (err) => reject(networkError(err)));
    req.end();
  });
}

/**
 * GET with the SSRF rules above. Redirects are followed manually; each hop
 * is re-validated and goes through the private-address lookup again.
 */
export async function safeGet(start: URL, opts: SafeGetOptions): Promise<SafeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let url = start;
    for (let hop = 0; ; hop++) {
      assertFetchableUrl(url);
      const res = await requestOnce(url, opts, controller.signal);
      if (res.location === null) {
        return { status: res.status, contentType: res.contentType, body: res.body, truncated: res.truncated, finalUrl: url };
      }
      if (hop >= MAX_REDIRECTS) fail("too_many_redirects");
      let next: URL;
      try {
        next = new URL(res.location, url);
      } catch {
        fail("network");
      }
      next.hash = "";
      url = next;
    }
  } catch (err) {
    if (controller.signal.aborted) fail("timeout");
    throw networkError(err);
  } finally {
    clearTimeout(timer);
  }
}

/** Bytes -> text, honouring the declared charset (Polish sites still ship
 *  iso-8859-2 / windows-1250 now and then). */
function decodeBody(body: Buffer, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = body.subarray(0, 4096).toString("latin1");
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

// ---------------------------------------------------------------------------
// Orchestration

export interface BrandingFromWebsite {
  logoUrl: string | null;
  logoKind: LogoKind | null;
  logoConfidence: Confidence | null;
  brandColor: string | null;
  colorSource: ColorSource | null;
  siteName: string | null;
  finalUrl: string;
  /** Polish, for the person reviewing the result. */
  notes: string[];
  /** Up to 4 verified, https logo options (best first) for the preview. */
  logoCandidates: LogoCandidate[];
  colorCandidates: ColorCandidate[];
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svgz?|ico)$/i;
const DOWNGRADE: Record<Confidence, Confidence> = { high: "medium", medium: "low", low: "low" };

type ImageCheck = "ok" | "missing" | "unknown";

async function checkImage(url: URL): Promise<ImageCheck> {
  try {
    const res = await safeGet(url, {
      accept: "image/avif,image/webp,image/svg+xml,image/png,image/*;q=0.8,*/*;q=0.5",
      maxBytes: 0,
      headersOnly: true,
    });
    if (res.status === 200) {
      if (res.contentType.startsWith("image/")) return "ok";
      // Soft-404s come back as 200 text/html.
      if (/html|json|text\/plain/.test(res.contentType)) return "missing";
      return IMAGE_EXT_RE.test(res.finalUrl.pathname) ? "ok" : "unknown";
    }
    if (res.status === 404 || res.status === 410) return "missing";
    return "unknown"; // 403 bot walls, 429, 5xx - can't tell
  } catch (err) {
    // A logo on an internal host is never OK to suggest; network trouble
    // just means "couldn't check".
    if (err instanceof BrandingFetchError && (err.code === "blocked_host" || err.code === "dns" || err.code === "invalid_url")) {
      return "missing";
    }
    return "unknown";
  }
}

/**
 * Turn raw candidates into at most 4 https URLs that actually serve an
 * image. logo_url must be https (DB check), so an http-only logo gets one
 * try at its https twin and is dropped (with a note) if that fails.
 */
async function verifyLogos(candidates: LogoCandidate[], notes: string[]): Promise<LogoCandidate[]> {
  let httpOnly = 0;
  let unchecked = 0;
  const checkBatch = (batch: LogoCandidate[]) =>
    Promise.all(
    batch.map(async (c): Promise<LogoCandidate | null> => {
      const url = new URL(c.url);
      if (url.protocol === "http:") {
        const upgraded = new URL(c.url);
        upgraded.protocol = "https:";
        const res = await checkImage(upgraded);
        const safe = safeLogoUrl(upgraded.toString());
        if (res !== "ok" || !safe) {
          httpOnly++;
          return null;
        }
        return { ...c, url: safe };
      }
      const safe = safeLogoUrl(c.url);
      if (!safe) return null; // > 500 chars or odd shape
      const res = await checkImage(url);
      if (res === "missing") return null;
      if (res === "unknown") {
        unchecked++;
        return { ...c, url: safe, confidence: DOWNGRADE[c.confidence] };
      }
      return { ...c, url: safe };
    })
  );
  const isCandidate = (c: LogoCandidate | null): c is LogoCandidate => c !== null;
  let ok = (await checkBatch(candidates.slice(0, MAX_LOGO_CHECKS))).filter(isCandidate);
  // Everything in the first batch was dead: one more batch, then give up.
  if (ok.length === 0 && candidates.length > MAX_LOGO_CHECKS) {
    ok = (await checkBatch(candidates.slice(MAX_LOGO_CHECKS, MAX_LOGO_CHECKS * 2))).filter(isCandidate);
  }
  if (httpOnly > 0) {
    notes.push(
      httpOnly === 1
        ? "Jedna grafika jest dostępna tylko przez http - pominięta (panel wymaga https)."
        : `${httpOnly} grafiki są dostępne tylko przez http - pominięte (panel wymaga https).`
    );
  }
  if (unchecked > 0) {
    notes.push("Nie udało się sprawdzić części grafik (strona blokuje boty) - obejrzyj podgląd przed zapisem.");
  }
  return ok.slice(0, MAX_PREVIEW_LOGOS);
}

async function fetchManifest(manifestUrl: string) {
  try {
    const res = await safeGet(new URL(manifestUrl), {
      accept: "application/manifest+json,application/json;q=0.9,*/*;q=0.5",
      maxBytes: MAX_MANIFEST_BYTES,
    });
    if (res.status !== 200 || res.truncated) return null;
    return parseManifest(JSON.parse(decodeBody(res.body, res.contentType)), res.finalUrl.toString());
  } catch {
    return null; // a broken manifest just means fewer candidates
  }
}

async function fetchHtml(url: URL): Promise<{ html: string; finalUrl: URL }> {
  const res = await safeGet(url, {
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    maxBytes: MAX_PAGE_BYTES,
  });
  if (res.status >= 400) {
    throw new BrandingFetchError(
      "http_error",
      res.status === 403 || res.status === 429
        ? `Strona zablokowała pobieranie (błąd ${res.status}) - wklej logo i kolor ręcznie.`
        : `Strona zwróciła błąd ${res.status}.`
    );
  }
  const html = decodeBody(res.body, res.contentType);
  const looksHtml = /html|xml/.test(res.contentType) || (!res.contentType && /^\s*</.test(html));
  if (!looksHtml) fail("not_html");
  return { html, finalUrl: res.finalUrl };
}

/**
 * Fetch `rawUrl` and propose a logo and brand colour. Throws
 * BrandingFetchError (with a Polish message) when the page itself can't be
 * fetched; anything optional (manifest, image checks) degrades into notes.
 */
export async function fetchBrandingFromWebsite(rawUrl: string): Promise<BrandingFromWebsite> {
  const parsedUrl = parseWebsiteUrl(rawUrl);
  if (!parsedUrl.ok) {
    if (parsedUrl.problem === "ip" || parsedUrl.problem === "internal") fail("blocked_host");
    throw new BrandingFetchError("invalid_url", URL_PROBLEM_MESSAGE[parsedUrl.problem]);
  }
  const startUrl = new URL(parsedUrl.url);
  const notes: string[] = [];

  let { html, finalUrl } = await fetchHtml(startUrl);
  let parsed = parseBrandingHtml(html, finalUrl.toString());

  // Splash / language-picker pages that bounce via <meta http-equiv=refresh>:
  // follow once when the page itself offers nothing.
  if (parsed.metaRefreshUrl && parsed.logos.length === 0) {
    try {
      ({ html, finalUrl } = await fetchHtml(new URL(parsed.metaRefreshUrl)));
      parsed = parseBrandingHtml(html, finalUrl.toString());
    } catch {
      // keep the first page's (empty) result
    }
  }

  if (finalUrl.hostname.replace(/^www\./, "") !== startUrl.hostname.replace(/^www\./, "")) {
    notes.push(`Strona przekierowała na ${finalUrl.hostname}.`);
  }

  const logos = [...parsed.logos];
  const colors = [...parsed.colors];
  let siteName = parsed.siteName;

  const manifest = parsed.manifestUrl ? await fetchManifest(parsed.manifestUrl) : null;
  if (manifest) {
    if (manifest.icon && !logos.some((l) => l.url === manifest.icon?.url)) logos.push(manifest.icon);
    for (const c of manifest.colors) if (!colors.some((x) => x.color === c.color)) colors.push(c);
    siteName ??= manifest.name;
  }

  // /favicon.ico is the browser's own last resort - ours too.
  if (!logos.some((l) => l.kind === "favicon")) {
    logos.push({
      url: new URL("/favicon.ico", finalUrl).toString(),
      kind: "favicon",
      confidence: "low",
      rank: RANK.favicon,
      label: "Favicon (mała ikona z karty przeglądarki)",
    });
  }
  sortLogos(logos);
  sortColors(colors);

  const verified = await verifyLogos(logos, notes);
  const top = verified[0] ?? null;
  const color = colors[0] ?? null;

  if (!top) notes.push("Nie znaleziono logo - wklej link ręcznie.");
  else {
    if (parsed.inlineSvgLogo && top.kind !== "logo") {
      notes.push(
        "Logo w nagłówku jest wstawione w kod strony (SVG) i nie ma własnego linku - proponujemy ikonę. Najlepiej wgraj plik logo i wklej link."
      );
    }
    if (top.kind === "og") {
      notes.push("Znaleźliśmy tylko obrazek do udostępniania (og:image) - to często baner, a nie logo. Sprawdź podgląd.");
    } else if (top.kind === "favicon") {
      notes.push("Znaleźliśmy tylko favicon - jest mały, w panelu może wyglądać nieostro.");
    }
  }
  if (!color) notes.push("Nie znaleziono koloru marki - wybierz go ręcznie.");
  else if (color.rank >= COLOR_RANK.cssVariable) {
    notes.push("Kolor pochodzi ze zmiennych CSS motywu - sprawdź, czy to na pewno kolor marki.");
  }

  return {
    logoUrl: top?.url ?? null,
    logoKind: top?.kind ?? null,
    logoConfidence: top?.confidence ?? null,
    brandColor: color?.color ?? null,
    colorSource: color?.source ?? null,
    siteName: siteName?.trim() || null,
    finalUrl: finalUrl.toString(),
    notes,
    logoCandidates: verified,
    colorCandidates: colors.slice(0, 4),
  };
}
