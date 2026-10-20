"use client";

import { useEffect, useRef } from "react";

// Accumulates seconds per page while the page is actually visible and the tab focused,
// then flushes to trackUrl every 10s and when the visitor leaves (FR-50).

export function usePageTracker(trackUrl: string | null, versionId: string, currentPage: () => number) {
  const pending = useRef<Record<number, number>>({});
  const pageRef = useRef(currentPage);
  useEffect(() => {
    pageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    if (!trackUrl) return;
    const url = trackUrl;

    function flush(useBeacon: boolean) {
      const pages = pending.current;
      if (!Object.keys(pages).length) return;
      pending.current = {};
      const body = JSON.stringify({ versionId, pages });
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } else {
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {
          // put the time back so the next flush retries it
          for (const [p, s] of Object.entries(JSON.parse(body).pages as Record<string, number>)) {
            pending.current[Number(p)] = (pending.current[Number(p)] ?? 0) + s;
          }
        });
      }
    }

    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      const p = pageRef.current();
      if (p > 0) pending.current[p] = (pending.current[p] ?? 0) + 1;
    }, 1000);
    const flusher = setInterval(() => flush(false), 10_000);
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);

    return () => {
      clearInterval(tick);
      clearInterval(flusher);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush(true);
    };
  }, [trackUrl, versionId]);
}
