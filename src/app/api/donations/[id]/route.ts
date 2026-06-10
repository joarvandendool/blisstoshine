import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";

function checkPin(req: Request): boolean {
  const pin = req.headers.get("x-admin-pin");
  const expected = process.env.ADMIN_PIN;
  return !!expected && pin === expected;
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!checkPin(req)) {
    return NextResponse.json({ error: "Ongeldige PIN" }, { status: 401 });
  }
  const supabase = supabaseAdmin();
  const { error } = await supabase.from("donations").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
