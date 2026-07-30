// Notification senders. Both channels are best-effort: if the relevant env
// vars are missing the send is skipped (returns false) so the cron degrades
// gracefully until credentials are configured.

export interface AlertItem {
  key: string;
  title: string;
  detail: string;
  scope: string;
  critical?: boolean;
}

// Escape for Telegram/HTML parse mode (only these three matter for HTML mode).
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The dimension-stuffed campaign names ("OLX-PL | BRAND | GOODS | ...") are long;
// keep them readable by collapsing runs of separators and trimming length.
const tidyScope = (s: string) => {
  const clean = s.replace(/\s*\|\s*/g, " · ").trim();
  return clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
};

// Titles sometimes carry a leading status emoji; strip it so our own icon
// tile is the only glyph.
const stripLeadEmoji = (s: string) =>
  s.replace(/^(?:🚨|📈|📊|🔴|🟡|🟢|⬆️|⬇️|🔻|▲|▼)\s*/u, "").trim();

/** Build plaintext + email HTML + Telegram HTML digests (critical first). */
export function buildDigest(clientName: string, items: AlertItem[]) {
  const sorted = [...items].sort(
    (a, b) => Number(Boolean(b.critical)) - Number(Boolean(a.critical))
  );
  const hasCritical = sorted.some((i) => i.critical);

  // Plaintext (WhatsApp / fallback).
  const lines = sorted.map(
    (i) => `${i.critical ? "🚨 " : "• "}${i.title} — ${i.scope}: ${i.detail}`
  );
  const text = `${hasCritical ? "PILNE — " : ""}Alerty dla ${clientName} (${
    sorted.length
  }):\n\n${lines.join("\n")}`;

  // Email HTML - table-based, inline styles (email-client safe): a coloured
  // header band, then one row per alert with an icon tile, title/scope/detail
  // and a severity pill.
  const headerBg = hasCritical ? "#dc2626" : "#4f46e5";
  const rowsHtml = sorted
    .map((i) => {
      const icon = i.critical ? "🚨" : "⚠️";
      const tileBg = i.critical ? "#fee2e2" : "#eef2ff";
      const pillBg = i.critical ? "#dc2626" : "#f59e0b";
      const pillText = i.critical ? "Krytyczny" : "Uwaga";
      return `
        <tr>
          <td style="padding:0 24px">
            <table role="presentation" width="100%" style="border-collapse:collapse">
              <tr>
                <td width="52" valign="top" style="padding:16px 0">
                  <div style="width:38px;height:38px;border-radius:10px;background:${tileBg};text-align:center;line-height:38px;font-size:18px">${icon}</div>
                </td>
                <td valign="top" style="padding:16px 0 16px 12px;border-bottom:1px solid #f1f5f9">
                  <div style="font-weight:700;font-size:15px;color:#0f172a">${esc(stripLeadEmoji(i.title))}</div>
                  <div style="color:#64748b;font-size:12px;margin-top:2px">${esc(tidyScope(i.scope))}</div>
                  <div style="color:#334155;font-size:13px;margin-top:6px;line-height:1.5">${esc(i.detail)}</div>
                </td>
                <td valign="top" align="right" style="padding:16px 0;border-bottom:1px solid #f1f5f9;white-space:nowrap">
                  <span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;color:#ffffff;background:${pillBg}">${pillText}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join("");

  const html = `
  <div style="background:#f1f5f9;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;border-collapse:separate;overflow:hidden">
      <tr>
        <td style="background:${headerBg};padding:22px 24px;color:#ffffff">
          <div style="font-size:19px;font-weight:800;letter-spacing:-0.2px">${hasCritical ? "🚨 PILNE · " : "📊 "}Alerty — ${esc(clientName)}</div>
          <div style="font-size:13px;margin-top:4px;color:#ffffff;opacity:0.9">${sorted.length} ${sorted.length === 1 ? "rzecz wymaga" : "rzeczy wymaga"} uwagi</div>
        </td>
      </tr>
      ${rowsHtml}
      <tr>
        <td style="padding:16px 24px;text-align:center;color:#94a3b8;font-size:12px;border-top:1px solid #f1f5f9">
          Wysłane automatycznie przez panel · patoagencja
        </td>
      </tr>
    </table>
  </div>`;

  // Telegram HTML (parse_mode=HTML): compact, scannable. Two lines per item -
  // bold title (already carries the key number) + dimmed short campaign name.
  // The full sentence lives in the email/panel; on a phone it's just noise.
  const TG_MAX = 10;

  const tgHeader = hasCritical
    ? `🚨 <b>PILNE - Alerty ${esc(clientName)}</b>`
    : `📊 <b>Alerty - ${esc(clientName)}</b>`;

  const tgBody = sorted
    .slice(0, TG_MAX)
    .map((i) => {
      const icon = i.critical ? "🔴" : "🟡";
      const scope = tidyScope(i.scope);
      const scopeLine =
        scope && scope !== "Całe konto"
          ? `\n<i>${esc(scope)}</i>`
          : scope === "Całe konto"
            ? `\n<i>Całe konto</i>`
            : "";
      return `${icon} <b>${esc(stripLeadEmoji(i.title))}</b>${scopeLine}`;
    })
    .join("\n\n");

  const more = sorted.length > TG_MAX ? `\n\n… i ${sorted.length - TG_MAX} więcej` : "";
  const telegram = `${tgHeader}  ·  ${sorted.length}\n\n${tgBody}${more}`;

  return { text, html, telegram };
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Send an email via Resend. Needs RESEND_API_KEY + NOTIFY_FROM_EMAIL. */
export async function sendEmail(
  to: string[],
  subject: string,
  html: string
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  if (!key) return { ok: false, error: "Brak RESEND_API_KEY (dodaj na Vercelu + redeploy)" };
  if (!from) return { ok: false, error: "Brak NOTIFY_FROM_EMAIL (dodaj na Vercelu + redeploy)" };
  if (to.length === 0) return { ok: false, error: "Brak adresów odbiorców w panelu" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[notify] resend failed", res.status, body);
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Send a WhatsApp message via the Cloud API. Needs WHATSAPP_TOKEN +
 * WHATSAPP_PHONE_NUMBER_ID. Uses a plain text message (works inside a 24h
 * session / with test numbers); proactive delivery to new numbers requires an
 * approved template — swap `type:text` for `type:template` once one exists.
 */
export async function sendWhatsApp(
  numbers: string[],
  text: string
): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token) return { ok: false, error: "Brak WHATSAPP_TOKEN" };
  if (!phoneId) return { ok: false, error: "Brak WHATSAPP_PHONE_NUMBER_ID" };
  if (numbers.length === 0) return { ok: false, error: "Brak numerów odbiorców" };

  let anyOk = false;
  for (const to of numbers) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to.replace(/[^\d]/g, ""),
            type: "text",
            text: { body: text },
          }),
          cache: "no-store",
        }
      );
      if (res.ok) anyOk = true;
      else
        console.error(
          "[notify] whatsapp failed",
          to,
          res.status,
          await res.text().catch(() => "")
        );
    } catch (err) {
      console.error("[notify] whatsapp error", to, err);
    }
  }
  return { ok: anyOk, error: anyOk ? undefined : "Wysyłka WhatsApp nie powiodła się" };
}

/**
 * Send a Telegram message via the Bot API. Needs TELEGRAM_BOT_TOKEN and at least
 * one chat id (personal chat or a group the bot was added to). Free, instant,
 * and works proactively with no template/verification - ideal for urgent
 * budget-spike alerts.
 */
export async function sendTelegram(
  chatIds: string[],
  text: string
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token)
    return { ok: false, error: "Brak TELEGRAM_BOT_TOKEN (dodaj na Vercelu + redeploy)" };
  if (chatIds.length === 0)
    return { ok: false, error: "Brak chat ID w panelu" };

  let anyOk = false;
  const errors: string[] = [];
  for (const chatId of chatIds) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId.trim(),
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
          cache: "no-store",
        }
      );
      if (res.ok) anyOk = true;
      else {
        const body = await res.text().catch(() => "");
        errors.push(`${chatId}: ${res.status} ${body.slice(0, 120)}`);
        console.error("[notify] telegram failed", chatId, res.status, body);
      }
    } catch (err) {
      errors.push(`${chatId}: ${String(err)}`);
      console.error("[notify] telegram error", chatId, err);
    }
  }
  return {
    ok: anyOk,
    error: anyOk ? undefined : errors.join(" · ") || "Wysyłka Telegram nie powiodła się",
  };
}
