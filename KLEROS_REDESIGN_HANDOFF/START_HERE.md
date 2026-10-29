# Send this to the Codex task already working on Kleros

Attach the complete `KLEROS_REDESIGN_HANDOFF.zip` to the same Codex conversation and send the contents of `CODEX_DESIGN_FOLLOWUP.md`. If the interface accepts folders instead, unpack the ZIP into the working repository as a design reference and point Codex to that folder.

The decisions are already made: use the prepared Option B for each of the four priorities. Codex should continue implementation, preserve completed work, and apply the selected design without asking you to repeat the redesign process.

## Main files

| File | Purpose |
| --- | --- |
| `CODEX_DESIGN_FOLLOWUP.md` | Complete continuation prompt to send. |
| `REDESIGN_HANDOFF.md` | Selected design, states, scope, acceptance criteria, and implementation priorities. |
| `PROJECT_BRAIN_DESIGN_ADDENDUM.md` | Persistent design decisions to append to the original project brain. |
| `KLEROS_REDESIGN_PROTOTYPE.html` | Self-contained interactive reference with two events and 19 participant scenarios; synthetic data only. |
| `DESIGN_OPTIONS.html` | Twelve alternatives with the four selected B treatments marked. |
| `KLEROS_REDESIGN_SUMMARY.pdf` | Short visual review with observed before images and labeled static proposal renders. |
| `design-tokens.json` | Palette, typography, spacing, and interaction values. |
| `QA_REPORT.md` | Exactly what passed, what was inspected, and what still needs a browser. |
| `qa/` | Executed DOM checks/results and prepared browser checks. |
| `evidence/` | Read-only audit, source inventory, independent critique, contrast calculations, and public before images. |
| `assets/` | Existing Kleros assets, embedded font binaries, provenance, and font license notices. |
| `previews/` | Static document render excerpts, with limitations recorded in the QA report. |

The original `PROJECT_BRAIN.md` remains authoritative for the contract and product requirements. This package adds design decisions and does not replace the already-sent engineering handoff.

You do not need to run the checks yourself. The follow-up prompt tells Codex to execute the remaining browser and application validation, fix issues, and report its actual results.
