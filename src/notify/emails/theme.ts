/**
 * Every colour, size and font in lurq's email, in one place.
 *
 * Change the look here and every email follows. Email clients ignore external
 * CSS and most of <style>, so these are applied as inline styles by the
 * components; keep values to what inline CSS supports.
 */
export const theme = {
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  page: '#0a0a0a',
  card: '#141414',
  border: '#262626',
  divider: '#1f1f1f',
  footer: '#0f0f0f',
  text: '#fafafa',
  muted: '#a1a1aa',
  subtle: '#8a8a8a',
  faint: '#6b6b6b',
  alert: '#f87171',
  radius: 12,
  width: 600,
} as const;
