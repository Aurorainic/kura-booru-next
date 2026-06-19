import { useState, useEffect, useCallback } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

type ThemePreference = "auto" | "light" | "dark";

const STORAGE_KEY = "kura-theme-preference";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemePreference): void {
  const resolved = theme === "auto" ? getSystemTheme() : theme;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
}

const themeConfig: Record<ThemePreference, { icon: typeof Sun; label: string }> = {
  auto: { icon: Monitor, label: "自动" },
  light: { icon: Sun, label: "浅色" },
  dark: { icon: Moon, label: "深色" },
};

export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("auto");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    const initial: ThemePreference = stored || "auto";
    setPreference(initial);
    applyTheme(initial);
  }, []);

  useEffect(() => {
    if (preference !== "auto") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("auto");
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [preference]);

  const cycle = useCallback(() => {
    const order: ThemePreference[] = ["auto", "light", "dark"];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    setPreference(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }, [preference]);

  const { icon: Icon, label } = themeConfig[preference];

  return (
    <button
      onClick={cycle}
      className={cn(
        "relative flex items-center justify-center",
        "w-10 h-10 rounded-lg",
        "transition-all duration-200",
        "hover:bg-[var(--border-color)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--color-cyan-accent-start)] focus-visible:ring-offset-2",
        "group"
      )}
      aria-label={`切换主题（当前：${label}）`}
      title={`主题：${label}`}
    >
      <Icon className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}