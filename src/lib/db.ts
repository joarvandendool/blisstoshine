import { PrismaClient } from "@prisma/client";

/**
 * Database-URL met fallbacks: expliciete DATABASE_URL wint; anders de
 * variabelen die de Vercel/Supabase-integratie injecteert (de gepoolde
 * POSTGRES_PRISMA_URL is daar de juiste voor runtimeverkeer). Zo draait de
 * app op Vercel zonder handmatige env-configuratie.
 *
 * Bij de integratie-URL's draait de app in een eigen Postgres-schema
 * ("mondzorgwerkt"), zodat eventuele bestaande tabellen van een eerder
 * project in "public" onaangeroerd blijven.
 */
export function withAppSchema(url: string): string {
  if (/[?&]schema=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "schema=mondzorgwerkt";
}

export function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const integratie =
    process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL;
  return integratie ? withAppSchema(integratie) : undefined;
}

// Singleton: voorkomt connection-uitputting bij hot reload in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const databaseUrl = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
