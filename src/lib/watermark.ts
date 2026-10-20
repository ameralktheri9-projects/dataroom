import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

// FR-24: dynamic watermark (email, date/time, IP) on every viewed page and every downloaded file.

export type WatermarkInfo = { email: string | null; ip: string | null; at: Date };

export function watermarkText(w: WatermarkInfo): string {
  const stamp = w.at.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return [w.email ?? "Anonymous visitor", stamp, w.ip].filter(Boolean).join(" · ");
}

// Standard PDF fonts only cover WinAnsi; replace anything else so stamping never throws.
function winAnsiSafe(s: string): string {
  return s.replace(/·/g, "-").replace(/[^\x20-\x7e]/g, "?");
}

async function stamp(doc: PDFDocument, text: string): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const safe = winAnsiSafe(text);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(10, Math.min(width, height) / 32);
    const textWidth = font.widthOfTextAtSize(safe, size);
    // diagonal tiles across the page
    for (let row = 0; row < 4; row++) {
      const y = (height / 4) * row + height / 8;
      page.drawText(safe, {
        x: Math.max(8, (width - textWidth * 0.7) / 2),
        y,
        size,
        font,
        color: rgb(0.45, 0.45, 0.45),
        opacity: 0.22,
        rotate: degrees(30),
      });
    }
    page.drawText(safe, { x: 12, y: 10, size: 7, font, color: rgb(0.4, 0.4, 0.4), opacity: 0.6 });
  }
}

export async function watermarkPdf(bytes: Uint8Array, w: WatermarkInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  await stamp(doc, watermarkText(w));
  return doc.save();
}

/** Images are delivered as a one-page watermarked PDF so the stamp cannot simply be cropped off a layer. */
export async function watermarkImageAsPdf(bytes: Uint8Array, mime: string, w: WatermarkInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  await stamp(doc, watermarkText(w));
  return doc.save();
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}
