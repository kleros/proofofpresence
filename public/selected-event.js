// An optional server-bound bootstrap result, never a mutable financial cache.
// Old/unsupported or mismatched responses fall back to the existing event GET.
const address = (value) =>
  typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value)
    ? value.toLowerCase()
    : null;
const wallet = (value) => (value == null ? null : address(value));
const protectedArrays = [
  "participants",
  "deposits",
  "unmatched",
  "imports",
  "attendance",
  "transactions",
];

// Validate the server's projection, without deriving roles or granting authority.
// A rejected optional bundle falls back to the existing authorized detail endpoint.
function projectionMatchesActor(detail, serverWallet) {
  const actor = wallet(serverWallet);
  const permissions = detail.permissions;
  if (
    permissions != null &&
    (typeof permissions !== "object" || Array.isArray(permissions))
  )
    return false;
  for (const key of ["authenticated", "owner", "staff"])
    if (
      permissions &&
      Object.hasOwn(permissions, key) &&
      typeof permissions[key] !== "boolean"
    )
      return false;
  if (
    permissions &&
    Object.hasOwn(permissions, "authenticated") &&
    permissions.authenticated !== (actor !== null)
  )
    return false;
  for (const key of protectedArrays)
    if (Object.hasOwn(detail, key) && !Array.isArray(detail[key])) return false;
  if (
    detail.ownWallet != null &&
    (typeof detail.ownWallet !== "object" ||
      Array.isArray(detail.ownWallet) ||
      !actor ||
      address(detail.ownWallet.wallet) !== actor)
  )
    return false;
  if (!actor)
    return (
      permissions?.owner !== true &&
      permissions?.staff !== true &&
      protectedArrays.every((key) => !detail[key]?.length) &&
      detail.personal == null &&
      detail.ownWallet == null
    );
  const privileged = permissions?.owner === true || permissions?.staff === true;
  return (
    privileged ||
    detail.participants.every((person) => address(person?.wallet) === actor)
  );
}

export function selectedEventResult(
  bootstrap,
  { eventId, capturedWallet = null, hasCapturedSession = false },
) {
  const selected = bootstrap?.selectedEvent;
  if (
    !eventId ||
    bootstrap?.capabilities?.selectedEventBootstrap !== true ||
    !selected ||
    selected.eventId !== eventId ||
    typeof bootstrap.instanceId !== "string" ||
    !bootstrap.instanceId ||
    selected.instanceId !== bootstrap.instanceId ||
    !Object.hasOwn(selected, "wallet")
  )
    return null;
  const serverWallet = bootstrap.session?.wallet ?? null;
  // Reject malformed identities as well as different actors. On the first load,
  // the one response establishes the cookie-authenticated actor; subsequent reads
  // must also agree with the actor captured before the request started.
  if (
    (serverWallet != null && !address(serverWallet)) ||
    (selected.wallet != null && !address(selected.wallet)) ||
    wallet(selected.wallet) !== wallet(serverWallet) ||
    ((hasCapturedSession || capturedWallet != null) &&
      ((capturedWallet != null && !address(capturedWallet)) ||
        wallet(capturedWallet) !== wallet(serverWallet)))
  )
    return null;
  if (
    selected.detail === null &&
    selected.error &&
    typeof selected.error.message === "string" &&
    Number.isInteger(selected.error.status) &&
    selected.error.status >= 400 &&
    selected.error.status <= 599
  )
    return { error: selected.error };
  if (selected.error != null || !Array.isArray(bootstrap.events)) return null;
  const detail = selected.detail;
  const summary = bootstrap.events.find((event) => event?.id === eventId);
  if (
    !detail?.event ||
    !summary ||
    detail.event.id !== eventId ||
    !address(summary.contract) ||
    address(detail.event.contract) !== address(summary.contract) ||
    !Number.isSafeInteger(Number(summary.chainId)) ||
    Number(summary.chainId) <= 0 ||
    Number(detail.event.chainId) !== Number(summary.chainId) ||
    Number(bootstrap.chain?.chainId) !== Number(summary.chainId)
  )
    return null;
  if (
    !Number.isSafeInteger(summary.deploymentBlock) ||
    summary.deploymentBlock < 0
  )
    return null;
  for (const key of [
    "deploymentBlock",
    "contractVersion",
    "abiVersion",
    "policyURI",
    "templateHash",
  ])
    if (
      summary[key] !== detail.event[key] ||
      (key !== "deploymentBlock" &&
        (typeof summary[key] !== "string" || !summary[key]))
    )
      return null;
  if (
    !detail.state ||
    typeof detail.state !== "object" ||
    Array.isArray(detail.state) ||
    !Array.isArray(detail.transactions) ||
    !Array.isArray(detail.participants)
  )
    return null;
  if (!projectionMatchesActor(detail, serverWallet)) return null;
  return { detail };
}
