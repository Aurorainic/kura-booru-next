import { useState, useEffect, useCallback, useRef } from "react";
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
  const [spinning, setSpinning] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

    // Spin animation
    setSpinning(true);
    setTimeout(() => setSpinning(false), 300);
  }, [preference]);

  const { icon: Icon, label } = themeConfig[preference];

  return (
    <button
      ref={buttonRef}
      onClick={cycle}
      className={cn(
        "relative flex items-center justify-center",
        "w-9 h-9 rounded-[var(--radius-sm)]",
        "transition-all duration-[var(--duration-fast)]",
        "hover:bg-[var(--accent-subtle)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] focus-visible:ring-offset-2",
        "active:scale-[0.85]",
        "group"
      )}
      aria-label={`切换主题（当前：${label}）`}
      title={`主题：${label}`}
    >
      <Icon
        className={cn(
          "w-[18px] h-[18px] transition-all duration-[var(--duration-normal)]",
          "text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:scale-110",
          spinning && "animate-spin"
        )}
        style={spinning ? { transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)" } : undefined}
      />
      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}
