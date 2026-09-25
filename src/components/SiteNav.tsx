"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatAgo } from "@/lib/format";
import { useStormData } from "./providers/StormDataProvider";
import { useFilteredData } from "./providers/useFilteredData";
import { useNow } from "./providers/useNow";

const NAV = [
  { href: "/", label: "Map", icon: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" },
  { href: "/reports", label: "Reports", icon: "M5 5h14M5 12h14M5 19h9" },
  { href: "/alerts", label: "Alerts", icon: "M12 3 2 20h20L12 3Zm0 6v5m0 3v.5" },
  { href: "/locations", label: "Places", icon: "M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" },
  { href: "/settings", label: "Settings", icon: "M4 7h10m4 0h2M4 17h4m4 0h8M14 5v4M8 15v4" },
] as const;

function useWarningCount(): number {
  const { alerts } = useFilteredData();
  return alerts.filter((a) => a.isWarning).length;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Sticky header: wordmark, section links (wide screens), data freshness. */
export function SiteHeader() {
  const pathname = usePathname();
  const warnings = useWarningCount();
  const { alerts, refresh } = useStormData();
  const now = useNow();
  const busy = alerts.loading;

  return (
    <header
      className="sticky top-0 z-[900] border-b border-line-soft bg-ink/80 backdrop-blur-xl"
      style={{ height: "var(--header-h)" }}
    >
      <div className="mx-auto flex h-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
          Out<span className="text-accent">side</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className="relative rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-text aria-[current=page]:bg-surface aria-[current=page]:text-text"
            >
              {item.label}
              {item.href === "/alerts" && warnings > 0 && <Badge count={warnings} />}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-dim">
          {alerts.updatedAt !== null && (
            <span className="hidden sm:inline" suppressHydrationWarning>
              Updated {formatAgo(alerts.updatedAt, now)}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh storm data"
            title="Refresh"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold leading-4 text-white">
      {count}
    </span>
  );
}

/** Bottom tab bar on phones. */
export function TabBar() {
  const pathname = usePathname();
  const warnings = useWarningCount();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[900] border-t border-line-soft bg-ink/90 backdrop-blur-xl sm:hidden"
      style={{ height: "var(--tabbar-h)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid h-full grid-cols-5">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-full flex-col items-center justify-center gap-0.5 text-[10px] ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={item.icon} />
                </svg>
                {item.label}
                {item.href === "/alerts" && warnings > 0 && (
                  <span className="absolute right-[22%] top-1.5">
                    <Badge count={warnings} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
