import Link from "next/link";
import { count, countDistinct, desc, eq, isNull, max } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatDate, timeAgo } from "@/lib/utils";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { linkStatusBadge } from "./status";

export const metadata = { title: "Links" };

export default async function LinksPage() {
  const user = await requireUser();
  const db = await getDb();

  const links = await db
    .select({
      link: schema.links,
      creator: schema.users.name,
      visits: count(schema.visits.id),
      visitors: countDistinct(schema.visits.visitorId),
      lastVisit: max(schema.visits.startedAt),
    })
    .from(schema.links)
    .leftJoin(schema.users, eq(schema.users.id, schema.links.createdBy))
    .leftJoin(schema.visits, eq(schema.visits.linkId, schema.links.id))
    .where(isNull(schema.links.deletedAt))
    .groupBy(schema.links.id, schema.users.name)
    .orderBy(desc(schema.links.createdAt));

  return (
    <>
      <PageHeader
        title="Links"
        description="Each link opens only the files and folders you chose for it."
        actions={can(user.role, "links.create") ? <LinkButton href="/links/new">New link</LinkButton> : null}
      />
      <Card>
        {links.length === 0 ? (
          <EmptyState title="No links yet">Share a file or folder from Documents, or create a link here.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Protection</Th>
                <Th className="text-right">Visits</Th>
                <Th className="text-right">Visitors</Th>
                <Th>Last visit</Th>
                <Th>Expires</Th>
              </tr>
            </thead>
            <tbody>
              {links.map(({ link, creator, visits, visitors, lastVisit }) => {
                const s = link.settings;
                const tags = [
                  s.audience === "anyone" ? "Public" : s.verifyEmail ? "Verified email" : "Email",
                  s.allowList && "Allow list",
                  s.requirePassword && "Password",
                  s.requireNda && "NDA",
                  s.requireApproval && "Approval",
                  s.watermark && "Watermark",
                ].filter(Boolean) as string[];
                return (
                  <tr key={link.id} className="hover:bg-stone-50">
                    <Td>
                      <Link href={`/links/${link.id}`} className="font-medium hover:underline">
                        {link.name}
                      </Link>
                      <p className="text-xs text-stone-500">by {creator ?? "—"}</p>
                    </Td>
                    <Td>{linkStatusBadge(link)}</Td>
                    <Td>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {tags.map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{visits}</Td>
                    <Td className="text-right tabular-nums">{visitors}</Td>
                    <Td className="text-stone-500">{timeAgo(lastVisit)}</Td>
                    <Td className="text-stone-500">{link.expiresAt ? formatDate(link.expiresAt) : "Never"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
