// Google Slides + Drive integration for monthly report automation. Reuses the
// GA4 OAuth app (same client id/secret) with Slides/Drive scopes; the refresh
// token is stored per client in `integrations` under provider google_slides.
//
// Fill model: templates are Slides files where every number that changes month
// to month is a {{token}}. Each run copies the template (Drive files.copy)
// and calls presentations.batchUpdate with replaceAllText per token.
import { google } from "googleapis";

function clientId(): string {
  return process.env.GA4_CLIENT_ID!;
}
function clientSecret(): string {
  return process.env.GA4_CLIENT_SECRET!;
}
function redirectUri(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/google-slides/callback`;
}

function authedClient(refreshToken: string) {
  const oauth = new google.auth.OAuth2(clientId(), clientSecret(), redirectUri());
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}

/** OAuth consent URL - Slides (edit) + Drive (copy files / list folders). */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/presentations",
      "https://www.googleapis.com/auth/drive",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  refresh_token: string;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok || !body.refresh_token) {
    console.error("[google-slides] token exchange error", {
      status: res.status,
      error: body?.error,
      error_description: body?.error_description,
    });
    throw new Error(
      body?.error_description ??
        "Slides token exchange failed (no refresh_token returned)"
    );
  }
  return { refresh_token: body.refresh_token };
}

/** Copy a Slides template into `folderId` (or the template's folder). */
export async function copyPresentation(
  refreshToken: string,
  templateId: string,
  newName: string,
  folderId?: string | null
): Promise<{ id: string; url: string }> {
  const drive = google.drive({ version: "v3", auth: authedClient(refreshToken) });
  const res = await drive.files.copy({
    fileId: templateId,
    requestBody: {
      name: newName,
      ...(folderId ? { parents: [folderId] } : {}),
    },
    supportsAllDrives: true,
  });
  const id = res.data.id!;
  return { id, url: `https://docs.google.com/presentation/d/${id}/edit` };
}

/**
 * Replace {{token}} placeholders across the whole deck. Values are plain
 * strings - format numbers before calling. Runs as one batchUpdate so the
 * deck is never observable half-filled.
 */
export async function fillPlaceholders(
  refreshToken: string,
  presentationId: string,
  values: Record<string, string>
): Promise<number> {
  const slides = google.slides({ version: "v1", auth: authedClient(refreshToken) });
  const requests = Object.entries(values).map(([token, value]) => ({
    replaceAllText: {
      containsText: { text: `{{${token}}}`, matchCase: false },
      replaceText: value,
    },
  }));
  if (!requests.length) return 0;
  const res = await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests },
  });
  return (
    res.data.replies?.reduce(
      (a, r) => a + (r.replaceAllText?.occurrencesChanged ?? 0),
      0
    ) ?? 0
  );
}

/**
 * List every distinct {{token}} present in a deck - lets the UI/debug show
 * which placeholders a template expects (and which we don't provide).
 */
export async function listPlaceholders(
  refreshToken: string,
  presentationId: string
): Promise<string[]> {
  const slides = google.slides({ version: "v1", auth: authedClient(refreshToken) });
  const res = await slides.presentations.get({ presentationId });
  const found = new Set<string>();
  const scan = (text?: string | null) => {
    for (const m of (text ?? "").matchAll(/\{\{([a-zA-Z0-9_.-]+)\}\}/g)) {
      found.add(m[1]);
    }
  };
  for (const page of res.data.slides ?? []) {
    for (const el of page.pageElements ?? []) {
      for (const t of el.shape?.text?.textElements ?? []) scan(t.textRun?.content);
      for (const row of el.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          for (const t of cell.text?.textElements ?? []) scan(t.textRun?.content);
        }
      }
    }
  }
  return [...found].sort();
}
