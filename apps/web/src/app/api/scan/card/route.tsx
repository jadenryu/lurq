import { ImageResponse } from "next/og";
import { archetypeLine, cardProfile, cardStats, type CardTier } from "@/lib/builder-brief";
import { ARCHETYPES, type BuilderProfile } from "@/lib/builder-profile";
import { fetchBuilderScan } from "@/lib/lurq-issuer";
import { ogFonts } from "@/lib/og-fonts";
import { currentOwner } from "@/lib/owner";

/**
 * The builder stats card, as a PNG: shown in the report's card viewer, and
 * downloaded from there with `?download=1`.
 *
 * Signed in only: the card is the trait scores, which /api/scan keeps from a
 * signed-out session, so an open card would be the gate with a hole in it.
 *
 * Reads the account's saved report first, so the card prints the numbers the
 * report on screen shows rather than a rescan that may have moved. Without one
 * it falls back to the backend profile route, which caches.
 *
 * Every number on it is computed in builder-brief.ts (`cardStats`,
 * `cardProfile`), where the reasoning for each is written down and tested. This
 * file only lays them out.
 *
 * Satori, not a browser: flex only, and every element with more than one child
 * says so. See app/opengraph-image.tsx for its other limits.
 */
export const dynamic = "force-dynamic";

/** 4:5, the portrait crop X, LinkedIn and Instagram all show uncut. */
const W = 1080;
const H = 1350;

const BG = "#09090b";
const PANEL = "rgba(255, 255, 255, 0.028)";
const EDGE = "rgba(255, 255, 255, 0.09)";
const TRACK = "rgba(255, 255, 255, 0.07)";
const INK = "#f2f2ee";
const INK_2 = "#a0a099";
const INK_3 = "#6f6f68";
const ALERT = "#f0916f";
const BEHIND = "#c9a96a";
const CURRENT = "rgba(242, 242, 238, 0.62)";
const MONO = "Geist Mono";
const GRID = 54;

/** Tier is the accent: the rating, the lead trait and the handle. */
const TIER: Record<CardTier, { accent: string; glow: string; name: string }> = {
  gold: { accent: "#f3d46b", glow: "rgba(243, 212, 107, 0.16)", name: "GOLD" },
  silver: { accent: "#dfe1e4", glow: "rgba(223, 225, 228, 0.11)", name: "SILVER" },
  bronze: { accent: "#e0a577", glow: "rgba(224, 165, 119, 0.14)", name: "BRONZE" },
};

