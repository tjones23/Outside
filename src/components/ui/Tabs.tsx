"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * A row of tabs over panels the caller renders. Arrow keys, Home and End move
 * between tabs (the WAI-ARIA tabs pattern); only the selected tab is in the
 * tab order. Panels need `id={tabPanelId(idPrefix, tab)}` and
 * `aria-labelledby={tabId(idPrefix, tab)}`.
 */

export const tabId = (prefix: string, value: string) => `${prefix}-tab-${value}`;
export const tabPanelId = (prefix: string, value: string) => `${prefix}-panel-${value}`;

export function Tabs<T extends string>({
  label,
  idPrefix,
  value,
  tabs,
  onChange,
  className = "",
}: {
  label: string;
  idPrefix: string;
  value: T;
  tabs: { value: T; label: ReactNode }[];
  onChange: (next: T) => void;
  className?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.value === value);
    const next =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].value);
    refs.current.get(tabs[next].value)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex gap-1 ${className}`}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              if (el) refs.current.set(t.value, el);
              else refs.current.delete(t.value);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.value)}
            aria-selected={on}
            aria-controls={tabPanelId(idPrefix, t.value)}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              on ? "bg-accent font-medium text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-text"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
