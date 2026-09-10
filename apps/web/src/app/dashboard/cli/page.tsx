import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { CliHandoff } from "@/components/dashboard/cli-handoff";

/**
 * Where `lurq setup` sends the browser.
 *
 * Under /dashboard on purpose: the proxy already protects that prefix, so an
 * unauthenticated visitor is sent through sign-in and returned here with the
 * port and nonce intact. Signing in IS the step, which is the point of the
 * whole flow, and no separate auth route had to exist for it.
 *
 * See src/cli/browserAuth.ts for the other half.
 */
export default async function CliConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawPort = typeof params.port === "string" ? Number(params.port) : NaN;
  // Ephemeral ports only. A number outside this range did not come from the
  // CLI's listener, so there is nothing on the other end worth minting a key for.
  const port =
    Number.isInteger(rawPort) && rawPort >= 1024 && rawPort <= 65535 ? rawPort : null;
  const nonce = typeof params.nonce === "string" ? params.nonce.slice(0, 128) : null;

  return (
    <div>
      <PageHeader
        title="connect your terminal"
        subtitle="One click, and the key lands in the terminal that sent you here."
      />
      <PageBody>
        <CliHandoff port={port} nonce={nonce} />
      </PageBody>
    </div>
  );
}
