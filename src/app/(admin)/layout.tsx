import { and, count, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { getBrand } from "@/lib/workspace";
import { ROLE_LABELS } from "@/lib/permissions";
import { logout } from "@/app/(auth)/actions";
import { NavLinks } from "./nav-links";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brand = await getBrand();
  const db = await getDb();
  const [{ pending }] = await db
    .select({ pending: count() })
    .from(schema.accessRequests)
    .where(and(eq(schema.accessRequests.status, "pending")));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="no-print flex shrink-0 flex-col border-b border-stone-200 bg-white md:w-56 md:border-r md:border-b-0">
        <div className="px-5 py-4">
          <p className="truncate text-sm font-semibold text-stone-900">{brand.companyName}</p>
          <p className="text-xs text-stone-500">Data Room</p>
        </div>
        <NavLinks pendingRequests={pending} />
        <div className="mt-auto hidden border-t border-stone-200 px-5 py-4 md:block">
          <p className="truncate text-sm text-stone-800">{user.name}</p>
          <p className="truncate text-xs text-stone-500">
            {user.email} · {ROLE_LABELS[user.role]}
          </p>
          <form action={logout} className="mt-2">
            <button className="text-xs text-stone-500 hover:text-stone-900 hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
