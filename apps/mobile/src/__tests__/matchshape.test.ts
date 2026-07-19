// MatchShape-geometrie: deterministisch en identiek aan de webimplementatie
// (score domineert de afstand; dimensies moduleren subtiel).

import { berekenCompositie } from "../components/MatchShape";

it("hogere score → vormen dichter bij elkaar", () => {
  const laag = berekenCompositie(10);
  const midden = berekenCompositie(55);
  const hoog = berekenCompositie(95);
  expect(laag.afstand).toBeGreaterThan(midden.afstand);
  expect(midden.afstand).toBeGreaterThan(hoog.afstand);
});

it("is deterministisch voor dezelfde invoer", () => {
  const a = berekenCompositie(72, { availability: 0.8, technology: 0.3 });
  const b = berekenCompositie(72, { availability: 0.8, technology: 0.3 });
  expect(a).toEqual(b);
});

it("klemt score en dimensies binnen bereik", () => {
  expect(berekenCompositie(140).scoreRond).toBe(100);
  expect(berekenCompositie(-5).scoreRond).toBe(0);
  const extreem = berekenCompositie(50, { culture: 9 });
  expect(extreem.verhouding).toBeLessThanOrEqual(1.09);
});

it("availability verkleint de verticale afwijking", () => {
  const slecht = berekenCompositie(50, { availability: 0 });
  const goed = berekenCompositie(50, { availability: 1 });
  expect(goed.verticaleAfwijking).toBe(0);
  expect(slecht.verticaleAfwijking).toBeGreaterThan(0);
});
