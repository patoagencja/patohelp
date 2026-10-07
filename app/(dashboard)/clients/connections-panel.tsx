import Link from "next/link";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import {
  AD_PROVIDERS,
  PROVIDER_LABEL,
  type AdProviderKey,
  type ProviderHealth,
} from "@/lib/dashboard/integration-health";
import { isMetaSessionInvalidated } from "@/lib/integrations/errors";
import { fixedOthersLabel } from "@/lib/integrations/fixed-label";
import {
  googleOAuthClientInfo,
  googleOAuthClientsShared,
} from "@/lib/integrations/google-identity";
import { cn } from "@/lib/utils";

type Provider = "meta_ads" | "google_ads" | "ga4";

const LABEL: Record<Provider, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  ga4: "Google Analytics 4",
};

const CONNECT: Record<Provider, string> = {
  meta_ads: "/api/integrations/meta/connect",
  google_ads: "/api/integrations/google-ads/connect",
  ga4: "/api/integrations/ga4/connect",
};

interface Broken {
  slug: string;
  name: string;
  health: ProviderHealth;
}

export interface ConnectionsPanelClient {
  slug: string;
  name: string;
  down: ProviderHealth[];
}

/** A connected ad integration with accounts listed but none ticked. */
export interface UnselectedIntegration {
  slug: string;
  name: string;
  provider: AdProviderKey;
  /** Accounts on the list, all of them unticked. */
  total: number;
}

/**
 * Connected but syncing nothing: the token works, the account list is there,
 * nothing is ticked. Easy to miss because the integration still shows as
 * connected. Only points at the settings - picking accounts stays a human
 * decision.
 */
