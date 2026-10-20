import type { CSSProperties, ReactNode } from "react";
import { Lock } from "lucide-react";
import type { Brand } from "@/lib/db/schema";
import type { Lang, VisitorDict } from "@/lib/i18n/visitor";
import { setLanguage } from "./actions";

/** Branded frame for every visitor page (FR-80, FR-90), with RTL for Arabic. */
export function VisitorShell({
  brand,
  lang,
  t,
  back,
  wide,
  children,
}: {
  brand: Brand;
  lang: Lang;
  t: VisitorDict;
  back: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const style = { "--brand-primary": brand.primaryColor, "--brand-accent": brand.accentColor } as CSSProperties;
  return (
    <div lang={lang} dir={t.dir} style={style} className="flex min-h-screen flex-col bg-stone-50">
      <header className="no-print bg-brand text-white">
        <div className={`mx-auto flex items-center justify-between gap-4 px-4 py-3 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
          <div className="flex min-w-0 items-center gap-3">
            {brand.logoKey ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/api/brand/logo" alt={brand.companyName} className="h-7 w-auto rounded bg-white/90 p-0.5" />
            ) : null}
            <span className="truncate text-sm font-semibold">{brand.companyName}</span>
          </div>
          <form action={setLanguage}>
            <input type="hidden" name="lang" value={lang === "ar" ? "en" : "ar"} />
            <input type="hidden" name="back" value={back} />
            <button className="rounded px-2 py-1 text-sm text-white/90 hover:bg-white/10">{t.switchTo}</button>
          </form>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-8 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</main>
      <footer className="no-print border-t border-stone-200 bg-white">
        <div className={`mx-auto flex items-start gap-2 px-4 py-4 text-xs text-stone-500 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>{t.privacy}</p>
        </div>
      </footer>
    </div>
  );
}

export function GateCard({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-stone-900">{title}</h1>
      {body && <div className="mt-1 text-sm text-stone-600">{body}</div>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
