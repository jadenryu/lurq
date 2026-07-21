import { ImageResponse } from "next/og";

export const alt = "lurq: objective package recommendations for AI coding agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Branded social card, generated at build time so shared links render a real
// preview instead of a bare URL. Monochrome to match the site.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: "-0.04em" }}>lurq</div>
        <div
          style={{
            marginTop: 28,
            fontSize: 40,
            lineHeight: 1.25,
            color: "#a1a1a1",
            maxWidth: 900,
          }}
        >
          Objective, evidence-scored package recommendations for AI coding agents.
        </div>
      </div>
    ),
    { ...size },
  );
}
