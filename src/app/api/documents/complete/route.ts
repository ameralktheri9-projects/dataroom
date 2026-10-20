import { NextResponse } from "next/server";
import { userCan } from "@/lib/auth/session";
import { readTicket, recordUpload } from "@/lib/documents";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const user = await userCan("documents.edit");
  if (!user) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const { ticket } = (await req.json().catch(() => ({}))) as { ticket?: string };
  const t = ticket ? readTicket(ticket) : null;
  if (!t || t.userId !== user.id) return NextResponse.json({ error: "Upload expired. Try again." }, { status: 400 });

  try {
    const { documentId, version } = await recordUpload(t);
    await audit({
      actor: { type: "user", id: user.id, label: user.email },
      action: version.versionNumber > 1 ? "document.new_version" : "document.upload",
      targetType: "document",
      targetId: documentId,
      metadata: { name: t.name, version: version.versionNumber, size: t.size },
    });
    return NextResponse.json({ documentId, versionId: version.id });
  } catch (err) {
    console.error("[upload] complete failed", err);
    return NextResponse.json({ error: `${t.name}: upload could not be saved.` }, { status: 500 });
  }
}
