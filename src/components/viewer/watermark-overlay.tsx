// Tiled, diagonal watermark drawn over each page. pointer-events:none so it never blocks reading.
export function WatermarkOverlay({ text }: { text: string }) {
  const rows = Array.from({ length: 8 });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none">
      <div className="absolute -inset-1/2 flex rotate-[-30deg] flex-col justify-around">
        {rows.map((_, i) => (
          <div key={i} className="flex justify-around gap-16 whitespace-nowrap">
            {Array.from({ length: 4 }).map((__, j) => (
              <span key={j} className="text-[13px] font-medium text-stone-500/25 md:text-base">
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
