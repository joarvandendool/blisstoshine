// Publieke navigatie-items — gedeeld tussen header (desktop + mobiel
// client-eiland) en footer. Alleen routes die echt bestaan (audit-P1 #4).

export interface PublicNavItem {
  href: string;
  label: string;
}

export const PUBLIC_NAV_ITEMS: PublicNavItem[] = [
  { href: "/vacatures", label: "Vacatures" },
  { href: "/registreren?type=praktijk", label: "Voor praktijken" },
  { href: "/inloggen", label: "Inloggen" },
];
