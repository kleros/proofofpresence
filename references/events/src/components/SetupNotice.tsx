import { supabaseConfigured } from "@/lib/supabase/server";

export default function SetupNotice() {
  if (supabaseConfigured) return null;
  return (
    <div className="note" style={{ marginBlock: 16 }}>
      Supabase isn&apos;t connected yet. Copy <code>.env.example</code> to <code>.env.local</code>, add your project URL and anon key, then run the SQL in <code>supabase/</code>. See the README.
    </div>
  );
}
