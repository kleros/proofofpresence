# Kleros Codex Handoff

This package gives Codex a concrete implementation task and a durable project brain for the three supplied Kleros repositories. Rebuilding or consolidating the project is explicitly allowed when that produces a simpler, maintainable result.

## Files

- **CODEX_PROMPT.md:** the implementation instructions to paste into Codex. Use the text after the horizontal divider.
- **PROJECT_BRAIN.md:** the source-grounded project context, contract behavior, architecture choices, roadmap, acceptance criteria and pinned source references.

## How to use it

1. Open a Codex workspace with access to the supplied repositories, or provide their URLs and permission to obtain local working copies.
2. Put PROJECT_BRAIN.md in the active workspace root, or attach it to the task. Keep it as the canonical project memory.
3. Paste CODEX_PROMPT.md into Codex. The prompt instructs it to inspect current source, verify the baseline, choose the architecture and continue into implementation.
4. Let Codex update the brain as it makes decisions and completes work. Its final report should distinguish working local behavior, mocks, existing deployment compatibility and remaining production steps.

The repository snapshot is from 28 October 2026. It is a static source review, not a fresh test run or confirmation of production state. Codex must reconcile newer commits before changing code.

## Intended result

A working multi-event product with a coherent attendee/organizer interface, explicit event identities, isolated deposits and imports, trusted attendance, existing Kleros dispute behavior, correct payouts and a reproducible two-event local demo.

The recommended starting point is a shared event model and unified interface backed by versioned per-event contract adapters. Codex may instead choose a focused refactor or fuller rebuild if it documents a concrete advantage. It can retain existing recordings, Q&A or booth services as linked modules; the exercise does not require recreating every peripheral feature.

## Existing behavior the handoff protects

- Kickback already integrates Kleros Court V1 and records a live native-ETH deployment.
- It already pays ordinary attendees while reserving shares for unresolved matched disputes.
- The events app's personal attendance record and the booth app's merchandise status are not financial attendance proof.
- Attendance imports need reliable event association; a file hash or selected event dropdown alone cannot establish where a raw CSV originated.
- Existing deployment metadata, privacy rules, guest data and optional newsletter consent need a deliberate compatibility or migration path.

The attached brain provides the source references for these findings. Development should use local chains, isolated databases and synthetic data. The prompt authorizes implementation and a reviewable rollout plan; production transactions, live migrations and external messages remain separate concrete actions.
