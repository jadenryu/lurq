import { ImageResponse } from "next/og";
import { auth } from "@clerk/nextjs/server";
import { cardStats, type CardTier } from "@/lib/builder-brief";
import { ARCHETYPES, type BuilderProfile } from "@/lib/builder-profile";
import { ogFonts } from "@/lib/og-fonts";

/**
 * The builder stats card, as a PNG to download and post.
 *
 * Signed in only: the card is the trait scores, which /api/scan keeps from a
 * signed-out session, so an open card would be the gate with a hole in it.
 * The profile comes from the same backend route the report reads, which caches
 * it, so exporting right after viewing costs nothing.
 *
 * Satori, not a browser: see app/opengraph-image.tsx for its limits.
 */
export const dynamic = "force-dynamic";

const W = 600;
const H = 840;

const INK = "#f2f2ee";
const INK_2 = "#a0a099";
const INK_3 = "#82827a";

/** Metal per tier: the rim gradient and the colour of the big number. */
const METAL: Record<CardTier, { rim: string; accent: string; glow: string }> = {
  gold: { rim: "linear-gradient(160deg, #f6e27a, #b8892b 45%, #fbeaa0 70%, #8a6414)", accent: "#f3d46b", glow: "rgba(243, 212, 107, 0.22)" },
  silver: { rim: "linear-gradient(160deg, #f4f4f2, #8f9399 45%, #e6e7ea 70%, #62666c)", accent: "#dfe1e4", glow: "rgba(223, 225, 228, 0.18)" },
  bronze: { rim: "linear-gradient(160deg, #e8b184, #8a5330 45%, #dca070 70%, #5e3419)", accent: "#e0a577", glow: "rgba(224, 165, 119, 0.2)" },
};

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to export your card." }, { status: 401 });

  const base = process.env.LURQ_MCP_URL;
  const target = new URL(req.url).searchParams.get("target")?.slice(0, 200).trim();
  if (!base || !target) return Response.json({ error: "Nothing to export." }, { status: 400 });

  const res = await fetch(`${base.replace(/\/$/, "")}/scan/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  const profile = res?.ok ? ((await res.json().catch(() => null)) as BuilderProfile | null) : null;
  if (!profile) return Response.json({ error: "Could not read that profile." }, { status: 502 });

  const card = cardStats({ ...profile, locked: null })!;
  const metal = METAL[card.tier];
  const left = card.stats.slice(0, 3);
  const right = card.stats.slice(3);

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14, fontSize: 34 }}>
      <span style={{ fontWeight: 700, color: INK, width: 78, justifyContent: "flex-end", display: "flex" }}>{value}</span>
      <span style={{ fontWeight: 500, color: INK_2, letterSpacing: "0.04em" }}>{label}</span>
    </div>
  );

  return new ImageResponse(
    (
      // The rim is the outer box's background showing through its padding.
      // Transparent outside the rim, so a posted card has no black corners.
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 18 }}>
        <div style={{ flex: 1, display: "flex", backgroundImage: metal.rim, borderRadius: 44, padding: 5 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              borderRadius: 40,
              backgroundColor: "#0e0e11",
              backgroundImage: `radial-gradient(circle at 50% 22%, ${metal.glow}, transparent 60%)`,
              color: INK,
              fontFamily: "Geist",
              padding: "40px 44px 32px",
            }}
          >
            <div style={{ display: "flex", width: "100%", alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 130 }}>
                <span style={{ fontSize: 104, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.05em", color: metal.accent }}>
                  {card.overall}
                </span>
                <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: "0.06em", color: INK, marginTop: 4 }}>
                  {card.position}
                </span>
                <span style={{ fontSize: 18, fontWeight: 500, color: INK_3, marginTop: 18 }}>lurq</span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${profile.avatarUrl.replace(/size=\d+/, "size=420")}`}
                width={260}
                height={260}
                style={{ marginLeft: "auto", borderRadius: 999, border: `4px solid ${metal.accent}` }}
                alt=""
              />
            </div>

            <span
              style={{
                marginTop: 34,
                fontSize: profile.login.length > 14 ? 38 : 50,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {profile.login.toUpperCase()}
            </span>
            <span style={{ fontSize: 22, fontWeight: 500, color: metal.accent, marginTop: 6 }}>
              {ARCHETYPES[profile.archetype].name}
            </span>

            <div style={{ display: "flex", width: "86%", height: 2, background: metal.rim, marginTop: 26, opacity: 0.7 }} />

            <div style={{ display: "flex", width: "100%", justifyContent: "center", gap: 36, marginTop: 26 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {left.map((s) => <Stat key={s.label} {...s} />)}
              </div>
              <div style={{ display: "flex", width: 2, background: metal.rim, opacity: 0.5 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {right.map((s) => <Stat key={s.label} {...s} />)}
              </div>
            </div>

            <span style={{ marginTop: "auto", fontSize: 18, color: INK_3 }}>lurq.run · what kind of builder are you?</span>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: ogFonts,
      headers: {
        "Content-Disposition": `attachment; filename="lurq-${profile.login}.png"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
