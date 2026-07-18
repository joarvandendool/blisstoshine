// Kleine databasehelper voor de e2e-tests: één PrismaClient die DATABASE_URL
// uit .env leest (Playwright laadt .env niet zelf; Next.js wel). Wordt
// uitsluitend gebruikt voor verificatie (stap 10: AnalyticsEvents) — de tests
// muteren de database nooit rechtstreeks.

import path from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: path.resolve(__dirname, "..", ".env") });

export const db = new PrismaClient();
