"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LUMA_URL } from "@/lib/kleros";

export default function NavLinks({ signedIn, isTeam }: { signedIn: boolean; isTeam: boolean }) {
  const path = usePathname();
  const on = (href: string) => (path === href || path.startsWith(href + "/") ? "page" : undefined);
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/events" aria-current={on("/events")}>Events</Link>
      <Link href="/talks" aria-current={on("/talks")}>Talks</Link>
      <a href={LUMA_URL} target="_blank" rel="noopener">Luma ↗</a>
      {isTeam && <Link href="/admin" aria-current={on("/admin")}>Team</Link>}
      <Link className="nav-me" href={signedIn ? "/me" : "/login"} aria-current={on("/me") ?? on("/login")}>{signedIn ? "My events" : "Sign in"}</Link>
    </nav>
  );
}
