// Notification senders. Both channels are best-effort: if the relevant env
// vars are missing the send is skipped (returns false) so the cron degrades
// gracefully until credentials are configured.

export interface AlertItem {
  key: string;
  title: string;
  detail: string;
  scope: string;
}

/** Build a short plaintext + HTML digest from alert items. */
export function buildDigest(clientName: string, items: AlertItem[]) {
  const lines = items.map((i) => `• ${i.title} — ${i.scope}: ${i.detail}`);
  const text = `Alerty dla ${clientName} (${items.length}):\n\n${lines.join("\n")}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
      <h2 style="margin:0 0 4px">Alerty — ${clientName}</h2>
      <p style="margin:0 0 16px;color:#64748b">${items.length} rzeczy wymaga uwagi</p>
      <ul style="padding-left:18px">
        ${items
          .map(
            (i) =>
              `<li style="margin-bottom:10px"><strong>${i.title}</strong><br/>
               <span style="color:#64748b">${i.scope}</span> — ${i.detail}</li>`
          )
          .join("")}
      </ul>
    </div>`;
  return { text, html };
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