async function loadProfile(
  ownerId: string,
  target: string,
): Promise<{ profile: BuilderProfile; scannedAt: Date } | null> {
  const saved = await fetchBuilderScan(ownerId, target).catch(() => null);
  if (saved) return { profile: saved.profile, scannedAt: new Date(saved.scannedAt) };

  const base = process.env.LURQ_MCP_URL;
  if (!base) return null;
  const res = await fetch(`${base.replace(/\/$/, "")}/scan/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  const profile = res?.ok ? ((await res.json().catch(() => null)) as BuilderProfile | null) : null;
  return profile ? { profile, scannedAt: new Date() } : null;
}

function Label({ children }: { children: string }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 17, letterSpacing: "0.16em", color: INK_3 }}>{children}</span>
  );
}

export async function GET(req: Request) {
  const owner = await currentOwner();
  if (!owner) return Response.json({ error: "Sign in to see your card." }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const target = params.get("target")?.slice(0, 200).trim();
  if (!target) return Response.json({ error: "Nothing to render." }, { status: 400 });

  const loaded = await loadProfile(owner.ownerId, target);
  if (!loaded) return Response.json({ error: "Could not read that profile." }, { status: 502 });

  const { profile, scannedAt } = loaded;
  const report = { ...profile, locked: null };
  const card = cardStats(report)!;
  const detail = cardProfile(report)!;
  const tier = TIER[card.tier];
  const type = ARCHETYPES[profile.archetype];
  const handle = profile.login.toLowerCase();
  const fresh = detail.freshness;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundColor: BG,
          backgroundImage: `radial-gradient(circle at 88% 6%, ${tier.glow}, transparent 46%)`,
          color: INK,
          fontFamily: "Geist",
          padding: "52px 60px 48px",
        }}
      >
        {/* Blueprint grid, faint enough to read as texture rather than lines. */}
        <svg width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }}>
          {Array.from({ length: Math.floor(W / GRID) }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * GRID} y1={0} x2={(i + 1) * GRID} y2={H} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
          ))}
          {Array.from({ length: Math.floor(H / GRID) }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={(i + 1) * GRID} x2={W} y2={(i + 1) * GRID} stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
          ))}
        </svg>

        {/* header: where this came from */}
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 19, color: INK_3 }}>
          <span>{`lurq://builder/${handle}`}</span>
          <span>{`ID ${detail.id} · SCANNED ${scannedAt.toISOString().slice(0, 10)}`}</span>
        </div>

        {/* identity */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 36 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile.avatarUrl.replace(/([?&])s(ize)?=\d+/, "$1s=400")}
            width={184}
            height={184}
            style={{ borderRadius: 28, border: `2px solid ${EDGE}` }}
            alt=""
          />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 36, marginRight: 24 }}>
            <Label>{"// BUILDER CLASS"}</Label>
            <span style={{ fontSize: 62, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1, marginTop: 14 }}>
              {type.name}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 26, color: tier.accent, marginTop: 12 }}>{`@${profile.login}`}</span>
            <div style={{ display: "flex", gap: 22, marginTop: 12, fontFamily: MONO, fontSize: 18 }}>
              {detail.github.map((g) => (
                <div key={g.label} style={{ display: "flex", gap: 8 }}>
                  <span style={{ color: INK }}>{g.value}</span>
                  <span style={{ color: INK_3 }}>{g.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "16px 26px 18px",
              borderRadius: 24,
              border: `2px solid ${tier.accent}`,
              backgroundColor: PANEL,
            }}
          >
            <span style={{ fontSize: 104, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.05em", color: tier.accent }}>
              {card.overall}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 19, color: INK_2, marginTop: 6 }}>{`OVR · ${card.position}`}</span>
            <span style={{ fontFamily: MONO, fontSize: 15, letterSpacing: "0.2em", color: tier.accent, marginTop: 6 }}>
              {tier.name}
            </span>
          </div>
        </div>

        <span style={{ fontSize: 23, lineHeight: 1.45, color: INK_2, marginTop: 24, maxWidth: 900 }}>{archetypeLine(report)}</span>

        {/* traits */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 30, paddingTop: 26, borderTop: `1px solid ${EDGE}` }}>
          <Label>TRAITS · 0–100</Label>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 18, gap: 16 }}>
            {detail.traits.map((t) => {
              const lead = t.id === profile.archetype;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ fontFamily: MONO, fontSize: 22, width: 72, color: lead ? tier.accent : INK }}>{t.code}</span>
                  <span style={{ fontSize: 21, width: 180, color: INK_2 }}>{t.name}</span>
                  <div style={{ display: "flex", flex: 1, height: 12, borderRadius: 6, backgroundColor: TRACK }}>
                    {t.score !== null && t.score > 0 && (
                      <div
                        style={{
                          display: "flex",
                          width: `${t.score}%`,
                          height: 12,
                          borderRadius: 6,
                          backgroundColor: lead ? tier.accent : "rgba(242, 242, 238, 0.55)",
                        }}
                      />
                    )}
                  </div>
                  <span
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      width: 76,
                      fontFamily: MONO,
                      fontSize: t.score === null ? 20 : 26,
                      color: t.score === null ? INK_3 : lead ? tier.accent : INK,
                    }}
                  >
                    {t.score === null ? "n/a" : String(t.score)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* languages / stack */}
        <div style={{ display: "flex", marginTop: 30, gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "24px 26px", borderRadius: 20, border: `1px solid ${EDGE}`, backgroundColor: PANEL }}>
            <Label>LANGUAGES · % OF REPOS</Label>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 18, gap: 16 }}>
              {detail.languages.length === 0 ? (
                <span style={{ fontSize: 20, color: INK_3 }}>none detected</span>
              ) : (
                detail.languages.map((l) => (
                  <div key={l.name} style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 21 }}>
                      <span>{l.name}</span>
                      <span style={{ fontFamily: MONO, color: INK_2 }}>{`${Math.round(l.share * 100)}%`}</span>
                    </div>
                    <div style={{ display: "flex", height: 5, borderRadius: 3, backgroundColor: TRACK, marginTop: 8 }}>
                      <div style={{ display: "flex", width: `${l.share * 100}%`, height: 5, borderRadius: 3, backgroundColor: INK_2 }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "24px 26px", borderRadius: 20, border: `1px solid ${EDGE}`, backgroundColor: PANEL }}>
            <Label>{`STACK · ${detail.stacks} ${detail.stacks === 1 ? "REPO" : "REPOS"}`}</Label>
            {detail.stacks === 0 ? (
              <span style={{ fontSize: 20, color: INK_3, marginTop: 18 }}>no package.json in the repos read</span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
                {detail.stack.map((s) => (
                  <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                    <span style={{ fontSize: 20, color: INK_2 }}>{s.label}</span>
                    <span style={{ fontFamily: MONO, fontSize: 24, color: s.alert ? ALERT : INK }}>{s.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* what they build with */}
        {detail.packages.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
            <Label>BUILDS WITH</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
              {detail.packages.map((name) => (
                <span
                  key={name}
                  style={{ fontFamily: MONO, fontSize: 20, color: INK, padding: "7px 16px", borderRadius: 999, border: `1px solid ${EDGE}`, backgroundColor: PANEL }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* footer: dependency freshness, from exact counts */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", paddingTop: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <Label>DEPENDENCY FRESHNESS</Label>
            {fresh ? (
              <div style={{ display: "flex", gap: 18, fontFamily: MONO, fontSize: 17 }}>
                <span style={{ color: CURRENT }}>{`${fresh.current} current`}</span>
                <span style={{ color: BEHIND }}>{`${fresh.behind} behind`}</span>
                <span style={{ color: ALERT }}>{`${fresh.major} a major behind`}</span>
              </div>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 17, color: INK_3 }}>no tracked dependencies</span>
            )}
          </div>
          <div style={{ display: "flex", height: 14, borderRadius: 7, backgroundColor: TRACK, marginTop: 14, gap: 3 }}>
            {fresh &&
              [
                { n: fresh.current, color: CURRENT },
                { n: fresh.behind, color: BEHIND },
                { n: fresh.major, color: ALERT },
              ]
                .filter((seg) => seg.n > 0)
                .map((seg) => (
                  <div
                    key={seg.color}
                    style={{ display: "flex", flex: seg.n, height: 14, borderRadius: 7, backgroundColor: seg.color }}
                  />
                ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 22 }}>
            <span style={{ fontFamily: MONO, fontSize: 19, color: INK_3 }}>what kind of builder are you?</span>
            <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>lurq.run</span>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: ogFonts,
      headers: {
        ...(params.has("download") ? { "Content-Disposition": `attachment; filename="lurq-${handle}.png"` } : {}),
        // The viewer's URL carries the save time, so a rescan is a new URL and
        // this can be cached without ever showing stale numbers.
        "Cache-Control": params.has("v") ? "private, max-age=3600" : "private, no-store",
      },
    },
  );
}
