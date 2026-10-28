const METHODS = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE"]);
const WRITE = new Set(["POST", "PATCH", "DELETE"]);
const fail = (status, message, code = "GATEWAY_REJECTED", extra = {}) =>
  Response.json(
    { error: message, code },
    { status, headers: { "cache-control": "no-store", ...extra } },
  );
function origin(value, name) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      `Configure an HTTPS ${name} origin without a path or credentials`,
    );
  return url.origin;
}
const allowedPath = (p) =>
  p.startsWith("/api/") ||
  p === "/rpc" ||
  p.startsWith("/finance/") ||
  p === "/local-upload" ||
  p.startsWith("/local-ipfs/") ||
  p.startsWith("/local-policy/") ||
  p === "/ethers.js";
async function limitedBody(request, limit) {
  const chunks = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("BODY_LIMIT");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function createGateway({
  backendOrigin,
  publicOrigin,
  proxySecret,
  fetchImpl = fetch,
}) {
  const backend = origin(backendOrigin, "backend"),
    site = origin(publicOrigin, "public");
  if (typeof proxySecret !== "string" || proxySecret.length < 32)
    throw new Error("Configure a strong proxy secret");
  return async function gateway(request) {
    const url = new URL(request.url),
      method = request.method.toUpperCase(),
      rpc = url.pathname === "/rpc";
    const cors = rpc ? { "access-control-allow-origin": "*" } : {};
    if (url.origin !== site) return fail(403, "Unexpected application origin");
    if (
      !allowedPath(url.pathname) ||
      url.pathname.includes("\\") ||
      /%2f|%5c/i.test(url.pathname)
    )
      return fail(404, "Route is not available");
    // Wallet extensions use a public, cookie-free RPC transport. Only the backend's
    // bounded read methods and cryptographically signed chain1337 transactions work.
    if (rpc && method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "cache-control": "no-store",
        },
      });
    if (!METHODS.has(method) || (rpc && method !== "POST"))
      return fail(405, "Method is not available", "METHOD_NOT_ALLOWED", cors);
    if (WRITE.has(method) && !rpc && request.headers.get("origin") !== site)
      return fail(403, "Mutation requires the application origin");
    const type = request.headers.get("content-type") ?? "";
    if (
      WRITE.has(method) &&
      !(url.pathname === "/local-upload"
        ? type.startsWith("multipart/form-data")
        : type.startsWith("application/json"))
    )
      return fail(415, "Unexpected content type", "BAD_CONTENT_TYPE", cors);
    const headers = new Headers({ "x-kleros-proxy-key": proxySecret });
    for (const key of ["content-type", "accept", "origin", "cookie"])
      if (request.headers.has(key) && !(rpc && key === "cookie"))
        headers.set(key, request.headers.get(key));
    if (rpc) headers.set("origin", site);
    const target = new URL(backend);
    target.pathname = url.pathname;
    target.search = url.search;
    let body;
    try {
      if (WRITE.has(method))
        body = await limitedBody(
          request,
          url.pathname === "/local-upload" ? 300_000 : 1_000_000,
        );
    } catch {
      return fail(413, "Request too large", "TOO_LARGE", cors);
    }
    try {
      const upstream = await fetchImpl(target.href, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(55_000),
      });
      const resultHeaders = new Headers({
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
        vary: "Cookie, Origin",
        ...cors,
      });
      for (const key of [
        "content-type",
        "content-disposition",
        "x-frame-options",
      ])
        if (upstream.headers.has(key))
          resultHeaders.set(key, upstream.headers.get(key));
      if (!rpc && upstream.headers.has("set-cookie"))
        resultHeaders.set("set-cookie", upstream.headers.get("set-cookie"));
      // Do not follow backend redirects or expose its private deployment URL.
      if (upstream.status >= 300 && upstream.status < 400)
        return fail(
          502,
          "Unexpected backend redirect",
          "BACKEND_REDIRECT",
          cors,
        );
      return new Response(
        method === "HEAD" || [204, 304].includes(upstream.status)
          ? null
          : upstream.body,
        { status: upstream.status, headers: resultHeaders },
      );
    } catch {
      return fail(
        503,
        "The demo backend is temporarily unavailable. Try again shortly.",
        "BACKEND_UNAVAILABLE",
        cors,
      );
    }
  };
}

export default async (request) => {
  try {
    return await createGateway({
      backendOrigin: process.env.KLEROS_BACKEND_URL,
      publicOrigin: process.env.KLEROS_PUBLIC_ORIGIN,
      proxySecret: process.env.KLEROS_PROXY_SECRET,
    })(request);
  } catch {
    return fail(
      503,
      "The interactive demo backend is not configured yet.",
      "BACKEND_NOT_CONFIGURED",
    );
  }
};
export const config = { path: "/*", preferStatic: true };
