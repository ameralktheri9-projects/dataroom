import { Badge } from "@/components/ui";
import type { Link } from "@/lib/db/schema";

export function linkStatusBadge(link: Pick<Link, "status" | "expiresAt" | "deletedAt">) {
  if (link.deletedAt) return <Badge tone="red">Deleted</Badge>;
  if (link.status === "disabled") return <Badge>Disabled</Badge>;
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return <Badge tone="amber">Expired</Badge>;
  return <Badge tone="green">Active</Badge>;
}
