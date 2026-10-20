"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui";

type Item = { file: File; path: string[] };
type Progress = { name: string; status: "uploading" | "done" | "error"; message?: string };

// Walks a dropped directory (FR-10: upload files and folders by drag-and-drop).
async function entriesToItems(entry: FileSystemEntry, path: string[]): Promise<Item[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return [{ file, path }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries returns batches; keep reading until empty
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((c) => entriesToItems(c, [...path, entry.name])));
  return nested.flat();
}

async function uploadOne(item: Item, folderId: string | null, documentId: string | null) {
  const res = await fetch("/api/documents/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: item.file.name,
      type: item.file.type,
      size: item.file.size,
      folderId,
      path: item.path,
      documentId,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  const put = await fetch(data.url, { method: "PUT", headers: data.headers, body: item.file });
  if (!put.ok) throw new Error("Upload to storage failed");
  const done = await fetch("/api/documents/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: data.ticket }),
  });
  const doneData = await done.json();
  if (!done.ok) throw new Error(doneData.error ?? "Upload failed");
}

export function Uploader({
  folderId,
  documentId = null,
  compact = false,
}: {
  folderId: string | null;
  documentId?: string | null; // set to upload a new version of this document
  compact?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<Progress[]>([]);
  const busy = progress.some((p) => p.status === "uploading");

  async function run(items: Item[]) {
    if (documentId) items = items.slice(0, 1);
    setProgress(items.map((i) => ({ name: [...i.path, i.file.name].join("/"), status: "uploading" })));
    // a few at a time keeps folder creation ordered enough and doesn't flood storage
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const i = index++;
        try {
          await uploadOne(items[i], folderId, documentId);
          setProgress((p) => p.map((x, j) => (j === i ? { ...x, status: "done" } : x)));
        } catch (err) {
          setProgress((p) => p.map((x, j) => (j === i ? { ...x, status: "error", message: (err as Error).message } : x)));
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    router.refresh();
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[];
    const items = entries.length
      ? (await Promise.all(entries.map((en) => entriesToItems(en, [])))).flat()
      : [...e.dataTransfer.files].map((file) => ({ file, path: [] }));
    // the dropped folder itself becomes a folder: entriesToItems puts its name in path already
    if (items.length) run(items);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors",
          compact ? "px-4 py-4" : "px-6 py-8",
          over ? "border-accent bg-blue-50" : "border-stone-300 bg-white",
        )}
      >
        <Upload className="size-5 text-stone-400" aria-hidden />
        <p className="text-sm text-stone-600">
          {documentId ? "Drop a file here to upload a new version" : "Drop files or folders here"}
        </p>
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => input.current?.click()} disabled={busy}>
          Choose {documentId ? "file" : "files"}
        </button>
        <input
          ref={input}
          type="file"
          multiple={!documentId}
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) run(files.map((file) => ({ file, path: [] })));
          }}
        />
      </div>
      {progress.length > 0 && (
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
          {progress.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span className="truncate text-stone-700">{p.name}</span>
              <span
                className={cn(
                  "shrink-0 text-xs",
                  p.status === "done" && "text-emerald-700",
                  p.status === "error" && "text-red-700",
                  p.status === "uploading" && "text-stone-500",
                )}
              >
                {p.status === "uploading" ? "Uploading…" : p.status === "done" ? "Done" : p.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
