import { supabaseAdmin } from "./supabase-server";

// Verifieert de admin/vrijwilligers-PIN. Voorrang:
//   1. env var ADMIN_PIN (indien gezet in Vercel)
//   2. anders: pin uit de admin_config tabel (service-role only)
export async function verifyPin(pin: string | null): Promise<boolean> {
  if (!pin) return false;

  const envPin = process.env.ADMIN_PIN;
  if (envPin) return pin === envPin;

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("admin_config")
      .select("pin")
      .eq("id", 1)
      .single();
    if (error || !data) return false;
    return data.pin === pin;
  } catch {
    return false;
  }
}
