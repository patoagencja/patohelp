"use client";

import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Light/dark state, persisted to localStorage; the root layout applies the
 * saved value before paint so there's no flash on reload. Also answers the
 * ⌘K palette's "Przełącz motyw" event. Mount it ONCE per page (either the
 * ThemeToggle button or the header menu), or the event toggles twice.
 */
export function useThemeToggle() {
  const [dark, setDark] = useState(false);

  const apply = useCallback((next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // ignore - non-persistent is fine
    }
  }, []);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    const onToggle = () => apply(!document.documentElement.classList.contains("dark"));
    window.addEventListener("pato:toggle-theme", onToggle);
    return () => window.removeEventListener("pato:toggle-theme", onToggle);
  }, [apply]);

  const toggle = useCallback(
    () => apply(!document.documentElement.classList.contains("dark")),
    [apply]
  );

  return { dark, toggle };
}

/** Stand-alone icon button (pages without the header menu). */
export function ThemeToggle() {
  const { dark, toggle } = useThemeToggle();
  const label = dark ? "Tryb jasny" : "Tryb ciemny";
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label}>
      {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </Button>
  );
}
