import { ConfirmSubmit } from "@/components/action-form";
import { Badge } from "@/components/ui";
import type { Visitor } from "@/lib/db/schema";
import { setVisitorStatus } from "./actions";

export function visitorStatusBadge(status: Visitor["status"]) {
  if (status === "active") return <Badge tone="green">Active</Badge>;
  if (status === "suspended") return <Badge tone="amber">Suspended</Badge>;
  return <Badge tone="red">Revoked</Badge>;
}

function StatusForm({ id, status, label, message, variant }: { id: string; status: Visitor["status"]; label: string; message: string; variant: "secondary" | "danger" }) {
  return (
    <form action={setVisitorStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <ConfirmSubmit message={message} variant={variant} size="sm">
        {label}
      </ConfirmSubmit>
    </form>
  );
}

export function VisitorStatusControls({ visitor }: { visitor: Pick<Visitor, "id" | "email" | "status"> }) {
  const { id, email, status } = visitor;
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "active" && (
        <StatusForm id={id} status="active" label="Reactivate" variant="secondary" message={`Give ${email} access again?`} />
      )}
      {status === "active" && (
        <StatusForm id={id} status="suspended" label="Suspend" variant="secondary" message={`Pause access for ${email} on every link? You can reactivate later.`} />
      )}
      {status !== "revoked" && (
        <StatusForm id={id} status="revoked" label="Revoke" variant="danger" message={`Revoke ${email}? They lose access to every link immediately.`} />
      )}
    </div>
  );
}
