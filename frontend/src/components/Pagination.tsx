import { useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  perPage: number;
  buildUrl: (page: number, perPage: number) => string;
}

const PER_PAGE_OPTIONS = [20, 40, 100] as const;

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

export default function Pagination({ currentPage, totalPages, perPage, buildUrl }: PaginationProps) {
  const pages = useMemo(() => getPageRange(currentPage, totalPages), [currentPage, totalPages]);

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-end py-4">
        <PerPageSelector perPage={perPage} buildUrl={buildUrl} />
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
              "flex items-center justify-center w-9 h-9 rounded-lg",
              "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              "hover:bg-[var(--border-color)] transition-colors duration-150"
            )}
            aria-label="上一页"
          >
            <ChevronLeft className="w-5 h-5" />
          </a>
        ) : (
          <span className="flex items-center justify-center w-9 h-9 text-[var(--border-color)] cursor-not-allowed">
            <ChevronLeft className="w-5 h-5" />
          </span>
        )}

        {/* Page numbers */}
        {pages.map((page, index) =>
          page === "..." ? (
            <span
              key={`ellipsis-${index}`}
              className="flex items-center justify-center w-9 h-9 text-[var(--text-muted)]"
            >
              …
            </span>
          ) : (
            <a
              key={page}
              href={buildUrl(page, perPage)}
              className={cn(
                "flex items-center justify-center w-9 h-9 rounded-lg text-sm font-medium",
                "transition-colors duration-150",
                page === currentPage
                  ? "gradient-bg text-[var(--color-dark-bg)] font-bold"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-color)]"
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
              "flex items-center justify-center w-9 h-9 rounded-lg",
              "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              "hover:bg-[var(--border-color)] transition-colors duration-150"
            )}
            aria-label="下一页"
          >
            <ChevronRight className="w-5 h-5" />
          </a>
        ) : (
          <span className="flex items-center justify-center w-9 h-9 text-[var(--border-color)] cursor-not-allowed">
            <ChevronRight className="w-5 h-5" />
          </span>
        )}
      </nav>

      {/* Per-page selector */}
      <PerPageSelector perPage={perPage} buildUrl={buildUrl} />
    </div>
  );
}

function PerPageSelector({
  perPage,
  buildUrl,
}: {
  perPage: number;
  buildUrl: (page: number, perPage: number) => string;
}) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-[var(--text-muted)] mr-1">每页：</span>
      {PER_PAGE_OPTIONS.map((option) => (
        <a
          key={option}
          href={buildUrl(1, option)}
          className={cn(
            "px-2 py-1 rounded transition-colors duration-150",
            option === perPage
              ? "gradient-bg text-[var(--color-dark-bg)] font-bold"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border-color)]"
          )}
        >
          {option}
        </a>
      ))}
    </div>
  );
}