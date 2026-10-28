#!/bin/bash
# Prints the backend as one file, the way it lives in the Apps Script editor:
# site/matching.js (shared with the site) followed by apps-script/Code.gs.
# Also refreshes apps-script/Matching.gs so the two copies of the matching rules never drift.
#
#   bash scripts/apps-script-bundle.sh | pbcopy     # then paste over everything in the editor, save, deploy a new version
set -euo pipefail
cd "$(dirname "$0")/.."
cp site/matching.js apps-script/Matching.gs
printf '/* ===== Matching.gs (from matching.js) ===== */\n'
cat site/matching.js
printf '\n\n/* ===== Code.gs ===== */\n'
cat apps-script/Code.gs
