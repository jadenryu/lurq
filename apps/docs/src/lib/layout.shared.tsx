import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Shared layout options used by both the docs layout and the home layout.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>lurq</span>
        </>
      ),
    },
    githubUrl: 'https://github.com/jadenryu/lurq',
  };
}
