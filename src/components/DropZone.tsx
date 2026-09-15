import { useCallback, useRef, useState } from "react";

export function DropZone({
  onFile,
  onBrowse,
}: {
  onFile: (f: File) => void;
  onBrowse: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div className="center-panel">
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          depth.current--;
          if (depth.current <= 0) setDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="dz-icon">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V4m0 0L8 8m4-4 4 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2>Drop an AHS file here</h2>
        <p className="muted">
          Drag &amp; drop an HPE Active Health System log, or click to browse.
        </p>
        <p className="hint">Supports large files (up to 4 GB) without blocking the UI.</p>
        <button
          className="btn btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            onBrowse();
          }}
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".ahs"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
