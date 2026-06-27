import { useState, useEffect, useRef, useCallback } from "react";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";

const COOKIE_KEY = "kura-accent-hue";
const STORAGE_KEY = "kura-accent-hue";
const DEFAULT_HUE = 175;
const HUE_EVENT = "kura-accent-change";

function applyHue(hue: number) {
  document.documentElement.style.setProperty("--accent-hue", String(hue));
  document.documentElement.style.setProperty("--accent-hue-end", String(hue + 25));
}

function persistHue(hue: number) {
  // Cookie — readable by SSR so the next page load has the right hue before paint
  document.cookie = `${COOKIE_KEY}=${hue}; path=/; max-age=31536000; samesite=lax`;
  // localStorage — fallback for same-page reads and older browsers
  try { localStorage.setItem(STORAGE_KEY, String(hue)); } catch {}
}

function readHue(): number | null {
  // Prefer localStorage (immediate, no parsing), fall back to cookie
  try {
    const ls = localStorage.getItem(STORAGE_KEY);
    if (ls) {
      const v = parseInt(ls, 10);
      if (!isNaN(v) && v >= 0 && v <= 360) return v;
    }
  } catch {}
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`));
  if (match) {
    const v = parseInt(match[1], 10);
    if (!isNaN(v) && v >= 0 && v <= 360) return v;
  }
  return null;
}

export default function AccentPicker() {
  const [hue, setHue] = useState(DEFAULT_HUE);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef(0);

  useEffect(() => {
    const stored = readHue();
    if (stored != null) {
      setHue(stored);
      applyHue(stored);
    }

    function handleHueChange(event: Event) {
      const next = Number((event as CustomEvent<number>).detail);
      if (Number.isNaN(next)) return;
      setHue(next);
      applyHue(next);
    }

    window.addEventListener(HUE_EVENT, handleHueChange as EventListener);
    return () =>
      window.removeEventListener(HUE_EVENT, handleHueChange as EventListener);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setHue(val);
    applyHue(val);
    window.dispatchEvent(new CustomEvent<number>(HUE_EVENT, { detail: val }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistHue(val);
    }, 150);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-center",
          "w-9 h-9 rounded-[var(--radius-sm)]",
          "transition-all duration-[var(--duration-fast)]",
          "hover:bg-[var(--accent-subtle)]",
          "focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] focus-visible:ring-offset-2",
          "active:scale-[0.85]"
        )}
        aria-label="选择强调色"
        title="色调"
      >
        <Palette
          className="w-4 h-4 transition-colors duration-[var(--duration-fast)]"
          style={{ color: `oklch(72% 0.12 ${hue})` }}
        />
      </button>
      {open && (
        <div
          className={cn(
            "absolute right-0 top-full mt-1.5",
            "p-3 rounded-[var(--radius-md)]",
            "border border-[var(--border-color)]",
            "bg-[var(--bg-surface)] shadow-lg",
            "z-50 flex flex-col gap-2",
            "min-w-[180px]"
          )}
          style={{ animation: "dropIn var(--duration-normal) var(--ease-out)" }}
        >
          <span className="text-[11px] text-[var(--text-muted)] font-medium">
            色调 {hue}°
          </span>
          <input
            type="range"
            min={0}
            max={360}
            value={hue}
            onChange={handleChange}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, 
                hsl(0, 80%, 55%), 
                hsl(30, 80%, 55%), 
                hsl(60, 80%, 50%), 
                hsl(120, 70%, 45%), 
                hsl(180, 70%, 45%), 
                hsl(240, 70%, 55%), 
                hsl(300, 70%, 55%), 
                hsl(360, 80%, 55%))`,
              accentColor: `oklch(72% 0.12 ${hue})`,
            }}
          />
        </div>
      )}
    </div>
  );
}
