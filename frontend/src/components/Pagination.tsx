import { useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  perPage: number;
}

const PER_PAGE_OPTIONS = [20, 40, 100] as const;
const PER_PAGE_COOKIE_KEY = "kura-per-page";

function getPageRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [1];

  if (current > 3) {
    pages.push("...");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("...");
  }

  pages.push(total);

  return pages;
}

/**
 * Build a URL by updating page / per_page query params on the current URL.
 * Avoids passing a function prop from Astro (which can't be serialized
 * across the island boundary — functions become null).
 *
 * Falls back to a simple path for SSR where window is unavailable.
 */
function buildUrl(page: number, perPage: number): string {
  if (typeof window === "undefined") {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (perPage !== 40) params.set("per_page", String(perPage));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }
  const url = new URL(window.location.href);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  if (page === 1) url.searchParams.delete("page");
  // Note: per_page is always kept in the URL so the persisted cookie
  // preference stays consistent with what the user explicitly selected.
  return url.pathname + url.search;
}

export default function Pagination({ currentPage, totalPages, perPage }: PaginationProps) {
  const pages = useMemo(() => getPageRange(currentPage, totalPages), [currentPage, totalPages]);

  // Sync per_page from URL to cookie so SSR can apply the preference
  // on the next visit (cookie is readable server-side, localStorage is not).
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.cookie = `${PER_PAGE_COOKIE_KEY}=${perPage}; path=/; max-age=31536000; samesite=lax`;
  }, [perPage]);

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-end py-4">
        <PerPageSelector perPage={perPage} />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-4 gap-4 flex-wrap">
      {/* Page navigation */}
      <nav className="flex items-center gap-1" aria-label="Pagination">
        {/* Previous button */}
        {hasPrev ? (
          <a
            href={buildUrl(currentPage - 1, perPage)}
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-[var(--radius-sm)]",
              "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              "hover:bg-[var(--accent-subtle)] transition-all duration-[var(--duration-fast)]",
              "active:scale-[0.92]"
            )}
            aria-label="上一页"
          >
            <ChevronLeft className="w-5 h-5" />
          </a>
        ) : (
          <span className="flex items-center justify-center w-10 h-10 text-[var(--border-color)] cursor-not-allowed">
            <ChevronLeft className="w-5 h-5" />
          </span>
        )}

        {/* Page numbers */}
        {pages.map((page, index) =>
          page === "..." ? (
            <span
              key={`ellipsis-${index}`}
              className="flex items-center justify-center w-10 h-10 text-[var(--text-muted)]"
            >
              …
            </span>
          ) : (
            <a
              key={page}
              href={buildUrl(page, perPage)}
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-[var(--radius-sm)] text-sm font-medium",
                "transition-all duration-[var(--duration-fast)]",
                page === currentPage
                  ? "bg-[var(--accent-color)] text-[var(--bg-primary)] font-bold"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-subtle)]"
              )}
              aria-label={`第 ${page} 页`}
              aria-current={page === currentPage ? "page" : undefined}
            >
              {page}
            </a>
          ),
        )}

        {/* Next button */}
        {hasNext ? (
          <a
            href={buildUrl(currentPage + 1, perPage)}
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-[var(--radius-sm)]",
              "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              "hover:bg-[var(--accent-subtle)] transition-all duration-[var(--duration-fast)]",
              "active:scale-[0.92]"
            )}
            aria-label="下一页"
          >
            <ChevronRight className="w-5 h-5" />
          </a>
        ) : (
          <span className="flex items-center justify-center w-10 h-10 text-[var(--border-color)] cursor-not-allowed">
            <ChevronRight className="w-5 h-5" />
          </span>
        )}
      </nav>

      {/* Per-page selector */}
      <PerPageSelector perPage={perPage} />
    </div>
  );
}

function PerPageSelector({ perPage }: { perPage: number }) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-[var(--text-muted)] mr-1">每页：</span>
      {PER_PAGE_OPTIONS.map((option) => (
        <a
          key={option}
          href={buildUrl(1, option)}
          className={cn(
            "px-3 py-2 rounded-[var(--radius-sm)] transition-all duration-[var(--duration-fast)]",
            option === perPage
              ? "bg-[var(--accent-color)] text-[var(--bg-primary)] font-bold"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-subtle)]"
          )}
        >
          {option}
        </a>
      ))}
    </div>
  );
}
