import type { ReactNode } from "react";
import { Fragment } from "react";
import type { Route } from "../App";

export interface Crumb {
  label: string;
  /** Absent on the last (current) crumb. */
  to?: Route;
}

/**
 * Persistent top bar (design decisions §3): breadcrumb left — the primary
 * back/up mechanism — an optional right slot (sync status on campaign
 * views), and the Settings entry point far right.
 */
export default function TopBar({
  crumbs,
  right,
  navigate,
}: {
  crumbs: Crumb[];
  right?: ReactNode;
  navigate: (r: Route) => void;
}) {
  const onSettings = crumbs[crumbs.length - 1]?.label === "Settings";
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-edge bg-surface-2 px-4">
      <nav aria-label="Breadcrumb" className="min-w-0 text-sm">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="mx-2 text-ink-muted">/</span>}
            {c.to ? (
              <button
                onClick={() => navigate(c.to!)}
                className="rounded text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {c.label}
              </button>
            ) : (
              <span className="font-medium text-ink">{c.label}</span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        {right}
        {!onSettings && (
          <button
            aria-label="Settings"
            title="Settings"
            onClick={() => navigate({ view: "settings" })}
            className="rounded px-1.5 py-0.5 text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            ⚙
          </button>
        )}
      </div>
    </header>
  );
}
