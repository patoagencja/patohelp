"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Searchable picker for long option lists (OLX has hundreds of campaigns
 * named like "[FP] / luty / 2026 / OLX Goods / TV Goods / FB / ..."). ARIA
 * 1.2 combobox + listbox: type to filter (case- and Polish-accent-
 * insensitive, every typed word must appear somewhere in the name), ↑/↓ to
 * move, Enter to pick, Esc to close. Submits through a hidden input under
 * `name`, so the form and its server action see the same value as before.
 * Server render / no JS: a native <select> with the same name and values.
 */

export interface ComboOption {
  value: string;
  label: string;
  /** Platform tag, e.g. "Meta" / "Google". */
  tag?: string | null;
  /** Secondary line, e.g. "1 240 zł w 60 dni". */
  meta?: string | null;
  /** Native-select fallback only: <optgroup> label. */
  group?: string;
}

/** Per-character fold (same length as the input, so match indexes map back). */
function fold(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    if (ch === "ł") out += "l";
    else {
      const base = ch.normalize("NFD")[0] ?? ch;
      out += base.length === 1 ? base : ch;
    }
  }
  return out;
}

/** Ranges [start, end) of every query word inside `label`, or null = no match. */
function matchRanges(label: string, words: string[]): Array<[number, number]> | null {
  if (words.length === 0) return [];
  const hay = fold(label);
  const ranges: Array<[number, number]> = [];
  for (const w of words) {
    const at = hay.indexOf(w);
    if (at < 0) return null;
    ranges.push([at, at + w.length]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], i) => {
    const start = Math.max(s, pos);
    if (start > pos) parts.push(text.slice(pos, start));
    if (e > start) {
      parts.push(
        <mark key={i} className="rounded-[4px] bg-lime/45 px-px text-foreground">
          {text.slice(start, e)}
        </mark>
      );
    }
    pos = Math.max(pos, e);
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

const MAX_SHOWN = 80;

export function SearchCombobox({
  id,
  name,
  options,
  value,
  onChange,
  required = false,
  disabled = false,
  placeholder = "Szukaj…",
  emptyOption,
  emptyText = "Nic nie pasuje - spróbuj innego fragmentu nazwy.",
  invalidText = "Wybierz pozycję z listy.",
  fieldClass,
  describedBy,
}: {
  id: string;
  name: string;
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** A first "no choice" row (e.g. "Cała kampania") with value "". */
  emptyOption?: string;
  emptyText?: string;
  invalidText?: string;
  fieldClass: string;
  describedBy?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value) ?? null;
  const shownText = typing ? query : (selected?.label ?? "");

  const words = useMemo(
    () => (typing ? fold(query).split(/\s+/).filter(Boolean) : []),
    [query, typing]
  );
  const matches = useMemo(() => {
    const out: Array<{ o: ComboOption; ranges: Array<[number, number]> }> = [];
    if (emptyOption && words.length === 0) {
      out.push({ o: { value: "", label: emptyOption }, ranges: [] });
    }
    for (const o of options) {
      const r = matchRanges(o.label, words);
      if (r) out.push({ o, ranges: r });
      if (out.length >= MAX_SHOWN) break;
    }
    return out;
  }, [options, words, emptyOption]);
  const total = useMemo(
    () => (words.length === 0 ? options.length : options.filter((o) => matchRanges(o.label, words)).length),
    [options, words]
  );

  // Required + nothing picked (or text typed but not picked): block submit
  // with a native message instead of posting an empty value.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.setCustomValidity(required && !value ? invalidText : "");
  }, [required, value, invalidText, mounted]);

  // Keep the active row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!mounted) {
    // No JS (or before hydration): the plain native select.
    const groups = new Map<string, ComboOption[]>();
    const loose: ComboOption[] = [];
    for (const o of options) {
      if (o.group) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
      else loose.push(o);
    }
    return (
      <select
        id={id}
        name={name}
        required={required}
        // Never disabled here: without JS nothing could enable it again.
        defaultValue={value}
        className={fieldClass}
        aria-describedby={describedBy}
      >
        <option value="">{emptyOption ?? "Wybierz…"}</option>
        {loose.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {Array.from(groups.entries()).map(([g, list]) => (
          <optgroup key={g} label={g}>
            {list.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  }

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setTyping(false);
    setQuery("");
    setOpen(false);
  };
  const activeId = open && matches[active] ? `${listId}-opt-${active}` : undefined;

  return (
    <div className="relative min-w-0">
      <input type="hidden" name={name} value={value} />
      <Search
        aria-hidden
        className="pointer-events-none absolute left-4 top-[22px] h-4 w-4 -translate-y-1/2 text-ink-3"
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={selected ? undefined : placeholder}
        value={shownText}
        title={selected?.label}
        onChange={(e) => {
          setTyping(true);
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          // Typed but didn't pick: show the current choice again.
          setOpen(false);
          setTyping(false);
          setQuery("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            else setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (open && matches[active]) {
              e.preventDefault();
              pick(matches[active].o);
            }
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              setOpen(false);
            }
            setTyping(false);
            setQuery("");
          } else if (e.key === "Tab") {
            setOpen(false);
          }
        }}
        className={cn(fieldClass, "pl-10 pr-10 text-ellipsis")}
      />
      <ChevronDown
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-4 top-[22px] h-4 w-4 -translate-y-1/2 text-ink-3 transition-transform",
          open && "rotate-180"
        )}
      />
      {open && !disabled ? (
        <div className="glass-tip absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl shadow-glass sm:min-w-[24rem]">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Wyniki"
            // Keep focus in the input while clicking a row.
            onMouseDown={(e) => e.preventDefault()}
            className="max-h-[22rem] overflow-y-auto overscroll-contain p-1.5"
          >
            {matches.map(({ o, ranges }, i) => (
              <li
                key={o.value || "__empty"}
                id={`${listId}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-xl px-3 py-2 text-[14.5px] leading-snug",
                  i === active ? "bg-[var(--chip-hover)]" : undefined,
                  o.value === value && "font-medium"
                )}
              >
                <span className="break-words [overflow-wrap:anywhere]">
                  <Highlighted text={o.label} ranges={ranges} />
                </span>
                {o.tag || o.meta ? (
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3 tabular-nums">
                    {o.tag ? (
                      <span className="rounded-full bg-chip px-2 py-px font-medium text-ink-2">{o.tag}</span>
                    ) : null}
                    {o.meta}
                  </span>
                ) : null}
              </li>
            ))}
            {matches.length === 0 ? (
              <li role="presentation" className="px-3 py-3 text-sm text-ink-3">
                {emptyText}
              </li>
            ) : null}
          </ul>
          {total > MAX_SHOWN - (emptyOption ? 1 : 0) ? (
            <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
              Pokazano {MAX_SHOWN} z {total} - wpisz fragment nazwy, aby zawęzić.
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {typing ? `Wyniki: ${total}` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
