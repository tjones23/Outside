"use client";

import type { ReactNode } from "react";

/** Small shared controls, styled like WhatsGood's. */

export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-4 py-2.5 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-dim">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-text after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-accent-ink"
      />
    </label>
  );
}

/** One choice from a few, as a row of pills. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full border border-line bg-surface-2 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              on ? "bg-accent font-medium text-accent-ink" : "text-muted hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A toggle pill. `color` tints it when on. */
export function Chip({
  on,
  onClick,
  color,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  color?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      style={on && color ? { borderColor: color, backgroundColor: `${color}26`, color: "var(--text)" } : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        on
          ? color
            ? ""
            : "border-accent/70 bg-accent/15 text-text"
          : "border-line bg-surface text-muted hover:border-muted-dim hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled,
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const styles = {
    primary: "bg-text text-ink hover:opacity-90",
    secondary: "border border-line bg-surface text-text hover:border-muted-dim",
    ghost: "text-muted hover:bg-surface hover:text-text",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-text">
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-widest text-muted-dim first:mt-0">
      {children}
    </h3>
  );
}

/** A two-column fact list for detail views. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line-soft text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-4 py-2">
          <dt className="w-28 shrink-0 text-muted-dim">{k}</dt>
          <dd className="min-w-0 flex-1 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
