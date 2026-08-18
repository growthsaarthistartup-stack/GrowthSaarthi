import { ImageResponse } from "next/og";

// Route segment config
export const runtime = "edge";

// Image metadata -- auto-wired by Next.js as og:image and twitter:image
export const alt = "GrowthSaarthi -- AI Chief of Staff for Founders";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          backgroundColor: "#ffffff",
          padding: "64px",
          fontFamily: "Arial, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background accent circles */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "480px",
            height: "480px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(25,152,116,0.12) 0%, rgba(255,255,255,0) 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "320px",
            height: "320px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(231,158,36,0.10) 0%, rgba(255,255,255,0) 70%)",
          }}
        />

        {/* Top: Logo + Brand name */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              backgroundColor: "#0B1A47",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#E79E24",
              fontWeight: 900,
              fontSize: "20px",
            }}
          >
            GS
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontWeight: 800, fontSize: "26px", color: "#0f172a", letterSpacing: "-0.5px" }}>
              Growth<span style={{ color: "#E79E24" }}>Saarthi</span>
            </span>
            <span style={{ fontWeight: 700, fontSize: "11px", color: "#199874", letterSpacing: "2px", textTransform: "uppercase" }}>
              Your AI Chief of Staff
            </span>
          </div>
        </div>

        {/* Center: Main headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1, justifyContent: "center" }}>
          <h1
            style={{
              fontSize: "56px",
              fontWeight: 900,
              color: "#0f172a",
              lineHeight: 1.05,
              letterSpacing: "-1px",
              margin: 0,
              maxWidth: "700px",
            }}
          >
            Automate Startup{" "}
            <span style={{ color: "#f45815" }}>Growth</span>{" "}
            with AI Agents
          </h1>
          <p
            style={{
              fontSize: "20px",
              color: "#475569",
              margin: 0,
              fontWeight: 600,
              maxWidth: "660px",
              lineHeight: 1.5,
            }}
          >
            SEO audits, competitor monitoring, retention workflows -- all on autopilot.
          </p>
        </div>

        {/* Bottom: Trust badges */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          {["24/7 AI Monitoring", "Stripe + GA4 + HubSpot", "Trust-Gated Automation"].map((badge) => (
            <div
              key={badge}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 20px",
                borderRadius: "100px",
                border: "1.5px solid #e2e8f0",
                backgroundColor: "#f8fafc",
                color: "#334155",
                fontSize: "14px",
                fontWeight: 700,
              }}
            >
              <span style={{ color: "#199874", fontSize: "16px", fontWeight: 900 }}>+</span>
              {badge}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}