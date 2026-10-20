"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/settings", label: "Brand" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/agreements", label: "Agreements" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="mb-6 flex gap-1 border-b border-stone-200">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            path === t.href ? "border-stone-900 font-medium text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
