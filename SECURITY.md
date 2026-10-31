# Configuration and repository scope

Store the Netlify gateway secret in Netlify Functions environment settings and
match it to the existing Railway `PROXY_SECRET`. Keep database/RPC credentials,
API tokens, wallet keys, seed phrases, signing files and private runtime state in
their owning services or private local storage. Never commit their values.

`.env.example` and `netlify.env.example` are configuration examples. The Reown
project ID in the browser connector is public, as are contract addresses, chain
transaction hashes and deployment-verification inputs.

Agent instructions, project memory, operator notes, generated screenshots/logs,
source archives and unrelated reference applications are outside this project's
published source. `.gitignore` excludes local notes, credentials and generated
outputs. The few tracked files under `artifacts/` are required public fixtures;
preserve the runtime verification files and source-hashed harnesses byte-for-byte.

Before publishing, review the staged file list and run a local secret scanner on
both the source tree and Git history with fully redacted reports. If a real secret
was ever committed, revoke or rotate it through its owning service; removing a file
does not invalidate the old credential. Coordinate any history rewrite with the
repository maintainers.
