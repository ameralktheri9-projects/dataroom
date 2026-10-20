"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// FR-25 screenshot deterrence. A browser cannot stop screenshots or phone photos; this makes casual
// capture harder and, with the watermark, makes any leak traceable. (BRD risk: deterrence ≠ prevention.)
export function Protection({ enabled, children, message }: { enabled: boolean; children: ReactNode; message: string }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    document.body.dataset.protected = "true";

    const hide = () => setHidden(true);
    const show = () => setHidden(document.visibilityState !== "visible");
    const onVisibility = () => setHidden(document.visibilityState !== "visible");

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === "PrintScreen") {
        navigator.clipboard?.writeText("").catch(() => undefined);
        setHidden(true);
        setTimeout(() => setHidden(false), 1500);
        e.preventDefault();
      }
      // print, save, copy, select-all, view-source; macOS screenshot shortcuts (cmd+shift+3/4/5)
      if ((mod && ["p", "s", "c", "a", "u"].includes(k)) || (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(k))) {
        e.preventDefault();
        if (e.shiftKey) setHidden(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") navigator.clipboard?.writeText("").catch(() => undefined);
    };
    const block = (e: Event) => e.preventDefault();

    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.addEventListener("dragstart", block);
    window.addEventListener("beforeprint", hide);

    return () => {
      delete document.body.dataset.protected;
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.removeEventListener("dragstart", block);
      window.removeEventListener("beforeprint", hide);
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;
  return (
    <div className="relative" data-protected="true">
      <div className={cn(hidden && "protected-blur")}>{children}</div>
      {hidden && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-6 text-center text-sm text-white">
          {message}
        </div>
      )}
    </div>
  );
}
