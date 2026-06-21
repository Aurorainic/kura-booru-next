import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAutocomplete, type Tag } from "@/lib/api";

interface SearchBarProps {
  initialQuery?: string;
  onSearch: (query: string) => void;
  placeholder?: string;
}

export default function SearchBar({ initialQuery = "", onSearch, placeholder = "搜索标签...（用 + 组合，用 - 排除）" }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Extract the last tag being typed (after the last space or +)
    const parts = query.split(/[\s+]+/);
    const currentTag = parts[parts.length - 1].replace(/^-/, "");

    if (!currentTag || currentTag.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const results = await fetchAutocomplete(currentTag);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setSelectedIndex(-1);
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
          inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectSuggestion = useCallback((tag: Tag) => {
    // Replace the last tag part with the selected tag
    const parts = query.split(/[\s+]+/);
    const isNegated = parts[parts.length - 1].startsWith("-");
    parts[parts.length - 1] = isNegated ? `-${tag.name}` : tag.name;
    const newQuery = parts.join(" + ");
    setQuery(newQuery + " + ");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        handleSelectSuggestion(suggestions[selectedIndex]);
      } else {
        setShowSuggestions(false);
        onSearch(query);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  }, [selectedIndex, suggestions, handleSelectSuggestion, onSearch, query]);

  const handleClear = useCallback(() => {
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative w-full max-w-2xl mx-auto">
      <div className="relative flex items-center">
        <div className="absolute left-3 text-[var(--text-muted)]">
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Search className="w-5 h-5" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
          }}
          placeholder={placeholder}
          className={cn(
            "w-full pl-10 pr-10 py-3 rounded-[14px]",
            "bg-[var(--bg-surface)] border border-[var(--border-color)]",
            "text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
            "focus:outline-none focus:border-[var(--accent-color)]",
            "focus:shadow-[0_0_0_3px_var(--accent-subtle),0_4px_16px_oklch(72%_0.12_175_/_0.08)]",
            "transition-all duration-[var(--duration-normal)]"
          )}
          aria-label="搜索标签"
          aria-expanded={showSuggestions}
          aria-haspopup="listbox"
          role="combobox"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="清除搜索"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Autocomplete suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute z-50 mt-1 w-full rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--border-color)] shadow-lg overflow-hidden"
          style={{ animation: "suggestIn var(--duration-fast) var(--ease-out)" }}
          role="listbox"
        >
          {suggestions.map((tag, index) => (
            <button
              key={tag.id}
              onClick={() => handleSelectSuggestion(tag)}
              className={cn(
                "w-full px-4 py-2 text-left flex items-center justify-between gap-2",
                "transition-colors duration-[var(--duration-fast)]",
                index === selectedIndex
                  ? "bg-[var(--accent-subtle)] text-[var(--text-primary)]"
                  : "text-[var(--text-primary)] hover:bg-[var(--accent-subtle)]"
              )}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <span className="truncate">{tag.name}</span>
              <span className={cn("text-xs px-1.5 py-0.5 rounded-[var(--radius-sm)]", `tag-${tag.category}`)}>
                {tag.category}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
