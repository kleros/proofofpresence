# Project instructions

Read [PROJECT_BRAIN.md](PROJECT_BRAIN.md) first. It is the single canonical project memory.
`KLEROS_CODEX_HANDOFF/` is the supplied historical handoff. Do not infer the current user's identity or
permissions from historical operator names, devices, accounts or prose.

The root app supports explicit v7/v8 demos and the configured controlled Chiado testnet rehearsal.
Historical v7 remains the default compatibility version. Preserve historical Solidity, policy, template, ABI snapshots
and deployment verification inputs. Never replace held-share payouts with a blanket freeze or change
ruling0 economics in an incidental refactor. Dispatch explicitly by version.

Use synthetic data/local chains for development. Do not broadcast mainnet transactions, deploy to
production, apply live database/Sheet migrations, send real messages/signup payloads, publish IPFS files,
change DNS/hosting or push upstream without an explicit concrete authorization. Committed legacy
configs can point at live services and rehearsal uses real mainnet ETH. The root demo never loads them.

The user authorized a simplified v8 application and controlled-arbitrator Chiado rehearsal, funded
its disposable wallet and selected real Court as a later separate phase. Only chain10200 and the
exact reviewed synthetic plan are authorized for that rehearsal. Preserve private signing files and
once-only transaction journals; never automatically replay submissions or change public chain time.

Run root build/typecheck/tests/browser checks appropriate to changed behavior. Tests inspect real local
v7 execution; Court adjudication only is mocked. Keep TEST_REPORT honest about commands actually run.
Use ui-registry.md for interface patterns. All scopes, drafts, imports, private access and generated
runtime files must be isolated by stable event and environment/server instance.
