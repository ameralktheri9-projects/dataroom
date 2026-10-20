import { and, asc, gt, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { assignableRoles, ROLE_LABELS } from "@/lib/permissions";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { inviteMember, revokeInvite, updateMember } from "../actions";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const me = await requireUser("workspace.manage");
  const db = await getDb();
  const users = await db.select().from(schema.users).orderBy(asc(schema.users.createdAt));
  const invites = await db
    .select()
    .from(schema.invites)
    .where(and(isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .orderBy(asc(schema.invites.createdAt));
  const roles = assignableRoles(me.role);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Invite a team member</h2>
        <ActionForm action={inviteMember} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue="editor">
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton pendingText="Sending…">Send invite</SubmitButton>
        </ActionForm>
        <p className="mt-3 text-xs text-stone-500">
          Admin: everything except deleting the workspace. Editor: documents, links, questions, contacts. Viewer: read-only analytics.
        </p>
      </Card>

      <Card>
        <CardHeader title="Members" />
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>2FA</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              <Th className="sr-only">Manage</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const manageable = u.id !== me.id && u.role !== "owner" && roles.includes(u.role);
              return (
                <tr key={u.id} className="align-top">
                  <Td>
                    <p className="font-medium">
                      {u.name} {u.id === me.id && <span className="text-xs text-stone-500">(you)</span>}
                    </p>
                    <p className="text-xs text-stone-500">{u.email}</p>
                  </Td>
                  <Td>{ROLE_LABELS[u.role]}</Td>
                  <Td>{u.twoFactorEnabled ? <Badge tone="green">On</Badge> : <Badge tone="amber">Not set</Badge>}</Td>
                  <Td>{u.status === "active" ? <Badge tone="green">Active</Badge> : <Badge>{u.status}</Badge>}</Td>
                  <Td className="text-stone-500">{timeAgo(u.lastLoginAt)}</Td>
                  <Td>
                    {manageable && (
                      <form action={updateMember} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={u.id} />
                        <Select name="role" defaultValue={u.role} className="h-8 w-28 text-xs" aria-label="Role">
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                        <Select name="status" defaultValue={u.status === "disabled" ? "disabled" : "active"} className="h-8 w-28 text-xs" aria-label="Status">
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                        </Select>
                        <label className="flex items-center gap-1 text-xs text-stone-600">
                          <input type="checkbox" name="reset2fa" /> Reset 2FA
                        </label>
                        <ConfirmSubmit message={`Apply changes to ${u.email}?`} variant="secondary" size="sm">
                          Apply
                        </ConfirmSubmit>
                      </form>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader title="Pending invitations" />
          <ul className="divide-y divide-stone-100">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  {i.email} · {ROLE_LABELS[i.role]} <span className="text-xs text-stone-500">· expires {formatDateTime(i.expiresAt)}</span>
                </span>
                <form action={revokeInvite}>
                  <input type="hidden" name="id" value={i.id} />
                  <ConfirmSubmit message={`Cancel the invitation for ${i.email}?`} variant="ghost" size="sm">
                    Cancel
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
