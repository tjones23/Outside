"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A modal panel: a bottom sheet on phones, a centered card on wider screens.
 * Escape and a backdrop click close it; focus moves in on open and back out
 * on close.
 *
 * Portaled to <body>: a sheet opened from the map would otherwise be trapped
 * in the map's stacking context, underneath the site header.
 */
export function Sheet({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl outline-none sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1 text-sm text-muted hover:bg-surface-2 hover:text-text"
            >
              Done
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
