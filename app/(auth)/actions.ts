"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  registerUser,
  verifyCredentials,
  setSessionCookie,
} from "@/lib/auth";
import { firstOrganizationOf } from "@/lib/authz";

export type AuthFormState = { error?: string } | null;

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

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    return { error: "E-mailadres of wachtwoord klopt niet" };
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
