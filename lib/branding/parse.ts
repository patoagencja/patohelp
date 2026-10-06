// Pure HTML / web-manifest parsing for "Pobierz branding ze strony klienta".
// No network and no Node APIs here - lib/branding/fetch.ts does the I/O - so
// the heuristics can be tested against saved HTML fixtures.
//
// We deliberately don't pull in an HTML parser (cheerio etc.): we only need
// tags + attributes + the element stack (to know "this <img> sits in the
// header, inside a link to the home page"), which a small tokenizer gives us.

export type LogoKind = "logo" | "icon" | "og" | "favicon";
export type Confidence = "high" | "medium" | "low";
export type ColorSource =
  | "theme-color"
  | "manifest"
  | "mask-icon"
  | "tile-color"
  | "svg-logo"
  | "css-variable";

export interface LogoCandidate {
  url: string;
  kind: LogoKind;
  confidence: Confidence;
  /** Polish, shown in the settings preview. */
  label: string;
  /** Largest declared edge in px, when the page states it. */
  size?: number;
  /** Lower = preferred. Internal ordering key (spec priority list). */
  rank: number;
}

export interface ColorCandidate {
  color: string; // #rrggbb, lower-case
  source: ColorSource;
  /** Polish, shown in the settings preview. */
  label: string;
  rank: number;
}

export interface ParsedPage {
  /** Ordered by preference; URLs absolute (http or https), not yet verified. */
  logos: LogoCandidate[];
  colors: ColorCandidate[];
  siteName: string | null;
  manifestUrl: string | null;
  /** The header logo is an inline <svg> - there is no URL to store. */
  inlineSvgLogo: boolean;
  /** Page asks to be refreshed to another URL (splash / language pages). */
  metaRefreshUrl: string | null;
}

// Ranks follow the agreed priority: header logo > icon SVG > apple-touch-icon
// > manifest icon > og:image > favicon. JSON-LD (schema.org Organization.logo)
// is an explicit "this is our logo" from the site, so it sits right after
// <img> logos.
export const RANK = {
  logoHigh: 10,
  logoMedium: 20,
  jsonLd: 22,
  logoLow: 25,
  svgIcon: 30,
  appleIcon: 40,
  manifestIcon: 50,
  pngIcon: 55,
  og: 60,
  favicon: 70,
} as const;

export const COLOR_RANK = {
  themeColor: 1,
  manifest: 2,
  maskIcon: 3,
  tileColor: 4,
  svgLogo: 5,
  cssVariable: 6,
} as const;

// ---------------------------------------------------------------------------
// Entities

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", middot: "·", bull: "•", raquo: "»", laquo: "«",
  copy: "©", reg: "®", trade: "™", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", bdquo: "„", verbar: "|", vert: "|",
  oacute: "ó", Oacute: "Ó", aogon: "ą", Aogon: "Ą", eogon: "ę", Eogon: "Ę",
  lstrok: "ł", Lstrok: "Ł", nacute: "ń", Nacute: "Ń", sacute: "ś", Sacute: "Ś",
  zacute: "ź", Zacute: "Ź", zdot: "ż", Zdot: "Ż", cacute: "ć", Cacute: "Ć",
};

export function decodeEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  // Semicolon required: attribute URLs like "?a=1&copy=2" must stay intact.
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return "�";
      }
      return String.fromCodePoint(code);
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : m;
  });
}

// ---------------------------------------------------------------------------
// Tokenizer

export interface HtmlElement {
  name: string;
  /** Lower-cased names, entity-decoded values, first occurrence wins. */
  attrs: Record<string, string>;
}

