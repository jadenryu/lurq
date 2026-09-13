/**
 * The building blocks every lurq email shares. Restyle an email by editing
 * `./theme.ts`; restructure it by editing these.
 */
import type { ReactNode } from 'react';
import { Body, Container, Head, Html, Link, Preview, Section, Text } from 'react-email';
import { theme } from './theme';
import type { Links } from './types';

export function Layout({
  preview,
  heading,
  footer,
  children,
}: {
  /** The line mail clients show beside the subject. */
  preview: string;
  heading: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: theme.page, margin: 0, padding: '32px 16px', fontFamily: theme.font }}>
        <Container
          style={{
            maxWidth: theme.width,
            backgroundColor: theme.card,
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius,
            overflow: 'hidden',
          }}
        >
          <Section style={{ padding: '20px 24px', borderBottom: `1px solid ${theme.divider}` }}>
            <Text style={{ margin: 0, fontSize: 15, fontWeight: 600, color: theme.text }}>lurq</Text>
            <Text style={{ margin: '8px 0 0', fontSize: 16, color: theme.text }}>{heading}</Text>
          </Section>
          <Section style={{ padding: '8px 24px 20px' }}>{children}</Section>
          <Section style={{ padding: '14px 24px', borderTop: `1px solid ${theme.divider}`, backgroundColor: theme.footer }}>
            {footer}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** One change: an optional red label, what happened, the detail, and a link to it. */
export function AlertRow({ label, title, detail, url }: { label?: string; title: string; detail: string; url: string }) {
  return (
    <Section style={{ padding: '14px 0', borderBottom: `1px solid ${theme.divider}` }}>
      {label ? (
        <Text style={{ margin: 0, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.alert }}>
          {label}
        </Text>
      ) : null}
      <Text style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 500, color: theme.text }}>{title}</Text>
      <Text style={{ margin: '4px 0 0', fontSize: 13, lineHeight: '1.55', color: theme.muted }}>{detail}</Text>
      <Link href={url} style={{ display: 'inline-block', marginTop: 8, fontSize: 13, color: theme.text }}>
        Review it →
      </Link>
    </Section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={{ margin: '18px 0 0', fontSize: 12, color: theme.subtle }}>{children}</Text>;
}

export function More({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <Text style={{ margin: '8px 0 0', fontSize: 12, color: theme.faint }}>and {total - shown} more in the dashboard</Text>
  );
}

/** Why the email was sent and how to stop it. Every lurq email carries this. */
export function Footer({ why, links }: { why: string; links: Links }) {
  return (
    <Text style={{ margin: 0, fontSize: 12, lineHeight: '1.6', color: theme.faint }}>
      {why}
      <br />
      <Link href={links.unsubscribeUrl} style={{ color: theme.subtle }}>
        Turn these off
      </Link>
      {' · '}
      <Link href={links.settingsUrl} style={{ color: theme.subtle }}>
        Email settings
      </Link>
    </Text>
  );
}
