// @mondzorgwerkt/api-contract — het enige gedeelde oppervlak tussen de
// webapp/server en de mobiele kandidaat-app.
//
// Regels:
// - uitsluitend pure TypeScript: types, canonieke waarden, decoders en
//   zuivere utilities;
// - NOOIT Prisma, databaseclients, server-only modules of geheimen;
// - de taxonomie wordt her-geëxporteerd uit src/domain/taxonomy (zelf puur),
//   zodat web en mobiel dezelfde literalen delen in plaats van kopieën;
// - statuswaarden die in server-only bestanden leven (Prisma-enums,
//   pipeline.ts, notifications.ts) staan hier als literalen en worden door
//   tests/domain/mobile-contract.test.ts op pariteit bewaakt.

export * from "./taxonomy";
export * from "./enums";
export * from "./matching";
export * from "./api";
export * from "./decode";
export * from "./deeplinks";
