# Payment coordination and public-flow admission rollout

This update coordinates deposit requests across tabs and adds trusted requester
limits to public Deposit/Create preparation. Existing contracts, deposits, source
verification, financial terms, transaction IDs and receipt journals are unchanged.
No database migration or new environment variable is required.

## Deployment order

1. Deploy the reviewed commit to Netlify first, including both the frontend and
   `netlify/functions`. The updated function derives an opaque requester key from
   Netlify's trusted `context.ip`, using the existing shared proxy secret. It ignores
   caller-supplied requester/IP headers. The previous backend safely ignores the
   additional internal header.
2. Verify that the canonical production domain is running that function and that
   ordinary public flow creation works. A site administrator must approve the
   deployment if Netlify holds it for review. Do not weaken preview-secret policy.
3. Deploy the same reviewed commit to Railway after that verification. The updated
   backend requires the trusted gateway key for **new** public flows. Deploying the
   backend first will temporarily block new Deposit/Create preparation through an
   older function; the backend fails closed rather than trusting browser headers.

Repository publication alone does not deploy this backend correction. Keep the
existing backend URL, canonical origin, shared proxy secret and Reown settings.
Use the existing Node22 build command `npm run build:netlify:production`, publish
`dist/netlify-app`, and functions directory `netlify/functions`.

Netlify's function context is documented in its
[Functions API reference](https://docs.netlify.com/build/functions/api/).

## Existing payments and open tabs

- The fix never intentionally clears a possible-send/unknown intent or changes its
  original hash. Check and resolve an existing wallet request before starting a new
  payment. Do not clear browser storage to bypass recovery.
- The new controller coordinates tabs that run the new code. Tabs already open on
  older code do not participate. Before a later payment, finish/check any existing
  request and reload the page; do not force-reload a pending wallet interaction.
- Public flow tokens are already process-local and time-limited. A Railway restart
  can invalidate an old token as before. The new requester header is not required
  for existing token routes within a running instance; this is not a promise that
  tokens become durable across restarts. Original journals/hashes remain available
  for the existing receipt/recovery path, without automatic reminting or resending.
- Browsers without the required atomic locking API fail closed before preparing a
  wallet payment. The manual QR/address option remains available. Physical wallet
  app handoff and every embedded browser are outside these regression tests.

## Capacity and verification

Requester admission uses platform-derived network identity, not an unsigned wallet
address. This prevents claiming another guest's wallet as a reservation. Limits
allow a shared venue network to make progress as payments finish; confirmed flows
retain their token/hash bindings without consuming the active preparation budget.
Unused capabilities can be reclaimed. Prepared, in-flight and hash-bound flows are
never evicted merely to make room. Existing expiry semantics remain unchanged.

These controls reduce anonymous allocation abuse; they do not claim to defeat
distributed traffic or replace edge abuse protection. A genuinely full protected
preparation pool can still return a busy response. No public-RPC policy, auth
retention policy, role-epoch model or contract governance change is included.
