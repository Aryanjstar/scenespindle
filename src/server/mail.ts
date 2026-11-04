/**
 * Mail adapter. Resend over HTTPS when RESEND_API_KEY and MAIL_FROM are set;
 * otherwise mail is "not configured" and callers fall back to copy-a-link flows.
 * Message bodies are never logged.
 */
export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail(to: string, subject: string, text: string): Promise<"sent" | "not_configured" | "failed"> {
  if (!mailConfigured()) return "not_configured";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error("mail-failed", response.status);
      return "failed";
    }
    return "sent";
  } catch {
    console.error("mail-failed", "network");
    return "failed";
  }
}
