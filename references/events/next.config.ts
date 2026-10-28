import type { NextConfig } from "next";

// Set at build time. Netlify gives builds NETLIFY=true and URL, the site's main address (its
// custom domain once one is set); Vercel gives NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL.
const onNetlify = process.env.NETLIFY === "true";

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }] },
  env: {
    HOSTING: onNetlify ? "netlify" : "",
    NETLIFY_SITE_URL: onNetlify ? process.env.URL ?? "" : "",
  },
};

export default nextConfig;
