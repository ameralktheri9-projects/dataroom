"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { WatermarkOverlay } from "./watermark-overlay";
import { usePageTracker } from "./page-tracker";

// Served from /public (copied on install) so the worker loads from our own origin.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type Props = {
  fileUrl: string;
  versionId: string;
  watermark: string | null;
  trackUrl: string | null;
  labels: { loading: string; error: string; page: string; of: string };
};

export default function PdfViewer({ fileUrl, versionId, watermark, trackUrl, labels }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [numPages, setNumPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [nearby, setNearby] = useState<Set<number>>(new Set([1, 2, 3]));
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const ratios = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.min(900, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Which page is "current" (most visible) and which pages are close enough to render.
  useEffect(() => {
    if (!numPages) return;
    const visible = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.current.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
        let best = 1;
        let bestRatio = -1;
        for (const [p, r] of ratios.current) {
          if (r > bestRatio) {
            best = p;
            bestRatio = r;
          }
        }
        setCurrent(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    const near = new IntersectionObserver(
      (entries) => {
        setNearby((prev) => {
          const next = new Set(prev);
          for (const e of entries) if (e.isIntersecting) next.add(Number((e.target as HTMLElement).dataset.page));
          return next;
        });
      },
      { rootMargin: "1500px 0px" },
    );
    for (const el of pageEls.current.values()) {
      visible.observe(el);
      near.observe(el);
    }
    return () => {
      visible.disconnect();
      near.disconnect();
    };
  }, [numPages]);

  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  usePageTracker(
    trackUrl,
    versionId,
    useCallback(() => currentRef.current, []),
  );

  const pageHeight = Math.round(width * 1.294); // A4 placeholder until the page renders

  return (
    <div ref={container} className="mx-auto w-full max-w-[900px]">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={<p className="py-20 text-center text-sm text-stone-500">{labels.loading}</p>}
        error={<p className="py-20 text-center text-sm text-red-700">{labels.error}</p>}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            data-page={n}
            ref={(el) => {
              if (el) pageEls.current.set(n, el);
              else pageEls.current.delete(n);
            }}
            className="relative mb-4 overflow-hidden bg-white shadow-sm"
            style={{ minHeight: nearby.has(n) ? undefined : pageHeight }}
          >
            {nearby.has(n) && (
              <Page
                pageNumber={n}
                width={width}
                renderTextLayer={false} // no selectable text layer: discourages copy-paste
                renderAnnotationLayer={false}
              />
            )}
            {watermark && <WatermarkOverlay text={watermark} />}
          </div>
        ))}
      </Document>
      {numPages > 0 && (
        <div className="no-print sticky bottom-3 mx-auto w-fit rounded-full bg-stone-900/80 px-3 py-1 text-xs text-white tabular-nums">
          {labels.page} {current} {labels.of} {numPages}
        </div>
      )}
    </div>
  );
}
