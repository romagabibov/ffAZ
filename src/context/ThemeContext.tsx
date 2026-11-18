import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

const preferenceKey = "az_fashion_theme";
const systemQuery = "(prefers-color-scheme: dark)";
type Theme = "light" | "dark";

function readPreference(): Theme | null {
  try {
    const stored = localStorage.getItem(preferenceKey);
    if (stored === "light" || stored === "dark") return stored;
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch { /* Preferences can be kept in this tab if storage is disabled. */ }
  return null;
}

const ThemeContext = createContext<{ isDark: boolean; toggleTheme: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(systemQuery).matches);
  const isDark = preference ? preference === "dark" : systemDark;

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    const media = window.matchMedia(systemQuery);
    const onSystem = () => setSystemDark(media.matches);
    const onStorage = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) setPreference(readPreference());
    };
    media.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    setPreference(next);
    try {
      localStorage.setItem(preferenceKey, next);
      localStorage.removeItem("theme");
    } catch { /* The selected theme remains active in this tab. */ }
  }

  return <ThemeContext.Provider value={{ isDark, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("ThemeProvider is missing");
  return theme;
}
