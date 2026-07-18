// Draait `prisma migrate deploy` tijdens de build wanneer er een database
// bereikbaar is. Migraties horen op een directe (niet-gepoolde) verbinding:
// de POSTGRES_URL_NON_POOLING van de Vercel/Supabase-integratie heeft daarom
// voorrang. Zonder database-URL wordt de stap bewust overgeslagen zodat een
// kale build (zonder gekoppelde database) niet faalt.
import "dotenv/config";
import { spawnSync } from "node:child_process";

// Zelfde schema-regel als src/lib/db.ts: integratie-URL's draaien in het
// eigen "mondzorgwerkt"-schema zodat bestaande tabellen in "public" van een
// eerder project onaangeroerd blijven (en P3005 niet optreedt).
function withAppSchema(u) {
  if (/[?&]schema=/.test(u)) return u;
  return u + (u.includes("?") ? "&" : "?") + "schema=mondzorgwerkt";
}

const expliciet = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
const integratie =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
const url = expliciet ?? (integratie ? withAppSchema(integratie) : undefined);

if (!url) {
  console.warn("deploy-migrate: geen database-URL gevonden — migraties overgeslagen.");
  process.exit(0);
}

console.log("deploy-migrate: prisma migrate deploy…");
const res = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(res.status ?? 1);
