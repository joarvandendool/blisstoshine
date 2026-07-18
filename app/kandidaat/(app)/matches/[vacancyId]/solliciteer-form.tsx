"use client";

// Sollicitatieformulier op de matchdetailpagina: één primaire actie met een
// motivatieveld. De server action (solliciteerAction) doet de echte
// sollicitatie; na succes toont de gerevalideerde pagina de status.

import { useActionState } from "react";
import {
  solliciteerAction,
  type SolliciteerFormState,
} from "./actions";
import { Button, Field, Textarea } from "@/components/ui";

export interface SolliciteerFormProps {
  vacancyId: string;
  /** Voor een persoonlijke placeholder, bv. de praktijknaam. */
  praktijkNaam: string;
}

export function SolliciteerForm({ vacancyId, praktijkNaam }: SolliciteerFormProps) {
  const [state, formAction, bezig] = useActionState<SolliciteerFormState, FormData>(
    solliciteerAction.bind(null, vacancyId),
    null,
  );

  if (state?.status === "gelukt") {
    return (
      <p
        role="status"
        className="rounded-2xl bg-brand-light/60 px-4 py-3 text-[15px] font-medium text-blauw-900"
      >
        Je sollicitatie is verstuurd. {praktijkNaam} ziet je match en motivatie
        en neemt contact met je op.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.status === "fout" ? (
        <p
          role="alert"
          className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {state.melding}
        </p>
      ) : null}

      <Field
        label="Motivatie"
        htmlFor="motivatie"
        hint="Optioneel, maar een korte persoonlijke motivatie vergroot je kans op een reactie."
      >
        <Textarea
          id="motivatie"
          name="motivatie"
          rows={5}
          maxLength={2000}
          placeholder={`Vertel ${praktijkNaam} kort waarom deze plek bij je past…`}
          disabled={bezig}
        />
      </Field>

      <Button type="submit" size="lg" disabled={bezig} className="self-start">
        {bezig ? "Bezig met versturen…" : "Solliciteer op deze vacature"}
      </Button>
    </form>
  );
}

export default SolliciteerForm;
