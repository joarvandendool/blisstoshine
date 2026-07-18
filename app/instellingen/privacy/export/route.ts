// GET /instellingen/privacy/export — JSON-download van de eigen gegevens
// (AVG art. 15/20).
//
// AUTORISATIE: requireUser() — de export bevat uitsluitend gegevens van de
// ingelogde gebruiker zelf (zie exporteerEigenGegevens). Een GET met cookie is
// hier veilig: het verzoek muteert niets van betekenis (registreert alleen het
// verzoek zelf) en een cross-site-aanvaller kan de response nooit lezen.

import { NextResponse } from "next/server";
import { AuthzError, requireUser } from "@/lib/authz";
import { exporteerEigenGegevens } from "@/server/privacy";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const gegevens = await exporteerEigenGegevens(user.id);
    return new NextResponse(JSON.stringify(gegevens, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="mondzorgwerkt-gegevens.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (fout) {
    if (fout instanceof AuthzError) {
      return NextResponse.json({ fout: fout.message }, { status: fout.status });
    }
    console.error("Privacy-export mislukt:", fout);
    return NextResponse.json(
      { fout: "De export is niet gelukt. Probeer het later opnieuw." },
      { status: 500 },
    );
  }
}
