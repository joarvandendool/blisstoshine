import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Payload = {
  first_name?: string | null;
  amount_cents: number;
  message?: string | null;
  show_on_display?: boolean;
};

export async function POST(req: Request) {
  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const amount = Number(body.amount_cents);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_00) {
    return NextResponse.json(
      { error: "Bedrag moet tussen €0,01 en €100.000 liggen" },
      { status: 400 }
    );
  }

  const first_name = (body.first_name ?? "").trim().slice(0, 60) || null;
  const message = (body.message ?? "").trim().slice(0, 200) || null;
  const show_on_display = body.show_on_display !== false;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("donations")
    .insert({ first_name, amount_cents: amount, message, show_on_display })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ donation: data }, { status: 201 });
}
