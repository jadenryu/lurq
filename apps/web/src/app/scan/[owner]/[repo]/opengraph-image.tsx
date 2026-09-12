import { ImageResponse } from "next/og";
import { scanRepo } from "@/lib/public-scan";

/**
 * The social card for one repo's report: their numbers, on the picture.
 *
 * This is the half of the share loop that does the work. A link with the
 * generic lurq card is an ad for a product; a link that says "14 a major
 * behind, 3 conflicts" about the reader's own org is an argument, and it gets
 * made in the timeline before anybody decides whether to click. The card IS
 * the pitch, the page is the proof.
 *
 * Same Satori constraints as app/opengraph-image.tsx — no woff2, no oklch, so
 * the default face and pre-converted sRGB. See that file for why.
 *
 * The scan is the backend's cached one (lib/public-scan), the same call the
 * page makes, so rendering a card costs a JSON fetch rather than a second scan.
 */
export const alt = "Dependency drift, read from the repository's manifest";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** tokens.css, the values a browser would compute. */
const GROUND = "#08080a";
const INK = "#f2f2ee";
const INK_2 = "#a0a099";
const INK_3 = "#82827a";
const EDGE = "#232328";
/** oklch(0.646 0.222 41.116) — `--rail`, the colour a bad number is printed in. */
const RAIL = "#f54900";
/** oklch(0.646 0.222 41.116), at the strength GradientBlob paints it. */
const BLOOM_FROM_SOFT = "rgba(245, 73, 0, 0.20)";
/** oklch(0.488 0.243 264.376) */
const BLOOM_TO_SOFT = "rgba(20, 71, 230, 0.28)";

function Stat({ n, label, hot }: { n: number; label: string; hot?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 250 }}>
      <span style={{ fontSize: 76, fontWeight: 500, color: hot && n > 0 ? RAIL : INK }}>{n}</span>
      <span style={{ fontSize: 22, color: INK_3, marginTop: 6 }}>{label}</span>
    </div>
  );
}

export default async function ScanCard({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const scan = await scanRepo(owner, repo);
  const full = `${owner}/${repo}`;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: GROUND,
          backgroundImage: `radial-gradient(circle at 18% 12%, ${BLOOM_FROM_SOFT}, transparent 55%), radial-gradient(circle at 86% 92%, ${BLOOM_TO_SOFT}, transparent 55%)`,
          padding: "0 70px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24 }}>
          <span
            style={{
              border: `1px solid ${EDGE}`,
              borderRadius: 999,
              padding: "7px 18px",
              color: INK_2,
            }}
          >
            lurq
          </span>
          <span style={{ color: INK_3 }}>dependency drift</span>
        </div>

        <div style={{ display: "flex", fontSize: 54, fontWeight: 500, color: INK, marginTop: 34 }}>
          {full}
        </div>

        {scan && scan.depsTracked > 0 ? (
          <>
            <div style={{ display: "flex", marginTop: 46 }}>
              <Stat n={scan.depsTracked} label="dependencies read" />
              <Stat n={scan.majorDrift} label="a major behind" hot />
              <Stat n={scan.advisories} label="advisories" hot />
              <Stat n={scan.conflicts} label="conflicts at latest" hot />
            </div>
            <div style={{ display: "flex", fontSize: 23, color: INK_3, marginTop: 50 }}>
              Read from the root package.json · lurq.run
            </div>
          </>
        ) : (
          <div style={{ display: "flex", fontSize: 30, color: INK_2, marginTop: 40, width: 900 }}>
            Scan any public repository for drift, advisories and upgrade conflicts.
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