export interface HtmlWalker {
  /** Called for every start tag, before it is pushed on the stack. */
  open(el: HtmlElement, stack: readonly HtmlElement[]): void;
  /** Contents of raw-text elements (style, script, title...). `stack` ends with the element. */
  text?(el: HtmlElement, text: string, stack: readonly HtmlElement[]): void;
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);
const RAW_TEXT_ELEMENTS = ["script", "style", "title", "textarea", "xmp", "noembed", "noframes", "iframe"];
const RAW_TEXT_CLOSE = new Map(RAW_TEXT_ELEMENTS.map((n) => [n, new RegExp(`</${n}[\\s/>]`, "gi")]));
// Real pages nest ~30 deep; this only bounds memory on hostile markup.
const MAX_STACK_DEPTH = 256;

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}
function isAsciiAlpha(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * Walk start tags of an HTML document keeping a (best-effort) open-element
 * stack. Linear in the input: every branch moves past what it looked at.
 */
export function walkHtml(html: string, walker: HtmlWalker): void {
  const n = html.length;
  const stack: HtmlElement[] = [];
  let i = 0;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    i = lt;
    const next = html.charCodeAt(i + 1);

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      const end = html.indexOf(">", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (next === 47 /* / */) {
      let j = i + 2;
      while (j < n && !isSpace(html.charCodeAt(j)) && html[j] !== ">" && html[j] !== "/") j++;
      const name = html.slice(i + 2, j).toLowerCase();
      const end = html.indexOf(">", j);
      i = end === -1 ? n : end + 1;
      if (name) {
        // Pop to the matching element; an unmatched close tag is ignored,
        // which is what keeps stray </div>s from wrecking the context.
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].name === name) {
            stack.length = k;
            break;
          }
        }
      }
      continue;
    }
    if (!isAsciiAlpha(next)) {
      i++;
      continue;
    }

    // Start tag: name, then attributes.
    let j = i + 1;
    while (j < n) {
      const c = html.charCodeAt(j);
      if (isSpace(c) || c === 47 || c === 62) break;
      j++;
    }
    const name = html.slice(i + 1, j).toLowerCase();
    const attrs = Object.create(null) as Record<string, string>;
    let selfClosing = false;

    for (;;) {
      while (j < n) {
        const c = html.charCodeAt(j);
        if (c === 47 /* / */) {
          if (html.charCodeAt(j + 1) === 62) selfClosing = true;
          j++;
        } else if (isSpace(c)) j++;
        else break;
      }
      if (j >= n) break;
      if (html.charCodeAt(j) === 62 /* > */) {
        j++;
        break;
      }
      const nameStart = j;
      while (j < n) {
        const c = html.charCodeAt(j);
        if (isSpace(c) || c === 47 || c === 62 || (c === 61 && j > nameStart)) break;
        j++;
      }
      if (j === nameStart) {
        j++; // lone '=' or similar junk - skip a char so we always progress
        continue;
      }
      const attrName = html.slice(nameStart, j).toLowerCase();
      while (j < n && isSpace(html.charCodeAt(j))) j++;
      let value = "";
      if (html.charCodeAt(j) === 61 /* = */) {
        j++;
        while (j < n && isSpace(html.charCodeAt(j))) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          const end = close === -1 ? n : close;
          value = html.slice(j + 1, end);
          j = end + 1;
        } else {
          const vs = j;
          while (j < n && !isSpace(html.charCodeAt(j)) && html.charCodeAt(j) !== 62) j++;
          value = html.slice(vs, j);
        }
      }
      if (!(attrName in attrs)) attrs[attrName] = decodeEntities(value);
    }

    const el: HtmlElement = { name, attrs };
    walker.open(el, stack);

    const closeRe = RAW_TEXT_CLOSE.get(name);
    if (closeRe && !selfClosing) {
      closeRe.lastIndex = j;
      const m = closeRe.exec(html);
      const end = m ? m.index : n;
      if (walker.text) {
        stack.push(el);
        walker.text(el, html.slice(j, end), stack);
        stack.pop();
      }
      const gt = m ? html.indexOf(">", end) : -1;
      i = gt === -1 ? n : gt + 1;
      continue;
    }

    if (!VOID_ELEMENTS.has(name) && !selfClosing && stack.length < MAX_STACK_DEPTH) {
      stack.push(el);
    }
    i = j;
  }
}

// ---------------------------------------------------------------------------
// Colours

const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", navy: "#000080", maroon: "#800000", purple: "#800080",
  teal: "#008080", olive: "#808000", lime: "#00ff00", aqua: "#00ffff",
  cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff", yellow: "#ffff00",
  orange: "#ffa500", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  gold: "#ffd700", crimson: "#dc143c", darkblue: "#00008b", darkgreen: "#006400",
  darkred: "#8b0000", royalblue: "#4169e1", dodgerblue: "#1e90ff", tomato: "#ff6347",
  coral: "#ff7f50", indigo: "#4b0082", rebeccapurple: "#663399", firebrick: "#b22222",
  forestgreen: "#228b22", seagreen: "#2e8b57", steelblue: "#4682b4", slateblue: "#6a5acd",
  darkorange: "#ff8c00", orangered: "#ff4500", deepskyblue: "#00bfff", midnightblue: "#191970",
};

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/;

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function splitArgs(s: string): string[] {
  return s.replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
}

