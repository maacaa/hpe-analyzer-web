export type Theme = "night" | "day";

const KEY = "hpe.theme";

export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "day" ? "day" : "night";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage may be unavailable */
  }
}

export function initTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  const theme: Theme = stored === "day" ? "day" : "night";
  document.documentElement.dataset.theme = theme;
  return theme;
}
