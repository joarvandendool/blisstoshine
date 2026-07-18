// Draait `prisma migrate deploy` tijdens de build wanneer er een database
// bereikbaar is. Migraties horen op een directe (niet-gepoolde) verbinding:
// de POSTGRES_URL_NON_POOLING van de Vercel/Supabase-integratie heeft daarom
// voorrang. Zonder database-URL wordt de stap bewust overgeslagen zodat een
// kale build (zonder gekoppelde database) niet faalt.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const url =
  process.env.MIGRATE_DATABASE_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;

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
