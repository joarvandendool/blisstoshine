// Vervangen door de doorlopende commerciële onboarding op /praktijk/start.
// Deze route blijft bestaan voor oude links en verwijst direct door;
// nieuw-form.tsx en actions.ts blijven (ongebruikt) staan.

import { redirect } from "next/navigation";

export default function NieuwePraktijkPagina() {
  redirect("/praktijk/start");
}
