/**
 * The urgent alert email. Preview it live with `npm run email:dev`.
 */
import { AlertRow, Footer, Layout } from './components';
import { KIND_LABEL, urgentCopy } from './copy';
import { sampleLinks, sampleUrgent } from './samples';
import type { Links, UrgentItem } from './types';

export interface UrgentEmailProps {
  items: UrgentItem[];
  links: Links;
}

export default function UrgentEmail({ items, links }: UrgentEmailProps) {
  const copy = urgentCopy(items);
  return (
    <Layout preview={copy.subject} heading={copy.intro} footer={<Footer why={copy.why} links={links} />}>
      {items.map((item) => (
        <AlertRow key={item.key} label={KIND_LABEL[item.kind]} title={item.title} detail={item.detail} url={item.url} />
      ))}
    </Layout>
  );
}

UrgentEmail.PreviewProps = { items: sampleUrgent(), links: sampleLinks } satisfies UrgentEmailProps;
