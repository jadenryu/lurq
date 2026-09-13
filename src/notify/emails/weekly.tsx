/**
 * The opt-in weekly summary. Preview it live with `npm run email:dev`.
 */
import { AlertRow, Footer, Layout, More, SectionTitle } from './components';
import { digestCopy } from './copy';
import { sampleDigest, sampleLinks } from './samples';
import type { DigestSummary, Links } from './types';

export interface WeeklyEmailProps {
  summary: DigestSummary;
  links: Links;
}

export default function WeeklyEmail({ summary: s, links }: WeeklyEmailProps) {
  const copy = digestCopy(s);
  return (
    <Layout preview={copy.subject} heading={copy.headline} footer={<Footer why={copy.why} links={links} />}>
      {s.mcpChanges.length > 0 && (
        <>
          <SectionTitle>MCP server changes</SectionTitle>
          {s.mcpChanges.map((c, i) => (
            <AlertRow
              key={`mcp-${i}`}
              label={c.severity === 'critical' || c.severity === 'high' ? c.severity : undefined}
              title={c.alias}
              detail={c.summary}
              url={c.url}
            />
          ))}
          <More shown={s.mcpChanges.length} total={s.mcpChangeTotal} />
        </>
      )}
      {s.alerts.length > 0 && (
        <>
          <SectionTitle>Breaking releases</SectionTitle>
          {s.alerts.map((a, i) => (
            <AlertRow key={`alert-${i}`} title={a.title} detail={a.detail} url={a.url} />
          ))}
          <More shown={s.alerts.length} total={s.alertTotal} />
        </>
      )}
      {s.unreadable.length > 0 && (
        <>
          <SectionTitle>Could not be read last scan</SectionTitle>
          {s.unreadable.map((u, i) => (
            <AlertRow key={`unread-${i}`} title={u.alias} detail={u.status.replace(/_/g, ' ')} url={u.url} />
          ))}
        </>
      )}
      {s.stale.length > 0 && (
        <>
          <SectionTitle>Not scanned in over a week</SectionTitle>
          {s.stale.map((u, i) => (
            <AlertRow key={`stale-${i}`} title={u.alias} detail={`last scanned ${u.days} days ago`} url={u.url} />
          ))}
        </>
      )}
    </Layout>
  );
}

WeeklyEmail.PreviewProps = { summary: sampleDigest(), links: sampleLinks } satisfies WeeklyEmailProps;