function parseRgb(parts: string[]): string | null {
  if (parts.length < 3) return null;
  const vals: number[] = [];
  for (const p of parts.slice(0, 3)) {
    const pct = p.endsWith("%");
    const raw = pct ? p.slice(0, -1) : p;
    if (!NUM_RE.test(raw)) return null;
    const v = parseFloat(raw);
    vals.push(pct ? v * 2.55 : v);
  }
  return toHex(vals[0], vals[1], vals[2]);
}

function parseHsl(parts: string[]): string | null {
  if (parts.length < 3) return null;
  const hm = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/.exec(parts[0]);
  if (!hm) return null;
  let h = parseFloat(hm[1]);
  if (hm[2] === "turn") h *= 360;
  else if (hm[2] === "rad") h = (h * 180) / Math.PI;
  else if (hm[2] === "grad") h *= 0.9;
  const pctOf = (p: string) => {
    const raw = p.endsWith("%") ? p.slice(0, -1) : p;
    return NUM_RE.test(raw) ? Math.min(100, Math.max(0, parseFloat(raw))) / 100 : NaN;
  };
  const s = pctOf(parts[1]);
  const l = pctOf(parts[2]);
  if (Number.isNaN(s) || Number.isNaN(l)) return null;
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * Any CSS-ish colour we care about -> "#rrggbb" (alpha dropped), or null.
 * `allowBare` accepts the channel-only forms design systems keep in custom
 * properties: "18, 18, 18" (Shopify Dawn, Bootstrap *-rgb) and
 * "222.2 47.4% 11.2%" (shadcn / Tailwind HSL).
 */
export function normalizeColor(input: string, opts: { allowBare?: boolean } = {}): string | null {
  const v = input.trim().toLowerCase().replace(/\s*!important\s*$/, "");
  if (!v || v.length > 80) return null;
  if (v[0] === "#") {
    const hex = v.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
    return null;
  }
  let m = /^rgba?\(([^()]*)\)$/.exec(v);
  if (m) return parseRgb(splitArgs(m[1]));
  m = /^hsla?\(([^()]*)\)$/.exec(v);
  if (m) return parseHsl(splitArgs(m[1]));
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, v)) return NAMED_COLORS[v];
  if (opts.allowBare && /^[\d.\s,%+-]+$/.test(v)) {
    const parts = splitArgs(v);
    if (parts.length !== 3) return null;
    return v.includes("%") ? parseHsl(parts) : parts.every((p) => /^\d{1,3}$/.test(p)) ? parseRgb(parts) : null;
  }
  return null;
}

/** White, black and anything without real colour - useless as an accent. */
export function isGreyish(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const chroma = max - min;
  const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
  return chroma < 0.1 || s < 0.15 || l > 0.95 || l < 0.05;
}

// Theme / framework defaults that show up in CSS variables of sites which
// never customised them - "brand colour" would be a lie.
const FRAMEWORK_DEFAULT_COLORS = new Set([
  "#0d6efd", "#007bff", // Bootstrap 5 / 4 primary
  "#a46497", "#720eec", "#7f54b3", "#96588a", // WooCommerce purples
  "#2271b1", "#0073aa", "#3858e9", // WordPress admin / core blues
  "#6ec1e4", "#61ce70", "#54595f", // Elementor global defaults
]);

/** A usable brand accent: valid, not grey, not a framework default. */
function brandish(hex: string | null, opts: { rejectDefaults?: boolean } = {}): hex is string {
  return Boolean(hex) && !isGreyish(hex as string) && !(opts.rejectDefaults && FRAMEWORK_DEFAULT_COLORS.has(hex as string));
}

const BRAND_VAR_RE = /(brand|primary|accent)/;
const NOT_BRAND_VAR_RE =
  /(foreground|contrast|text|on-|-on\b|light|pale|soft|subtle|hover|active|focus|shadow|disabled|bg|background|border|muted|font|size|width|height|radius|opacity|transition|family|weight|spacing|gradient|dark)/;

/**
 * Dominant brand colour from `--primary`, `--brand-*`, `--accent`,
 * `--color-primary`, `--wp--preset--color--primary`, `--e-global-color-primary`
 * ... in inline <style> blocks. Variables referencing other variables are
 * resolved a few levels deep.
 */
