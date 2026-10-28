#!/bin/bash
# Builds dist/kleros-devcon-deploy.zip for handing over: the site folder ready for Netlify (drag and drop,
# or use Import from GitHub instead), the backend as the single file that lives in the Apps Script editor,
# and docs/DEPLOY.md.
#
#   bash scripts/package.sh
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist/kleros-devcon-deploy
rm -rf "$out" "$out.zip"
mkdir -p "$out/backend"
cp -R site "$out/site"
bash scripts/apps-script-bundle.sh > "$out/backend/Code.gs"
cp docs/DEPLOY.md "$out/DEPLOY.md"
(cd dist && zip -qr -X kleros-devcon-deploy.zip kleros-devcon-deploy -x '*.DS_Store')
echo "$out.zip"
