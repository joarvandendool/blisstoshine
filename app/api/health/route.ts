import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Health check voor monitoring en deploy-verificatie. Lekt geen secrets.
export async function GET() {
  const checks: Record<string, boolean> = {
    database: false,
    sessionSecret: Boolean(
      process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32,
    ),
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json(
    { ready, checks, env: process.env.APP_ENV ?? "onbekend" },
    { status: ready ? 200 : 503 },
  );
}
