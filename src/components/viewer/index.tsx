"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import type { FileKind } from "@/lib/utils";
import { WatermarkOverlay } from "./watermark-overlay";
import { usePageTracker } from "./page-tracker";

const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => <p className="py-20 text-center text-sm text-stone-500">…</p>,
});

export type ViewerLabels = {
  loading: string;
  error: string;
  page: string;
  of: string;
  noPreview: string;
};

export const EN_VIEWER_LABELS: ViewerLabels = {
  loading: "Loading document…",
  error: "This document could not be displayed.",
  page: "Page",
  of: "of",
  noPreview: "A preview is not available for this file type yet.",
};

type Props = {
  kind: FileKind;
  fileUrl: string;
  versionId: string;
  watermark: string | null;
  trackUrl: string | null;
  labels?: ViewerLabels;
};

/** In-browser viewer (FR-91) for PDF, image and video. Other types show a notice. */
export function Viewer({ kind, fileUrl, versionId, watermark, trackUrl, labels = EN_VIEWER_LABELS }: Props) {
  if (kind === "pdf") {
    return <PdfViewer fileUrl={fileUrl} versionId={versionId} watermark={watermark} trackUrl={trackUrl} labels={labels} />;
  }
  if (kind === "image" || kind === "video") {
    return <MediaViewer kind={kind} fileUrl={fileUrl} versionId={versionId} watermark={watermark} trackUrl={trackUrl} />;
  }
  return <p className="rounded-lg bg-white px-6 py-16 text-center text-sm text-stone-600 shadow-sm">{labels.noPreview}</p>;
}

function MediaViewer({
  kind,
  fileUrl,
  versionId,
  watermark,
  trackUrl,
}: {
  kind: "image" | "video";
  fileUrl: string;
  versionId: string;
  watermark: string | null;
  trackUrl: string | null;
}) {
  usePageTracker(
    trackUrl,
    versionId,
    useCallback(() => 1, []),
  );
  return (
    <div className="relative mx-auto w-fit max-w-full overflow-hidden bg-white shadow-sm">
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl} alt="" draggable={false} className="block max-h-[80vh] max-w-full" />
      ) : (
        <video
          src={fileUrl}
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          className="block max-h-[80vh] max-w-full"
        />
      )}
      {watermark && <WatermarkOverlay text={watermark} />}
    </div>
  );
}
