import { HomeLayout } from 'fumadocs-ui/layouts/home';
import Link from 'next/link';
import { NotFoundVerdict } from '@/components/not-found-verdict';
import { baseOptions } from '@/lib/layout.shared';

/** Where to go instead. Link hrefs get the /docs basePath added by Next. */
const REAL_PAGES = [
  { label: 'Docs home', href: '/' },
  { label: 'Quickstart', href: '/quickstart' },
  { label: 'MCP tools', href: '/mcp-tools' },
  { label: 'CLI', href: '/cli' },
  { label: 'Plans and troubleshooting', href: '/plans-and-troubleshooting' },
];

const LINK = 'underline decoration-fd-border underline-offset-4 hover:decoration-fd-foreground';

/**
 * Every unknown docs URL, and every `notFound()` from the [[...slug]] page,
 * lands here instead of Next's bare default: the docs nav (with search) around
 * the same "not a real page" verdict lurq.run's 404 shows.
 */
export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
        <p className="font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Not a real page</h1>
        <p className="mt-3 text-fd-muted-foreground">
          The link may be old, or the page may have moved.
        </p>
        <NotFoundVerdict />
        <h2 className="mt-10 font-mono text-xs uppercase tracking-wider text-fd-muted-foreground">
          Pages that do exist
        </h2>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {REAL_PAGES.map(({ label, href }) => (
            <li key={href}>
              <Link href={href} className={LINK}>
                {label}
              </Link>
            </li>
          ))}
          <li>
            <a href="https://lurq.run" className={LINK}>
              lurq.run
            </a>
          </li>
        </ul>
      </div>
    </HomeLayout>
  );
}
