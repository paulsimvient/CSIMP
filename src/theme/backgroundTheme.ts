export type BackgroundTheme = "black" | "grey" | "blue";

export const BACKGROUND_THEME_STORAGE_KEY = "coda2-bg-theme";

export const DEFAULT_BACKGROUND_THEME: BackgroundTheme = "blue";

export const BACKGROUND_THEME_OPTIONS: Array<{
  id: BackgroundTheme;
  label: string;
  swatch: string;
}> = [
  { id: "black", label: "Black", swatch: "#000000" },
  { id: "grey", label: "Grey", swatch: "#1e1e1e" },
  { id: "blue", label: "Blue", swatch: "#101521" },
];

export function isBackgroundTheme(value: string | null): value is BackgroundTheme {
  return value === "black" || value === "grey" || value === "blue";
}

export function readStoredBackgroundTheme(): BackgroundTheme {
  try {
    const stored = localStorage.getItem(BACKGROUND_THEME_STORAGE_KEY);
    if (isBackgroundTheme(stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return DEFAULT_BACKGROUND_THEME;
}

export function applyBackgroundTheme(theme: BackgroundTheme): void {
  document.documentElement.dataset.bgTheme = theme;
}

export function persistBackgroundTheme(theme: BackgroundTheme): void {
  try {
    localStorage.setItem(BACKGROUND_THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable
  }
}
