import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Uint8Array }[];
};

/**
 * Sends through Resend in production. With EMAIL_DRIVER=console (the default) messages are
 * printed and saved to .data/outbox/ so codes and links can be read during development.
 * Failures are logged, not thrown: a failed notification must not block a visitor.
 */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  const e = env();
  try {
    if (e.EMAIL_DRIVER === "resend") {
      const resend = new Resend(e.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: e.EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content),
        })),
      });
      if (error) throw new Error(error.message);
      return true;
    }
    const dir = path.resolve(".data/outbox");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeTo = msg.to.replace(/[^a-z0-9@._-]/gi, "_");
    await writeFile(path.join(dir, `${stamp}_${safeTo}.html`), `<!-- To: ${msg.to}\nSubject: ${msg.subject} -->\n${msg.html}`);
    console.info(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    return true;
  } catch (err) {
    console.error("[email] send failed", err);
    return false;
  }
}
