"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const links = [
    { href: "/admin", label: "Events desk", on: path === "/admin" || path.startsWith("/admin/events") },
    { href: "/admin/recordings", label: "Recordings", on: path.startsWith("/admin/recordings") },
    { href: "/record", label: "Record", on: path === "/record" },
    { href: "/admin/team", label: "Team roster", on: path.startsWith("/admin/team") },
    ...(isAdmin ? [{ href: "/admin/access", label: "Access", on: path.startsWith("/admin/access") }] : []),
  ];
  return (
    <nav className="adm-nav" aria-label="Team desk">
      <div className="wrap">
        <span className="eyebrow">Kleros team</span>
        <div className="seg">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.on ? "page" : undefined}>{l.label}</Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
