# Matching draft read and temporary SSH access

The human approved exporting only the saved review matching transaction
`0xef60cbf9c65883eb3a1daf6f250bd6cc8328ba655270e897ba17870b1d8a06dc`.
That privacy approval persists. The approved read has not succeeded: Railway reports
`SSH_KEY_UNAVAILABLE`; the local agent and Railway personal key inventory both contain zero keys.

Proposed additional credential action, pending explicit human approval:

1. Generate one temporary Ed25519 SSH key in a unique private local directory (directory0700,
   private key0600), separate from every wallet. Register only its public key as a personal
   Railway key named `kleros-matching-draft-read-<unique-id>`.
2. Personal key registration grants normal account SSH access during registration; Railway
   does not constrain this key to this project. Our sole permitted use is one read-only command
   against project `fc82ba7d-dbd8-46a1-90b0-46c150405823`, environment
   `da2b097e-6883-424e-8539-99fb7422df10`, service `5de64f0d-3712-41c9-b6ae-a5df868e716a`.
3. Execute the fixed `.runtime/mainnet-hosting/read-matching-draft.mjs` code remotely with Node.
   It opens only `/data/workbench-state.json`, selects the exact approved eventKey before
   projection, rejects missing/ambiguous/wrong-wallet/wrong-factory matches, and exports only
   IDs, public wallet/addresses, transaction hashes/terms hashes and status metadata. Raw
   transaction data, signing material and other records stay in the backend process.
4. Save the redacted result to a new local proof file. Never modify the backend volume,
   start command, application state, journals, sessions, deployments or blockchain.
5. In a `finally` cleanup, unregister this exact key and delete its private local directory;
   retain only public key fingerprint and cleanup outcome. If Railway requires account2FA
   to revoke it, delete the private key immediately and request the human remove that exact
   public fingerprint in Railway settings. Do not copy credentials into chat or public artifacts.

No key generation, registration, SSH extraction or replacement event creation has been performed
under this plan. No disabling of MetaMask protection is proposed. Source-bound canonical receipt
and decoded inner-call proofs are already saved separately; they do not yet prove original-review
equality or authorize event adoption.
