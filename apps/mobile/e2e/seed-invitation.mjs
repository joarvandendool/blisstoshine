// Seed een uitnodiging + voorgesteld gesprek voor de opgegeven demo-gebruiker
// (simuleert de praktijkkant, die buiten de scope van de kandidaat-app valt).
import { PrismaClient } from "@prisma/client";

const email = process.argv[2];
if (!email) throw new Error("gebruik: node seed-invitation.mjs <email>");

const prisma = new PrismaClient({
  datasources: { db: { url: "postgresql://mzw:mzw@localhost:5432/mondzorgwerkt" } },
});

const user = await prisma.user.findUnique({ where: { email } });
if (!user) throw new Error(`gebruiker ${email} niet gevonden`);

const vacature = await prisma.vacancy.findFirst({
  where: { status: "published", role: "mondhygienist", organization: { status: "active" } },
  include: { organization: { include: { memberships: true } }, location: true },
});
if (!vacature) throw new Error("geen gepubliceerde mondhygiënist-vacature");

const eigenaar = vacature.organization.memberships[0];

await prisma.invitation.upsert({
  where: { vacancyId_candidateUserId: { vacancyId: vacature.id, candidateUserId: user.id } },
  create: {
    vacancyId: vacature.id,
    candidateUserId: user.id,
    message: "We zien een sterke match met je werkweek — kom je kennismaken?",
  },
  update: {},
});

const overMorgen = new Date(Date.now() + 2 * 24 * 3600 * 1000);
overMorgen.setHours(10, 0, 0, 0);
const overDrieDagen = new Date(Date.now() + 3 * 24 * 3600 * 1000);
overDrieDagen.setHours(16, 30, 0, 0);

await prisma.interview.create({
  data: {
    vacancyId: vacature.id,
    candidateUserId: user.id,
    proposedByUserId: eigenaar?.userId ?? user.id,
    message: "Wanneer schikt het jou?",
    slots: [
      { startsAt: overMorgen.toISOString(), durationMinutes: 45 },
      { startsAt: overDrieDagen.toISOString(), durationMinutes: 45 },
    ],
  },
});

await prisma.notification.create({
  data: {
    userId: user.id,
    type: "invitation_received",
    title: "Persoonlijke uitnodiging ontvangen",
    body: `${vacature.organization.name} nodigt je uit voor “${vacature.title}” in ${vacature.location.city}.`,
    href: "/kandidaat/uitnodigingen",
    dedupeKey: `invite-${vacature.id}-${user.id}`,
    meta: { vacancyId: vacature.id },
  },
});

console.log("uitnodiging + gesprek + notificatie aangemaakt voor", email);
await prisma.$disconnect();