export function cssVariableColor(css: string): string | null {
  const vars = new Map<string, string>();
  const re = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(css)) && guard++ < 20000) {
    const name = m[1].toLowerCase();
    // First definition wins: :root comes first, dark-mode overrides later.
    if (!vars.has(name)) vars.set(name, m[2].trim());
  }

  const resolve = (value: string, depth: number): string => {
    const ref = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/.exec(value.trim());
    if (!ref || depth > 4) return value;
    const target = vars.get(ref[1].toLowerCase());
    return target !== undefined ? resolve(target, depth + 1) : ref[2] ? resolve(ref[2], depth + 1) : value;
  };

  const tally = new Map<string, number>();
  const order: string[] = [];
  vars.forEach((value, name) => {
    if (!BRAND_VAR_RE.test(name) || NOT_BRAND_VAR_RE.test(name)) return;
    const hex = normalizeColor(resolve(value, 0), { allowBare: true });
    if (!brandish(hex, { rejectDefaults: true })) return;
    const weight = (name.includes("brand") ? 3 : name.includes("primary") ? 2 : 1) + (name.includes("color") ? 0.5 : 0);
    if (!tally.has(hex)) order.push(hex);
    tally.set(hex, (tally.get(hex) ?? 0) + weight);
  });
  let best: string | null = null;
  for (const hex of order) if (best === null || (tally.get(hex) ?? 0) > (tally.get(best) ?? 0)) best = hex;
  return best;
}

/** Most frequent non-grey colour in an inline SVG logo's fills / strokes. */
function dominantColor(values: string[]): string | null {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const v of values) {
    const hex = normalizeColor(v);
    if (!brandish(hex)) continue;
    if (!counts.has(hex)) order.push(hex);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const hex of order) if (best === null || (counts.get(hex) ?? 0) > (counts.get(best) ?? 0)) best = hex;
  return best;
}

// ---------------------------------------------------------------------------
// URL helpers

