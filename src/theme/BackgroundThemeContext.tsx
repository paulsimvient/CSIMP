import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyBackgroundTheme,
  persistBackgroundTheme,
  readStoredBackgroundTheme,
  type BackgroundTheme,
} from "./backgroundTheme";

type BackgroundThemeContextValue = {
  theme: BackgroundTheme;
  setTheme: (theme: BackgroundTheme) => void;
};

const BackgroundThemeContext = createContext<BackgroundThemeContextValue | null>(null);

export function BackgroundThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<BackgroundTheme>(() => readStoredBackgroundTheme());

  useEffect(() => {
    applyBackgroundTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: BackgroundTheme) => {
    applyBackgroundTheme(next);
    persistBackgroundTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <BackgroundThemeContext.Provider value={value}>{children}</BackgroundThemeContext.Provider>
  );
}

export function useBackgroundTheme() {
  const context = useContext(BackgroundThemeContext);
  if (!context) {
    throw new Error("useBackgroundTheme must be used within BackgroundThemeProvider");
  }
  return context;
}
