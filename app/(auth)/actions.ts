"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  registerUser,
  verifyCredentials,
  setSessionCookie,
} from "@/lib/auth";
import { firstOrganizationOf } from "@/lib/authz";
import { peekRateLimit, rateLimit } from "@/lib/rate-limit";

export type AuthFormState = { error?: string } | null;

// Generieke melding bij rate limiting/lockout — verklapt bewust niet of het
// account bestaat of hoeveel pogingen er resteren.
const TE_VEEL_POGINGEN = "Te veel pogingen. Probeer het over een paar minuten opnieuw.";

const KWARTIER_SECONDEN = 15 * 60;
const UUR_SECONDEN = 60 * 60;

/** Client-IP uit de proxy-headers; "onbekend" als die ontbreken (dev). */
async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "onbekend";
}

const registerSchema = z.object({
  name: z.string().min(2, "Vul je naam in"),
  email: z.string().email("Vul een geldig e-mailadres in"),
  password: z.string().min(8, "Wachtwoord moet minimaal 8 tekens zijn"),
  accountType: z.enum(["kandidaat", "praktijk"]),
});

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    accountType: formData.get("accountType") ?? "kandidaat",
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Ongeldige invoer" };
  }
  const { name, email, password, accountType } = parsed.data;

  // Registratie-spam beperken: maximaal 5 registraties per uur per IP.
  const ip = await clientIp();
  const registratieLimiet = await rateLimit(`register:${ip}`, {
    limit: 5,
    windowSeconds: UUR_SECONDEN,
  });
  if (!registratieLimiet.allowed) {
    return { error: TE_VEEL_POGINGEN };
  }

  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (existing) {
    return { error: "Er bestaat al een account met dit e-mailadres" };
  }

  const user = await registerUser({ name, email, password });
  await setSessionCookie(user.id);

  redirect(accountType === "praktijk" ? "/praktijk/start" : "/kandidaat/onboarding");
}

const loginSchema = z.object({
  email: z.string().email("Vul een geldig e-mailadres in"),
  password: z.string().min(1, "Vul je wachtwoord in"),
});

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Ongeldige invoer" };
  }
  const email = parsed.data.email.toLowerCase().trim();

  // Brute force beperken: per e-mailadres én per IP, plus een lockout op
  // mislukte pogingen (aparte teller die alleen bij een mislukking oploopt;
  // hier alleen gelezen zodat een vol venster óók een juist wachtwoord blokkeert).
  const ip = await clientIp();
  const [perEmail, perIp, mislukteLogins] = await Promise.all([
    rateLimit(`login:${email}`, { limit: 10, windowSeconds: KWARTIER_SECONDEN }),
    rateLimit(`login-ip:${ip}`, { limit: 30, windowSeconds: KWARTIER_SECONDEN }),
    peekRateLimit(`login-fail:${email}`, { limit: 8, windowSeconds: KWARTIER_SECONDEN }),
  ]);
  if (!perEmail.allowed || !perIp.allowed || !mislukteLogins.allowed) {
    return { error: TE_VEEL_POGINGEN };
  }

  const user = await verifyCredentials(email, parsed.data.password);
  if (!user) {
    const naMislukking = await rateLimit(`login-fail:${email}`, {
      limit: 8,
      windowSeconds: KWARTIER_SECONDEN,
    });
    return {
      error: naMislukking.allowed
        ? "E-mailadres of wachtwoord klopt niet"
        : TE_VEEL_POGINGEN,
    };
  }
  await setSessionCookie(user.id);

  // Route naar de juiste omgeving: praktijk als de gebruiker lid is van een
  // organisatie, anders de kandidaatomgeving.
  if (user.isPlatformAdmin) redirect("/intern");
  const membership = await firstOrganizationOf(user.id);
  if (membership) redirect(`/praktijk/${membership.organization.slug}`);

  const profile = await prisma.candidateProfile.findUnique({
    where: { userId: user.id },
    select: { status: true },
  });
  redirect(profile && profile.status !== "draft" ? "/kandidaat" : "/kandidaat/onboarding");
}