/** Absolute http(s) URL (fragment dropped) or null for data:/javascript:/junk. */
export function resolveUrl(raw: string | undefined, base: URL): URL | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 2000 || /^(data|javascript|blob|about|mailto|tel|cid):/i.test(v)) return null;
  try {
    let u = new URL(v, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Next.js image optimizer: store the original asset, not a resize URL
    // that depends on width/quality params and the site's loader config.
    if (u.pathname.endsWith("/_next/image") && u.searchParams.get("url")) {
      const inner = resolveUrl(u.searchParams.get("url") ?? "", u);
      if (inner) u = inner;
    }
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

/** First candidate URL of a srcset (URLs may contain commas, e.g. Cloudinary). */
export function srcsetFirst(srcset: string | undefined): string | null {
  const s = (srcset ?? "").replace(/^[\s,]+/, "");
  const m = /^\S+/.exec(s);
  if (!m) return null;
  return m[0].replace(/,+$/, "") || null;
}

function largestSize(sizes: string | undefined): number | undefined {
  if (!sizes) return undefined;
  if (/\bany\b/i.test(sizes)) return 512;
  let best = 0;
  for (const m of sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)) best = Math.max(best, Number(m[1]), Number(m[2]));
  return best || undefined;
}

function isSvgUrl(u: URL, type?: string): boolean {
  return /svg/i.test(type ?? "") || /\.svgz?$/i.test(u.pathname);
}

function sameSite(a: URL, b: URL): boolean {
  return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
}

// ---------------------------------------------------------------------------
// The page parser

const LOGO_RE = /logo/;
const ANCESTOR_LOGO_RE = /logo|navbar-brand|site-brand|brand-logo|header__heading/;
// Containers of OTHER companies' logos (partners, payment badges, client
// carousels) - and footers, where the logo is often a white/mono variant.
const NEGATIVE_RE =
  /logos|partner|sponsor|client|customer|carousel|slider|marquee|swiper|slick|award|certif|payment|badge|social|footer|trust|review|press|as-seen|brands|gallery|product/;
const HEADER_RE = /(^|[\s_-])(header|masthead|navbar|topbar|top-bar|site-branding|nav|menu-bar|appbar)([\s_-]|$)/;
const LAZY_SRC_ATTRS = ["src", "data-src", "data-lazy-src", "data-original", "data-lazy", "data-url"];
const SRCSET_ATTRS = ["srcset", "data-srcset", "data-lazy-srcset"];
// Lazy-load placeholders that sit in `src` while the real file waits in data-*.
const PLACEHOLDER_RE = /(^data:)|(blank|spacer|placeholder|transparent|lazy|pixel)\.(gif|png|svg)/i;

function attrText(el: HtmlElement): string {
  return `${el.attrs.class ?? ""} ${el.attrs.id ?? ""}`.toLowerCase();
}

function imageSource(attrs: Record<string, string>): string | null {
  for (const key of LAZY_SRC_ATTRS) {
    const v = attrs[key]?.trim();
    if (v && !PLACEHOLDER_RE.test(v)) return v;
  }
  for (const key of SRCSET_ATTRS) {
    const first = srcsetFirst(attrs[key]);
    if (first && !PLACEHOLDER_RE.test(first)) return first;
  }
  return null;
}

function isHomeHref(href: string | undefined, page: URL): boolean {
  if (href === undefined) return false;
  const h = href.trim();
  if (!h) return false;
  if (h === "/" || h === "./") return true;
  try {
    const u = new URL(h, page);
    return (
      sameSite(u, page) &&
      (/^\/(index\.(html?|php))?$/i.test(u.pathname) || /^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(u.pathname))
    );
  } catch {
    return false;
  }
}

interface Context {
  inHeader: boolean;
  inFooter: boolean;
  ancestorLogo: boolean;
  homeLink: boolean;
  negative: boolean;
  inSvg: boolean;
}

function analyse(stack: readonly HtmlElement[], page: URL): Context {
  const ctx: Context = { inHeader: false, inFooter: false, ancestorLogo: false, homeLink: false, negative: false, inSvg: false };
  for (let k = stack.length - 1, depth = 0; k >= 0; k--, depth++) {
    const a = stack[k];
    const tokens = attrText(a);
    if (a.name === "svg") ctx.inSvg = true;
    if (a.name === "header" || a.name === "nav" || a.attrs.role === "banner" || HEADER_RE.test(tokens)) ctx.inHeader = true;
    if (a.name === "footer" || a.attrs.role === "contentinfo" || tokens.includes("footer")) ctx.inFooter = true;
    // Logo markers only count close to the image: a "logo" class on <body>
    // (some themes do that) says nothing about a picture 20 levels down.
    if (depth < 6) {
      if (NEGATIVE_RE.test(tokens)) ctx.negative = true;
      if (ANCESTOR_LOGO_RE.test(tokens) || LOGO_RE.test((a.attrs["aria-label"] ?? "").toLowerCase())) ctx.ancestorLogo = true;
      if (a.name === "a" && (isHomeHref(a.attrs.href, page) || /\bhome\b/i.test(a.attrs.rel ?? ""))) ctx.homeLink = true;
    }
  }
  return ctx;
}

function fileName(src: string): string {
  return (src.split(/[?#]/)[0].split("/").pop() ?? "").toLowerCase();
}

interface JsonLdNode {
  [key: string]: unknown;
}

/** schema.org Organization / Brand / LocalBusiness `logo` values. */
export function jsonLdLogos(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    return [];
  }
  const out: string[] = [];
  let visited = 0;
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 8 || visited++ > 1000) return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as JsonLdNode;
    const types = ([] as unknown[]).concat(obj["@type"] ?? []).map((t) => String(t).toLowerCase());
    // A Product's "logo" (or its brand's) is the product, not the site owner.
    const isProduct = types.some((t) => t === "product" || t === "offer" || t === "productgroup");
    if (!isProduct && obj.logo !== undefined) {
      const logo = Array.isArray(obj.logo) ? obj.logo[0] : obj.logo;
      if (typeof logo === "string") out.push(logo);
      else if (logo && typeof logo === "object") {
        const l = logo as JsonLdNode;
        const url = l.url ?? l.contentUrl;
        if (typeof url === "string") out.push(url);
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "logo" || (isProduct && key === "brand")) continue;
      visit(obj[key], depth + 1);
    }
  };
  visit(data, 0);
  return out;
}

/** "Strona główna | DRE - Drzwi" -> "DRE - Drzwi" style clean-up. */
export function cleanSiteName(title: string | null, host: string): string | null {
  if (!title) return null;
  const t = decodeEntities(title).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const parts = t
    .split(/\s+[|–—·•»:~]\s+|\s+-\s+|\s*\|\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const label = host.replace(/^www\./, "").split(".")[0].toLowerCase();
  const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const match = label.length >= 2 ? parts.find((p) => plain(p).includes(label.replace(/[^a-z0-9]/g, ""))) : undefined;
  const pick = match ?? parts[0] ?? t;
  return pick.length > 80 ? `${pick.slice(0, 77)}…` : pick;
}

/**
 * Parse a fetched HTML page. `pageUrl` is the FINAL URL after redirects: every
 * relative and protocol-relative reference is resolved against it (or
 * against <base href>, like a browser would).
 */
export function parseBrandingHtml(html: string, pageUrl: string): ParsedPage {
  const page = new URL(pageUrl);
  let base = page;
  let baseSeen = false;

  type RawLogo = { src: string; confidence: Confidence; rank: number; label: string; kind: LogoKind; size?: number; type?: string };
  const raw: RawLogo[] = [];
  const themeColors: Array<{ content: string; media: string }> = [];
  // Assigned inside walker callbacks - the cast stops TS narrowing it to null.
  let maskColor = null as string | null;
  let tileColor = null as string | null;
  let manifestHref = null as string | null;
  let ogSiteName = null as string | null;
  let appName = null as string | null;
  let title = null as string | null;
  let metaRefresh = null as string | null;
  let pageCss = "";
  const svgColorValues: string[] = [];
  let svgLogoEl = null as HtmlElement | null;
  let svgLogoIndex = -1;
  let svgLogoDone = false;
  let markedImages = 0;

  const insideSvgLogo = (stack: readonly HtmlElement[]) =>
    svgLogoEl !== null && stack[svgLogoIndex] === svgLogoEl;

  const collectSvgColors = (el: HtmlElement) => {
    for (const key of ["fill", "stroke", "stop-color", "color"]) {
      if (el.attrs[key]) svgColorValues.push(el.attrs[key]);
    }
    const style = el.attrs.style;
    if (style) {
      for (const m of style.matchAll(/(?:^|;)\s*(?:fill|stroke|stop-color)\s*:\s*([^;]+)/gi)) svgColorValues.push(m[1]);
    }
  };

  walkHtml(html, {
    open(el, stack) {
      const a = el.attrs;
      if (svgLogoEl !== null && !svgLogoDone) {
        if (insideSvgLogo(stack)) collectSvgColors(el);
        else svgLogoDone = true; // walked past the logo's </svg>
      }

      switch (el.name) {
        case "base": {
          if (!baseSeen && a.href) {
            baseSeen = true;
            base = resolveUrl(a.href, page) ?? page;
          }
          return;
        }
        case "link": {
          const rel = (a.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean);
          const href = a.href;
          if (!href) return;
          if (rel.includes("manifest")) manifestHref ??= href;
          if (rel.includes("mask-icon")) {
            maskColor ??= a.color ?? null;
          } else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) {
            const size = largestSize(a.sizes) ?? 180;
            raw.push({ src: href, kind: "icon", confidence: "medium", rank: RANK.appleIcon, label: `Ikona Apple Touch (${size}×${size})`, size });
          } else if (rel.includes("icon")) {
            const size = largestSize(a.sizes);
            const typeOrHref = `${a.type ?? ""} ${href}`;
            if (/svg/i.test(typeOrHref)) {
              raw.push({ src: href, kind: "icon", confidence: "medium", rank: RANK.svgIcon, label: "Ikona SVG strony", size: size ?? 512, type: a.type });
            } else if (size !== undefined && size >= 128 && !/\.ico(\?|$)/i.test(href)) {
              raw.push({ src: href, kind: "icon", confidence: size >= 192 ? "medium" : "low", rank: RANK.pngIcon, label: `Ikona strony (${size}×${size})`, size });
            } else {
              raw.push({ src: href, kind: "favicon", confidence: "low", rank: RANK.favicon, label: "Favicon (mała ikona z karty przeglądarki)", size });
            }
          }
          return;
        }
        case "meta": {
          const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
          const content = a.content ?? "";
          const httpEquiv = (a["http-equiv"] ?? "").toLowerCase();
          if (httpEquiv === "refresh") {
            const m = /url\s*=\s*['"]?([^'"]+)/i.exec(content);
            if (m) metaRefresh ??= m[1].trim();
          }
          if (!content) return;
          if (key === "theme-color") themeColors.push({ content, media: (a.media ?? "").toLowerCase() });
          else if (key === "msapplication-tilecolor") tileColor ??= content;
          else if (key === "og:site_name") ogSiteName ??= content;
          else if (key === "application-name" || key === "apple-mobile-web-app-title") appName ??= content;
          else if (key === "og:image" || key === "og:image:secure_url" || key === "og:image:url" || key === "twitter:image" || key === "twitter:image:src") {
            raw.push({ src: content, kind: "og", confidence: "low", rank: RANK.og, label: "Obrazek do udostępniania (og:image) - często baner" });
          }
          return;
        }
        case "img": {
          const src = imageSource(a);
          if (!src) return;
          const w = Number(a.width);
          const h = Number(a.height);
          if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) return; // tracking pixels
          const ctx = analyse(stack, page);
          if (ctx.negative || ctx.inFooter || ctx.inSvg || NEGATIVE_RE.test(attrText(el))) return;
          const own = LOGO_RE.test(`${attrText(el)} ${(a.alt ?? "").toLowerCase()} ${fileName(src)}`);
          const marked = own || ctx.ancestorLogo;
          let confidence: Confidence | null = null;
          if (ctx.inHeader && marked) confidence = "high";
          else if (ctx.inHeader && ctx.homeLink) confidence = "medium";
          else if (marked) confidence = markedImages === 0 ? "medium" : "low";
          if (!confidence) return;
          if (marked && !ctx.inHeader) markedImages++;
          raw.push({
            src,
            kind: "logo",
            confidence,
            rank: confidence === "high" ? RANK.logoHigh : confidence === "medium" ? RANK.logoMedium : RANK.logoLow,
            label: confidence === "high" ? "Logo w nagłówku strony" : "Obrazek oznaczony jako logo",
          });
          return;
        }
        case "svg": {
          if (svgLogoEl !== null) return;
          const ctx = analyse(stack, page);
          if (ctx.negative || ctx.inFooter || ctx.inSvg) return;
          const own = LOGO_RE.test(`${attrText(el)} ${(a["aria-label"] ?? "").toLowerCase()}`);
          if ((ctx.inHeader && (own || ctx.ancestorLogo || ctx.homeLink)) || own || ctx.ancestorLogo) {
            svgLogoEl = el;
            svgLogoIndex = stack.length; // where the walker is about to push it
            collectSvgColors(el);
          }
          return;
        }
      }
    },
    text(el, text, stack) {
      if (el.name === "style") {
        if (insideSvgLogo(stack)) {
          for (const m of text.matchAll(/(?:fill|stroke|stop-color)\s*:\s*([^;}]+)/gi)) svgColorValues.push(m[1]);
        } else if (pageCss.length < 400_000) {
          pageCss += `\n${text}`;
        }
      } else if (el.name === "title") {
        if (title === null && !stack.some((s) => s.name === "svg")) title = text;
      } else if (el.name === "script" && /ld\+json/i.test(el.attrs.type ?? "") && text.length < 300_000) {
        for (const logo of jsonLdLogos(text)) {
          raw.push({ src: logo, kind: "logo", confidence: "medium", rank: RANK.jsonLd, label: "Logo z danych strukturalnych strony (schema.org)" });
        }
      }
    },
  });

  // Resolve now that <base href> is known. Rank first, so when the same file
  // is both og:image (in <head>) and the header logo, the logo entry wins.
  raw.sort((x, y) => x.rank - y.rank);
  const seen = new Set<string>();
  const logos: LogoCandidate[] = [];
  for (const r of raw) {
    const u = resolveUrl(r.src, base);
    if (!u) continue;
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    // An SVG favicon declared without an "svg" type still counts as SVG icon.
    if (r.kind === "favicon" && isSvgUrl(u, r.type)) {
      logos.push({ url: key, kind: "icon", confidence: "medium", rank: RANK.svgIcon, label: "Ikona SVG strony", size: 512 });
      continue;
    }
    logos.push({ url: key, kind: r.kind, confidence: r.confidence, label: r.label, size: r.size, rank: r.rank });
  }
  sortLogos(logos);

  // Colours, in priority order (manifest colours are merged in by fetch.ts).
  const colors: ColorCandidate[] = [];
  const pushColor = (value: string | null, source: ColorSource, rank: number, label: string) => {
    const hex = value ? normalizeColor(value) : null;
    if (!brandish(hex) || colors.some((c) => c.color === hex)) return;
    colors.push({ color: hex, source, rank, label });
  };
  // Prefer the light-scheme / unconditional theme-color: dark-mode variants
  // are usually near-black and say nothing about the brand.
  const themeOrder = [
    ...themeColors.filter((t) => !t.media),
    ...themeColors.filter((t) => t.media.includes("light")),
    ...themeColors.filter((t) => t.media && !t.media.includes("light")),
  ];
  for (const t of themeOrder) pushColor(t.content, "theme-color", COLOR_RANK.themeColor, "Kolor motywu strony (theme-color)");
  pushColor(maskColor, "mask-icon", COLOR_RANK.maskIcon, "Kolor ikony Safari (mask-icon)");
  pushColor(tileColor, "tile-color", COLOR_RANK.tileColor, "Kolor kafelka Windows (msapplication-TileColor)");
  pushColor(dominantColor(svgColorValues), "svg-logo", COLOR_RANK.svgLogo, "Dominujący kolor logo SVG");
  pushColor(cssVariableColor(pageCss), "css-variable", COLOR_RANK.cssVariable, "Zmienna CSS motywu (np. --primary)");
  sortColors(colors);

  const manifestUrl = manifestHref ? resolveUrl(manifestHref, base)?.toString() ?? null : null;
  const refresh = metaRefresh ? resolveUrl(metaRefresh, base)?.toString() ?? null : null;

  return {
    logos,
    colors,
    siteName: ogSiteName?.trim() || appName?.trim() || cleanSiteName(title, page.hostname),
    manifestUrl,
    inlineSvgLogo: svgLogoEl !== null,
    metaRefreshUrl: refresh && refresh !== page.toString() ? refresh : null,
  };
}

