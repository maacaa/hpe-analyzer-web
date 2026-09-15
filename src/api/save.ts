// Save a report (PDF or text) via the File System Access API with a
// download fallback.

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
};

declare global {
  function showSaveFilePicker(options?: SaveFilePickerOptions): Promise<{
    createWritable: () => Promise<{
      write: (data: string | Blob | ArrayBufferView) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

export async function saveBinaryFile(
  suggestedName: string,
  contentType: string,
  extension: string,
  data: Uint8Array
): Promise<boolean> {
  if (typeof showSaveFilePicker === "function") {
    try {
      const handle = await showSaveFilePicker({
        suggestedName,
        types: [{ description: "PDF report", accept: { [contentType]: [extension] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  }
  // Fallback: download via <a> tag
  const blob = new Blob([data as unknown as BlobPart], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function saveTextFile(
  suggestedName: string,
  content: string
): Promise<boolean> {
  if (typeof showSaveFilePicker === "function") {
    try {
      const handle = await showSaveFilePicker({
        suggestedName,
        types: [{ description: "Text file", accept: { "text/plain": [".txt"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  }
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
