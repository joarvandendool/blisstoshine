// Productiehardening (fase 10): security headers op alle routes.
//
// CSP-afweging: Next.js App Router injecteert inline <script>-tags voor
// hydration/streaming (zonder nonce-infrastructuur). Een strikte CSP zonder
// 'unsafe-inline' breekt de app; nonces vereisen middleware die elke response
// herschrijft. We kiezen bewust een pragmatische CSP: scripts alleen van eigen
// origin plus inline (nodig voor Next), geen externe bronnen, geen frames.
// Dit weert het grootste risico (externe scriptinjectie, clickjacking,
// data-exfiltratie naar vreemde hosts) zonder de app te breken. Aanscherpen
// naar nonce-based CSP kan later via middleware zonder dit bestand te slopen.
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline' is vereist voor de inline bootstrap-scripts van Next.js.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind/Next injecteren inline styles; eigen origin volstaat verder.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  // MIME-sniffing uit: responses worden nooit als ander type geïnterpreteerd.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking: de app mag nergens in een frame (frame-ancestors dekt
  // moderne browsers; X-Frame-Options de oudere).
  { key: "X-Frame-Options", value: "DENY" },
  // Referrer alleen als origin naar externe sites, volledig binnen eigen site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Gevoelige browser-API's die de app niet gebruikt expliciet uit.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS: alleen effectief over https (browsers negeren de header op http,
  // dus lokaal ontwikkelen blijft gewoon werken). 2 jaar, incl. subdomeinen.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
