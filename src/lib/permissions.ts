import type { Role } from "@/lib/db/schema";

// BRD §4 — user roles and permissions.
export const PERMISSIONS = {
  "documents.edit": ["owner", "admin", "editor"],
  "links.create": ["owner", "admin", "editor"],
  "links.settings": ["owner", "admin", "editor"],
  "questions.answer": ["owner", "admin", "editor"],
  "requests.decide": ["owner", "admin"],
  "visitors.manage": ["owner", "admin"],
  "analytics.view": ["owner", "admin", "editor", "viewer"],
  "updates.send": ["owner", "admin"],
  "contacts.manage": ["owner", "admin", "editor"],
  "workspace.manage": ["owner", "admin"], // team, brand, agreements, security
  "workspace.delete": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

/** Roles a member may hand out when inviting or editing someone. Only the owner creates admins. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["admin", "editor", "viewer"];
  if (actor === "admin") return ["editor", "viewer"];
  return [];
}
