# ADR 001: unified local finance workbench with v7 adapters

Accepted 28 October 2026 after inspecting the three pinned HEADs.

| Option | Complete flow / operations | Regression and migration cost | Decision |
|---|---|---|---|
| A. Three applications with adapters | Existing deployments remain; three entry points and configuration releases | Lowest initial edit count, continued cross-event identity/provenance risk | Retain as compatibility modules only |
| B. Extend Next/Supabase events | Rich shared content IDs and auth, but local setup requires 14 migrations plus unrelated media/AI services | Security rules are valuable; changing financial permissions inside that broad app enlarges regression surface | Preserve content application, map stable event IDs explicitly |
| C. Clean small workbench, reuse v7 | One local process and local chain, one event domain; complete core flow without live credentials | Requires explicit content links and future identity bridge; avoids financial rewrite and live data migration | **Chosen** |

The Node ESM workbench separates registry, on-chain adapter, verified identities/imports, and HTTP/UI. It uses one unchanged v7 contract per event with isolated custody. A trusted version-dispatched ABI snapshot is distinct from a compiler's latest output. Registry terms include policy/template/code hashes and authoritative getters; every transaction has an expiring review draft bound to deployment, wallet, and current event state, with a second simulation at execution.

Local Ganache supplies synthetic wallets. Mock V1 Court/resolver stand in only for external adjudication; ETH accounting, registration, challenges, held shares and recovery execute the original Solidity. Demo impersonation is a labeled local capability, never production authentication. Wallet nonce authentication is separate from email identities. Raw CSV origin review is a recorded trust assumption, never an override of known mismatch or duplicate evidence.

Content visibility, registration status and financial phase remain separate. Existing Next content/media/Q&A/private-material routes and database are retained unchanged. Their confirmed-email/RLS gates remain authoritative. Future integration maps the content event UUID to workbench stable ID and adds a signed wallet identity link; a UUID or pasted wallet alone grants no authority. The booth remains a separate marketing system; its QR/merch/newsletter records never enter financial attendance. No live data is copied or rewritten.

Historical mainnet Truth Pays deployment is recorded read-only with exact v7 artifacts/policy/template/deployment inputs. Existing guest and organizer modules remain available in their source repository. Local advanced views use event-scoped configurations and a local adapter. Mainnet transactions, IPFS publication, backend writes, upstream publishing, and deployment require a separate authorized rollout. This decision changes no contract economics, ruling-0 treatment, reserve or recovery rules.

See [RUNBOOK.md](RUNBOOK.md) for migration/rollout and [API.md](API.md) for local interfaces.
