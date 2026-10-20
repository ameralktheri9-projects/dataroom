import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// FR-61: store a signature record and give the visitor a signed copy.
// The signed copy is the agreement with a signature certificate page appended.

export type SignatureRecord = {
  agreementName: string;
  agreementVersion: number;
  fullName: string;
  email: string;
  company: string | null;
  ip: string | null;
  signedAt: Date;
  signatureId: string;
};

function ascii(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?");
}

export async function buildSignedPdf(agreementPdf: Uint8Array, r: SignatureRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.load(agreementPdf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4
  let y = 770;
  page.drawText("Electronic acceptance certificate", { x: 56, y, size: 18, font: bold });
  y -= 40;
  const rows: [string, string][] = [
    ["Agreement", `${r.agreementName} (version ${r.agreementVersion})`],
    ["Accepted by", r.fullName],
    ["Email", r.email],
    ["Company", r.company ?? "-"],
    ["Date and time (UTC)", r.signedAt.toISOString().replace("T", " ").slice(0, 19)],
    ["IP address", r.ip ?? "-"],
    ["Record ID", r.signatureId],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: 56, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(ascii(value), { x: 200, y, size: 11, font });
    y -= 24;
  }
  y -= 16;
  page.drawText(
    ascii(`${r.fullName} confirmed they read and agree to the agreement above by typing their name and clicking "I agree".`),
    { x: 56, y, size: 9, font, maxWidth: 480, lineHeight: 13, color: rgb(0.3, 0.3, 0.3) },
  );
  return doc.save();
}
