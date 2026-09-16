import { useEffect, useRef, useState } from "react";
import { applyTheme, type Theme } from "../theme";

const LABELS: Record<Theme, { name: string; desc: string }> = {
  night: { name: "Night", desc: "Deep blue diagnostic console" },
  day: { name: "Day", desc: "Cool laboratory documentation" },
};

export function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="theme-picker" ref={ref}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Theme"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="5" r="2" /><circle cx="11" cy="5" r="2" /><circle cx="5" cy="11" r="2" /><circle cx="11" cy="11" r="2" />
        </svg>
        <span>{LABELS[theme].name}</span>
      </button>
      <div className="theme-popover" data-open={String(open)} aria-hidden={!open} role="radiogroup" aria-label="Theme selection">
        {(Object.keys(LABELS) as Theme[]).map((t) => (
          <button
            key={t}
            className="theme-option"
            data-theme-option={t}
            role="radio"
            aria-checked={theme === t}
            onClick={() => { onChange(t); setOpen(false); }}
          >
            <span>
              <span className="theme-option-label">{LABELS[t].name}</span>
              <span className="theme-option-desc">{LABELS[t].desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
