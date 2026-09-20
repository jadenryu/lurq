'use client';

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/**
 * The docs 404 as a `lurq verify` verdict, matching lurq.run's own 404.
 *
 * The path is read from `location` after hydration (it already includes the
 * /docs basePath): the not-found page is prerendered once, so a server-rendered
 * path would be the wrong one. The server snapshot says "this address" instead.
 */
export function NotFoundVerdict() {
  const path = useSyncExternalStore(
    noSubscribe,
    () => location.pathname,
    () => null,
  );
  const name = path ? `lurq.run${path}` : 'this address';

  return (
    <div className="mt-8 overflow-hidden rounded-xl border border-fd-border bg-fd-card font-mono text-[12.5px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-fd-border bg-fd-secondary px-4 py-2.5 text-xs">
        <span className="text-fd-muted-foreground">lurq</span>
        <span aria-hidden className="text-fd-muted-foreground">
          ·
        </span>
        <span>verify</span>
        <span className="min-w-0 break-all text-fd-muted-foreground">{name}</span>
      </div>
      <p className="m-4 border-l-2 border-red-500 pl-4 leading-relaxed">
        <span className="break-all text-fd-muted-foreground">{name}</span>
        <span className="whitespace-nowrap pl-3">
          <span aria-hidden className="text-red-500">
            ✗{' '}
          </span>
          NOT A REAL PAGE
        </span>
        <span className="mt-2 block text-fd-muted-foreground">
          No docs page answers to this path. Check the spelling, or search the docs.
        </span>
      </p>
    </div>
  );
}
