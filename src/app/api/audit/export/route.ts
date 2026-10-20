import { NextResponse } from "next/server";
import { userCan } from "@/lib/auth/session";
import { parseAuditFilters, queryAudit } from "@/lib/audit-query";
import { toCsv } from "@/lib/analytics";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const user = await userCan("analytics.view");
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await queryAudit(parseAuditFilters(sp), 100_000);
  const csv = toCsv([
    ["Time (UTC)", "Actor type", "Actor", "Actor ID", "Action", "Target type", "Target ID", "Details", "IP"],
    ...rows.map((e) => [
      e.createdAt.toISOString(),
      e.actorType,
      e.actorLabel,
      e.actorId,
      e.action,
      e.targetType,
      e.targetId,
      e.metadata ? JSON.stringify(e.metadata) : "",
      e.ip,
    ]),
  ]);
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "audit.export", metadata: { filters: sp, rows: rows.length } });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
