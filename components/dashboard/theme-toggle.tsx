"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

// Terminal/trading dark mode toggle. Persists to localStorage; the root layout
// applies the saved value before paint so there's no flash on reload.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    // The ⌘K command palette toggles through here so this icon stays in sync.
    const onToggle = () => apply(!document.documentElement.classList.contains("dark"));
    window.addEventListener("pato:toggle-theme", onToggle);
    return () => window.removeEventListener("pato:toggle-theme", onToggle);
  }, []);

  function toggle() {
    apply(!dark);
  }

  function apply(next: boolean) {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // ignore - non-persistent is fine
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-label={dark ? "Tryb jasny" : "Tryb ciemny"}
      title={dark ? "Tryb jasny" : "Tryb ciemny"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
