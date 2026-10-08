// The login-link e-mail, sent by the app itself (Resend) instead of
// Supabase's plain default. Table layout and inline styles: e-mail clients
// ignore <style> blocks and most modern CSS. Import-free (unit tests).

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildLoginEmail({
  link,
  email,
  minutesValid = 60,
}: {
  link: string;
  email: string;
  minutesValid?: number;
}): { subject: string; html: string; text: string } {
  const href = esc(link);
  const valid = minutesValid >= 60 && minutesValid % 60 === 0 ? `${minutesValid / 60} godz.` : `${minutesValid} min`;
  const subject = "Twój link do panelu Kaleido";
  const text = [
    "Zaloguj się do panelu Kaleido:",
    link,
    "",
    `Link działa ${valid} i tylko raz. Jeśli to nie Ty prosiłeś o logowanie, zignoruj tę wiadomość - bez kliknięcia nikt nie wejdzie na Twoje konto.`,
    "",
    "Kaleido · patoagencja",
  ].join("\n");

  const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f2ee;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Kliknij, aby zalogować się do panelu - link działa ${esc(valid)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e6e4dd;border-radius:24px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <tr>
          <td style="background:#16171a;padding:28px 32px 26px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:20px;font-weight:700;letter-spacing:-0.3px;color:#ffffff">Kaleido</td>
              <td align="right" style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#a9d97a">panel klienta</td>
            </tr></table>
            <div style="height:3px;width:56px;margin-top:18px;border-radius:3px;background:#a9d97a"></div>
          </td>
        </tr>
        <tr>
          <td style="padding:34px 32px 8px">
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.4px;color:#16171a">Zaloguj się jednym kliknięciem</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:#4a4b50">Ktoś (mamy nadzieję, że Ty) poprosił o link do panelu dla adresu <b style="color:#16171a">${esc(email)}</b>. Bez hasła - wystarczy kliknąć.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 32px 8px">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="border-radius:999px;background:#16171a">
                <a href="${href}" style="display:inline-block;padding:15px 30px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">Otwórz panel &rarr;</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px 6px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8f1;border-radius:16px">
              <tr><td style="padding:14px 18px;font-size:13px;line-height:1.55;color:#4a4b50">
                Link działa <b style="color:#16171a">${esc(valid)}</b> i&nbsp;tylko raz. Możesz go otworzyć na telefonie albo komputerze.
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 30px">
            <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#8a8b90">Przycisk nie działa? Skopiuj ten adres do przeglądarki:</p>
            <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all"><a href="${href}" style="color:#4d7a22;text-decoration:underline">${href}</a></p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #eeece6;padding:18px 32px 22px;font-size:12px;line-height:1.55;color:#8a8b90">
            Nie prosiłeś o logowanie? Zignoruj tę wiadomość - bez kliknięcia w link nikt nie wejdzie na Twoje konto.<br>
            <span style="color:#b0b1b5">Kaleido · przygotowane przez patoagencja</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
