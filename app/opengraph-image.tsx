// Gegenereerde social-share-afbeelding (fase 9) op /opengraph-image.
// Eén lichte, statisch gegenereerde compositie volgens de
// MatchShapeShare-vormtaal (src/components/MatchShape.tsx): twee organische
// vormen — kandidaat en praktijk — die overlappen, met wordmark en uitleg.
// Alle publieke routes verwijzen hiernaar via paginaMetadata (seo.ts);
// zwaardere per-route-afbeeldingen kunnen later additief worden toegevoegd.

import { ImageResponse } from "next/og";

export const alt =
  "mondzorgwerkt — twee vormen, één overlap: hoe meer jouw week en de praktijk overlappen, hoe sterker de match.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "linear-gradient(135deg, #f4f8fc 0%, #cddfee 100%)",
          fontFamily: "sans-serif",
        }}
      >
        {/* de matchvorm: kandidaat (cobalt) en praktijk (licht) overlappen */}
        <div
          style={{
            position: "absolute",
            top: 60,
            right: 90,
            width: 460,
            height: 460,
            display: "flex",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 40,
              width: 320,
              height: 340,
              background: "#0120ec",
              opacity: 0.92,
              borderRadius: "58% 42% 55% 45% / 52% 48% 52% 48%",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 170,
              top: 90,
              width: 290,
              height: 310,
              background: "#ffffff",
              opacity: 0.65,
              borderRadius: "45% 55% 48% 52% / 55% 45% 55% 45%",
            }}
          />
        </div>

        <div style={{ display: "flex", fontSize: 44, fontWeight: 600 }}>
          <span style={{ color: "#0a0d1c" }}>mondzorg</span>
          <span style={{ color: "#0120ec", fontStyle: "italic" }}>werkt</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 640,
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              color: "#0a0d1c",
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            Werk dat bij je week past.
          </div>
          <div style={{ fontSize: 30, color: "#3b4252", lineHeight: 1.35 }}>
            Matches op werkdagen, vakinhoud, technologie en ambities — voor
            professionals en praktijken in de mondzorg.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
