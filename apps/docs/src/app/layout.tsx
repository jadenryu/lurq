import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: {
    default: 'lurq docs',
    template: '%s — lurq docs',
  },
  description:
    'A continuously-updated, evidence-scored index of JS/TS frameworks and libraries for AI coding agents.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {/* search uses raw fetch, which doesn't get basePath applied — point it
            at the prefixed endpoint so it works behind the /docs zone rewrite. */}
        <RootProvider search={{ options: { api: '/docs/api/search' } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
