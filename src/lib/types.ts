export type Donation = {
  id: string;
  first_name: string | null;
  amount_cents: number;
  message: string | null;
  show_on_display: boolean;
  source: "invoer" | "online";
  created_at: string;
};

export type Totals = {
  total_cents: number;
  donor_count: number;
  goal_cents: number;
  reset_at: string | null;
};
