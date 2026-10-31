/** ตรวจ id token จาก LIFF — คืน LINE user ID เมื่อของแท้ */

const LINE_VERIFY = "https://api.line.me/oauth2/v2.1/verify";
const LINE_USER_ID = /^U[0-9a-f]{32}$/i;

function lineLoginChannelId() {
  return (
    process.env.LINE_LOGIN_CHANNEL_ID?.trim() ||
    process.env.NUXT_PUBLIC_LINE_LIFF_ID?.split("-")[0] ||
    "2012019273"
  );
}

export async function verifyLineIdToken(
  idToken: string | undefined | null,
): Promise<string | null> {
  const token = String(idToken ?? "").trim();
  if (!token || token.length < 20) return null;
  const clientId = lineLoginChannelId();
  if (!clientId) return null;
  try {
    const res = await fetch(LINE_VERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: token,
        client_id: clientId,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sub?: unknown };
    const sub = String(data.sub ?? "").trim();
    return LINE_USER_ID.test(sub) ? sub : null;
  } catch {
    return null;
  }
}
