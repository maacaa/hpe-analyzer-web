import { useEffect, useRef, useState } from "react";

/**
 * Lightweight windowed list: only renders rows visible in the viewport, so
 * very large logs (hundreds of thousands of entries) stay responsive.
 * The visible range is clamped to the current item count so a shrinking list
 * (e.g. after filtering) never indexes out of bounds.
 *
 * Optional `onNearEnd` fires whenever the viewport reaches (or passes) the
 * end of the loaded items — used by the worker-paginated log tabs to fetch
 * the next page.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  render,
  overscan = 10,
  onNearEnd,
}: {
  items: T[];
  rowHeight: number;
  render: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  onNearEnd?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });
  const nearEndRef = useRef(onNearEnd);
  nearEndRef.current = onNearEnd;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const height = el.clientHeight;
      // When the list shrinks (e.g. filtering), a stale scrollTop would leave
      // the viewport clamped to the (now empty) tail. Clamp it back into range
      // so the visible window maps to the remaining rows.
      const maxTop = Math.max(0, items.length * rowHeight - height);
      if (el.scrollTop > maxTop) {
        el.scrollTop = maxTop;
      }
      const top = el.scrollTop;
      const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const end = Math.min(
        items.length,
        Math.ceil((top + height) / rowHeight) + overscan
      );
      setRange({ start, end });
      if (end >= items.length) nearEndRef.current?.();
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [items.length, rowHeight, overscan]);

  // Clamp the stored range to the current list size (guards against a stale
  // range after filtering / clearing the list).
  const start = Math.min(range.start, Math.max(0, items.length - 1));
  const end = Math.min(range.end, items.length);

  const rows = [];
  for (let i = start; i < end; i++) {
    const item = items[i];
    if (item === undefined) continue;
    rows.push(
      <div
        key={i}
        className="vrow"
        style={{ position: "absolute", top: i * rowHeight, height: rowHeight }}
      >
        {render(item, i)}
      </div>
    );
  }

  return (
    <div className="vlist" ref={containerRef}>
      <div style={{ position: "relative", height: items.length * rowHeight }}>
        {rows}
      </div>
      {items.length === 0 && (
        <div className="vlist-empty">No entries.</div>
      )}
    </div>
  );
}