function NothingSelectedBlock({ list }: { list: UnselectedIntegration[] }) {
  return (
    <div
      role="status"
      className="space-y-3 rounded-[22px] bg-warning-soft px-4 py-3.5 text-sm text-foreground sm:px-5"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          Połączone, ale 0 wybranych kont
        </p>
        <p className="text-ink-2">
          Integracja jest podpięta, ale żadne konto reklamowe nie jest zaznaczone, więc
          synchronizacja niczego nie pobiera. Zaznacz konta w Ustawieniach klienta.
        </p>
      </div>
      <ul className="space-y-1.5">
        {AD_PROVIDERS.map((provider) => {
          const items = list.filter((u) => u.provider === provider);
          if (!items.length) return null;
          return (
            <li key={provider}>
              <span className="font-medium">{PROVIDER_LABEL[provider]}:</span>{" "}
              {items.map((u, i) => (
                <span key={u.slug}>
                  {i > 0 ? ", " : null}
                  <Link
                    href={`/${u.slug}/settings#integracje`}
                    className="font-medium underline underline-offset-2"
                  >
                    {u.name}
                  </Link>{" "}
                  <span className="text-muted-foreground tabular-nums">(0 z {u.total})</span>
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** First client to anchor the one-time OAuth flow: prefer a dead token. */
function anchorOf(list: Broken[]): string | null {
  return (list.find((b) => b.health.tokenExpired) ?? list[0])?.slug ?? null;
}

function shortError(message: string | null): string {
  if (!message) return "brak danych (bez komunikatu błędu)";
  return message.length > 220 ? `${message.slice(0, 220)}…` : message;
}

/** Same error text on several clients is the same root cause - group it. */
function groupByError(list: Broken[]): Array<{ error: string; names: string[] }> {
  const groups = new Map<string, string[]>();
  for (const b of list) {
    const key = shortError(b.health.lastError);
    groups.set(key, [...(groups.get(key) ?? []), b.name]);
  }
  return [...groups.entries()]
    .map(([error, names]) => ({ error, names }))
    .sort((a, b) => b.names.length - a.names.length);
}

function ReconnectButton({
  provider,
  anchor,
  label,
}: {
  provider: Provider;
  anchor: string;
  label: string;
}) {
  return (
    <Button asChild size="pill" className="w-fit gap-1.5">
      <a href={`${CONNECT[provider]}?client=${encodeURIComponent(anchor)}&return=clients`}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        {label}
      </a>
    </Button>
  );
}

function ProviderBlock({ provider, broken }: { provider: Provider; broken: Broken[] }) {
  const expired = broken.filter((b) => b.health.tokenExpired).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[15px] font-medium">{LABEL[provider]}</p>
        {broken.length ? (
          <Pill tone="warning" className="tabular-nums">
            {broken.length} {broken.length === 1 ? "klient" : "klientów"} nie działa
          </Pill>
        ) : (
          <Pill tone="positive">
            <CheckCircle2 aria-hidden /> działa wszędzie
          </Pill>
        )}
        {expired ? (
          <Pill tone="neutral" className="tabular-nums">
            token wygasł: {expired}
          </Pill>
        ) : null}
      </div>
      {broken.length ? (
        <ul className="space-y-1.5">
          {groupByError(broken).map((g) => (
            <li key={g.error} className="rounded-[16px] bg-chip px-3 py-2 text-xs">
              <p className="break-words text-foreground">{g.error}</p>
              <p className="mt-0.5 text-muted-foreground">{g.names.join(", ")}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Agency-wide connection status: per provider how many clients are broken
 * and with what real error, plus ONE reconnect per provider family. The flow
 * runs once (anchored on one broken client) and the callback reuses the new
 * token for every other client it verifiably reaches.
 */
export function ConnectionsPanel({
  clients,
  nothingSelected = [],
  reconnected,
  fixed,
  connError,
}: {
  clients: ConnectionsPanelClient[];
  nothingSelected?: UnselectedIntegration[];
  reconnected?: string;
  fixed?: string;
  connError?: string;
}) {
  const broken: Record<Provider, Broken[]> = { meta_ads: [], google_ads: [], ga4: [] };
  for (const c of clients) {
    for (const h of c.down) {
      if (h.provider in broken) {
        broken[h.provider as Provider].push({ slug: c.slug, name: c.name, health: h });
      }
    }
  }

  const shared = googleOAuthClientsShared();
  const metaAnchor = anchorOf(broken.meta_ads);
  const adsAnchor = anchorOf(broken.google_ads);
  const ga4Anchor = anchorOf(broken.ga4);
  const metaInvalidated = broken.meta_ads.some((b) =>
    isMetaSessionInvalidated(b.health.lastError)
  );
  const testingMode = [...broken.google_ads, ...broken.ga4].some(
    (b) => b.health.testingModeSuspected
  );
  const totalBroken = broken.meta_ads.length + broken.google_ads.length + broken.ga4.length;
  const googleClient = googleOAuthClientInfo().find((c) => c.clientId);

  const fixedCount = Number(fixed);
  const resultLabel =
    reconnected && reconnected in LABEL ? LABEL[reconnected as Provider] : reconnected;

  return (
    <section id="polaczenia" aria-labelledby="polaczenia-title" className="scroll-mt-28 space-y-4">
      <div className="px-1">
        <p className="kick">Napraw wszystkie naraz</p>
        <h2 id="polaczenia-title" className="mt-2 text-[22px] font-medium tracking-[-0.03em]">
          Połączenia
        </h2>
        <p className="mt-1.5 text-[15px] text-ink-2">
          Wszyscy klienci są podpięci tym samym logowaniem, więc padają razem. Jedno
          „Połącz ponownie” poniżej naprawia każdego klienta, do którego kont nowe
          logowanie ma dostęp - sprawdzamy to przed podmianą tokenu.
        </p>
      </div>

      {reconnected ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-[18px] bg-positive-soft px-4 py-3 text-sm text-foreground"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
          <span>
            Połączono {resultLabel}.{" "}
            {Number.isFinite(fixedCount) && fixedCount > 0
              ? `${fixedOthersLabel(fixedCount)}. Dane dociągniemy przy najbliższej synchronizacji (do 30 min).`
              : "Nowe logowanie nie pasowało do kont innych klientów - tych trzeba połączyć osobno (albo innym kontem)."}
          </span>
        </p>
      ) : null}
      {connError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[18px] bg-warning-soft px-4 py-3 text-sm text-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          Nie udało się połączyć {LABEL[connError as Provider] ?? connError}. Spróbuj ponownie.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Meta */}
        <Card className="space-y-4 p-[22px] sm:p-6">
          <ProviderBlock provider="meta_ads" broken={broken.meta_ads} />
          {metaInvalidated ? (
            <p className="text-sm text-ink-2">
              Facebook unieważnił sesję logowania (zmiana hasła albo reset bezpieczeństwa).
              Token zwykłego logowania nie wróci sam - najtrwalej wkleić token{" "}
              <b>System User</b>, który nie zależy od hasła.
            </p>
          ) : null}
          {metaAnchor ? (
            <div className="flex flex-wrap items-center gap-2">
              <ReconnectButton provider="meta_ads" anchor={metaAnchor} label="Połącz ponownie Meta" />
              <Button asChild variant="outline" size="pill">
                <Link href={`/${metaAnchor}/settings#meta-system-token`}>
                  Wklej token System User (nie wygasa)
                </Link>
              </Button>
            </div>
          ) : null}
        </Card>

        {/* Google: one family - Ads and GA4 share the agency's Google login */}
        <Card className="space-y-4 p-[22px] sm:p-6">
          <ProviderBlock provider="google_ads" broken={broken.google_ads} />
          <ProviderBlock provider="ga4" broken={broken.ga4} />
          {testingMode ? (
            <p className="rounded-[16px] bg-warning-soft px-3 py-2 text-sm text-foreground">
              <b>Aplikacja Google jest w trybie Testing - tokeny wygasają po 7 dniach.</b>{" "}
              Napraw: Google Cloud Console → APIs &amp; Services → OAuth consent screen →
              Publish app
              {googleClient?.projectNumber
                ? ` (projekt nr ${googleClient.projectNumber})`
                : ""}
              , potem połącz ponownie.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {shared ? (
              adsAnchor || ga4Anchor ? (
                <ReconnectButton
                  provider={adsAnchor ? "google_ads" : "ga4"}
                  anchor={(adsAnchor ?? ga4Anchor)!}
                  label="Połącz ponownie Google (Ads + GA4)"
                />
              ) : null
            ) : (
              <>
                {adsAnchor ? (
                  <ReconnectButton provider="google_ads" anchor={adsAnchor} label="Połącz ponownie Google Ads" />
                ) : null}
                {ga4Anchor ? (
                  <ReconnectButton provider="ga4" anchor={ga4Anchor} label="Połącz ponownie GA4" />
                ) : null}
              </>
            )}
          </div>
          {!shared && (adsAnchor || ga4Anchor) ? (
            <p className="text-xs text-muted-foreground">
              Google Ads i GA4 mają różne klienty OAuth (GOOGLE_ADS_CLIENT_ID ≠ GA4_CLIENT_ID),
              więc każdy łączy się osobno.
            </p>
          ) : null}
        </Card>
      </div>

      {nothingSelected.length ? <NothingSelectedBlock list={nothingSelected} /> : null}

      {totalBroken === 0 && !nothingSelected.length && !reconnected ? (
        <p className={cn("flex items-center gap-1.5 px-1 text-sm text-muted-foreground")}>
          <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden />
          Wszystkie połączenia Meta i Google działają.
        </p>
      ) : null}
    </section>
  );
}