export function sortLogos(list: LogoCandidate[]): void {
  // Array.prototype.sort is stable: equal ranks keep document order.
  list.sort((a, b) => a.rank - b.rank || (a.kind === "icon" ? (b.size ?? 0) - (a.size ?? 0) : 0));
}

export function sortColors(list: ColorCandidate[]): void {
  list.sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// Web app manifest

export interface ParsedManifest {
  icon: LogoCandidate | null;
  colors: ColorCandidate[];
  name: string | null;
}

/** The largest PNG/SVG icon (>= 128 px) and non-grey colours of a manifest. */
export function parseManifest(data: unknown, manifestUrl: string): ParsedManifest {
  const result: ParsedManifest = { icon: null, colors: [], name: null };
  if (!data || typeof data !== "object" || Array.isArray(data)) return result;
  const m = data as Record<string, unknown>;
  const base = new URL(manifestUrl);

  let best: { url: string; size: number; maskable: boolean } | null = null;
  const icons = Array.isArray(m.icons) ? m.icons.slice(0, 50) : [];
  for (const icon of icons) {
    if (!icon || typeof icon !== "object") continue;
    const i = icon as Record<string, unknown>;
    const u = typeof i.src === "string" ? resolveUrl(i.src, base) : null;
    if (!u) continue;
    const type = typeof i.type === "string" ? i.type.toLowerCase() : "";
    const svg = isSvgUrl(u, type);
    const png = /png/.test(type) || /\.png$/i.test(u.pathname);
    if (!svg && !png) continue;
    const purpose = typeof i.purpose === "string" ? i.purpose.toLowerCase() : "any";
    if (/monochrome/.test(purpose) && !/any/.test(purpose)) continue;
    // Maskable icons carry a safe-zone padding/background: fine, but worse.
    const maskable = /maskable/.test(purpose) && !/any/.test(purpose);
    const size = largestSize(typeof i.sizes === "string" ? i.sizes : undefined) ?? (svg ? 512 : 0);
    if (size < 128) continue;
    if (!best || (best.maskable && !maskable) || (best.maskable === maskable && size > best.size)) {
      best = { url: u.toString(), size, maskable };
    }
  }
  if (best) {
    result.icon = {
      url: best.url,
      kind: "icon",
      confidence: "medium",
      rank: RANK.manifestIcon,
      label: `Ikona z manifestu aplikacji (${best.size}×${best.size})`,
      size: best.size,
    };
  }

  for (const key of ["theme_color", "background_color"] as const) {
    const v = m[key];
    const hex = typeof v === "string" ? normalizeColor(v) : null;
    if (brandish(hex) && !result.colors.some((c) => c.color === hex)) {
      result.colors.push({
        color: hex,
        source: "manifest",
        rank: COLOR_RANK.manifest,
        label: key === "theme_color" ? "Kolor z manifestu (theme_color)" : "Kolor z manifestu (background_color)",
      });
    }
  }

  const name = typeof m.short_name === "string" ? m.short_name : typeof m.name === "string" ? m.name : null;
  result.name = name?.trim().slice(0, 80) || null;
  return result;
}
