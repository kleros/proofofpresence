import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import NavLinks from "./NavLinks";

export default async function SiteHeader() {
  const { user, profile } = await currentUser();
  return (
    <header className="top">
      <div className="wrap">
        <Link className="brand" href="/" aria-label="Kleros Events home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kleros-logo.svg" alt="Kleros" />
          <span className="sep" />
          <span><em className="em">Events</em></span>
        </Link>
        <NavLinks signedIn={!!user} isTeam={!!profile?.is_team} />
      </div>
    </header>
  );
}
