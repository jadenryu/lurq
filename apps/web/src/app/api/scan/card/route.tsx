import { ImageResponse } from "next/og";
import { cardProfile, cardStats, type CardTier } from "@/lib/builder-brief";
import { ARCHETYPES, type BuilderProfile } from "@/lib/builder-profile";
import { fetchBuilderScan } from "@/lib/lurq-issuer";
import { ogFonts } from "@/lib/og-fonts";
import { currentOwner } from "@/lib/owner";

/**
 * The builder stats card, as a PNG to download and post.
 *
 * Signed in only: the card is the trait scores, which /api/scan keeps from a
 * signed-out session, so an open card would be the gate with a hole in it.
 *
 * Reads the account's saved report first, so the card prints the numbers the
 * report on screen shows rather than a rescan that may have moved. Without one
 * it falls back to the backend profile route, which caches.
 *
 * An instrument readout, not a trading card: every mark on it is one of their
 * numbers (traits, languages, stack health, the packages they actually use),
 * and the scan id and signal strip are derived from the login, so two people
 * with the same scores still get different cards.
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
const MONO = "Geist Mono";
const GRID = 54;

/** Tier is the accent: the rating, the lead trait's bar and the signal strip. */
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
  if (!owner) return Response.json({ error: "Sign in to export your card." }, { status: 401 });

  const target = new URL(req.url).searchParams.get("target")?.slice(0, 200).trim();
  if (!target) return Response.json({ error: "Nothing to export." }, { status: 400 });

  const loaded = await loadProfile(owner.ownerId, target);
  if (!loaded) return Response.json({ error: "Could not read that profile." }, { status: 502 });

  const { profile, scannedAt } = loaded;
  const report = { ...profile, locked: null };
  const card = cardStats(report)!;
  const detail = cardProfile(report)!;
  const tier = TIER[card.tier];
  const type = ARCHETYPES[profile.archetype];
  const handle = profile.login.toLowerCase();

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
          <span>{`SCAN ${detail.id} · ${scannedAt.toISOString().slice(0, 10)}`}</span>
        </div>

        {/* identity */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 40 }}>
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

        <span style={{ fontSize: 23, lineHeight: 1.45, color: INK_2, marginTop: 28, maxWidth: 900 }}>{type.line}</span>

        {/* traits */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 38, paddingTop: 30, borderTop: `1px solid ${EDGE}` }}>
          <Label>TRAITS</Label>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 22, gap: 20 }}>
            {detail.traits.map((t) => {
              const lead = t.id === profile.archetype;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ fontFamily: MONO, fontSize: 22, width: 72, color: lead ? tier.accent : INK }}>{t.label}</span>
                  <span style={{ fontSize: 21, width: 180, color: INK_2 }}>{t.name}</span>
                  <div style={{ display: "flex", flex: 1, height: 12, borderRadius: 6, backgroundColor: TRACK }}>
                    {t.score !== null && (
                      <div
                        style={{
                          display: "flex",
                          width: `${Math.max(2, t.score)}%`,
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
                      fontSize: 26,
                      color: lead ? tier.accent : INK,
                    }}
                  >
                    {t.score === null ? "--" : String(t.score)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* languages / stack */}
        <div style={{ display: "flex", marginTop: 36, gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "24px 26px", borderRadius: 20, border: `1px solid ${EDGE}`, backgroundColor: PANEL }}>
            <Label>LANGUAGES</Label>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 18, gap: 16 }}>
              {detail.languages.length === 0 ? (
                <span style={{ fontSize: 20, color: INK_3 }}>none read</span>
              ) : (
                detail.languages.map((l) => (
                  <div key={l.name} style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 21 }}>
                      <span>{l.name}</span>
                      <span style={{ fontFamily: MONO, color: INK_2 }}>{`${Math.round(l.share * 100)}%`}</span>
                    </div>
                    <div style={{ display: "flex", height: 5, borderRadius: 3, backgroundColor: TRACK, marginTop: 8 }}>
                      <div style={{ display: "flex", width: `${Math.max(2, l.share * 100)}%`, height: 5, borderRadius: 3, backgroundColor: INK_2 }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "24px 26px", borderRadius: 20, border: `1px solid ${EDGE}`, backgroundColor: PANEL }}>
            <Label>STACK</Label>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
              {detail.stack.map((s) => (
                <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0" }}>
                  <span style={{ fontSize: 20, color: INK_2 }}>{s.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 24, color: s.alert ? ALERT : INK }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* what they build with */}
        {detail.packages.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
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

        {/* footer: their signal, and where to get one */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", height: 46, gap: 5 }}>
            {detail.signal.map((v, i) => (
              <div
                key={i}
                style={{ display: "flex", flex: 1, height: Math.round(v * 46), borderRadius: 2, backgroundColor: tier.accent, opacity: 0.15 + v * 0.6 }}
              />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 18 }}>
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
        "Content-Disposition": `attachment; filename="lurq-${handle}.png"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
