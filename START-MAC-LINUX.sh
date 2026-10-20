#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js ab Version 22 von https://nodejs.org/ installieren.'
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js ab Version 22 erforderlich.");process.exit(1)}'
exec node server.mjs --open
