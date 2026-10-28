import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";
import { safeNext } from "@/lib/format";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="wrap page narrow">
      <div className="eyebrow">My events</div>
      <h1>Sign in</h1>
      <p className="lede">Save events, keep private notes, pick up talks where you left off, and ask the speakers questions. Enter an email address to get a sign-in link. No password needed.</p>
      <LoginForm next={safeNext(next)} />
    </div>
  );
}
