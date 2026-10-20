import { NextResponse } from "next/server";
import { userCan } from "@/lib/auth/session";
import { analytics, parseFilters, toCsv } from "@/lib/analytics";
import { audit } from "@/lib/audit";

// FR-56 (export): CSV opens directly in Excel. A formatted PDF report is planned for Phase 2.
export async function GET(req: Request) {
  const user = await userCan("analytics.view");
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const data = await analytics(parseFilters(sp), 50_000);

  const rows = [
    ["Visit ID", "Visitor email", "Link", "Started (UTC)", "Last activity (UTC)", "Documents", "Seconds viewed", "Downloads", "Device", "Country", "IP"],
    ...data.visits.map((v) => [
      v.visit.id,
      v.visitorEmail ?? "anonymous",
      v.linkName,
      v.visit.startedAt.toISOString(),
      v.visit.endedAt?.toISOString() ?? "",
      v.documents,
      v.seconds,
      v.downloads,
      v.visit.device,
      v.visit.country,
      v.visit.ip,
    ]),
  ];
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "analytics.export", metadata: { filters: sp, rows: data.visits.length } });
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="analytics-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
