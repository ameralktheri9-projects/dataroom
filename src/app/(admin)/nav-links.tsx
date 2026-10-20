"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Home, Link2, ScrollText, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/links", label: "Links", icon: Link2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/visitors", label: "Visitors", icon: Users },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function NavLinks({ pendingRequests }: { pendingRequests: number }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
              active ? "bg-stone-100 font-medium text-stone-900" : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {href === "/" && pendingRequests > 0 && (
              <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800">{pendingRequests}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
