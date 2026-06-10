import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyPin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await verifyPin(req.headers.get("x-admin-pin")))) {
    return NextResponse.json({ error: "Ongeldige PIN" }, { status: 401 });
  }
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("settings")
    .update({ reset_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
