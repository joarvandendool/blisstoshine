// Bewaartermijnen-opruiming (fase 10). Draait de retentiefuncties uit
// src/server/privacy.ts (één bron van waarheid voor de termijnen):
//
//   AnalyticsEvent   > 24 maanden  → verwijderen
//   Notification     > 6 maanden   → verwijderen
//   OutboxEmail sent > 3 maanden   → verwijderen
//   RateLimitCounter > 7 dagen     → verwijderen
//   draft-profielen  > 18 maanden  → anonimiseren
//
// GEBRUIK (let op: via tsx, want dit script importeert TypeScript):
//   npx tsx scripts/retention.mjs            # droogloop (standaard): telt alleen
//   npx tsx scripts/retention.mjs --apply    # verwijdert/anonimiseert echt
//
// dotenv laadt .env; de database komt uit DATABASE_URL (of de Vercel/Supabase-
// integratievariabelen, zie src/lib/db.ts). Cron-aanroep: zie docs/OPERATIONS.md.

import "dotenv/config";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.includes("--dry-run") && apply) {
  console.error("retention: kies óf --dry-run óf --apply, niet beide.");
  process.exit(1);
}

let privacy;
let db;
try {
  privacy = await import("../src/server/privacy.ts");
  db = await import("../src/lib/db.ts");
} catch (fout) {
  console.error(
    "retention: kon src/server/privacy.ts niet laden. Draai dit script via tsx:\n" +
      "  npx tsx scripts/retention.mjs [--apply]",
  );
  console.error(fout instanceof Error ? fout.message : fout);
  process.exit(1);
}

const nu = new Date();
console.log(
  `retention: ${apply ? "OPRUIMEN (--apply)" : "droogloop (--dry-run, standaard)"} — nu = ${nu.toISOString()}`,
);
console.log(
  `retention: termijnen — analytics ${privacy.RETENTIE_ANALYTICS_EVENT_MAANDEN} mnd, ` +
    `notificaties ${privacy.RETENTIE_NOTIFICATIE_MAANDEN} mnd, ` +
    `outbox (sent) ${privacy.RETENTIE_OUTBOX_SENT_MAANDEN} mnd, ` +
    `rate limits ${privacy.RETENTIE_RATE_LIMIT_DAGEN} dgn, ` +
    `draft-profielen ${privacy.RETENTIE_DRAFT_PROFIEL_MAANDEN} mnd`,
);

try {
  const resultaat = await privacy.runRetentie(nu, apply);
  const werkwoord = apply ? "verwijderd/geanonimiseerd" : "zou verwijderen/anonimiseren";
  console.log(`retention (${werkwoord}):`);
  console.log(`  AnalyticsEvent:     ${resultaat.analyticsEvents}`);
  console.log(`  Notification:       ${resultaat.notificaties}`);
  console.log(`  OutboxEmail (sent): ${resultaat.outboxEmails}`);
  console.log(`  RateLimitCounter:   ${resultaat.rateLimitCounters}`);
  console.log(`  Draft-profielen:    ${resultaat.draftProfielen}`);
  if (!apply) {
    console.log("retention: droogloop — er is niets gewijzigd. Gebruik --apply om op te ruimen.");
  }
} finally {
  await db.prisma.$disconnect();
}
