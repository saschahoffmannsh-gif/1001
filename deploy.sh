#!/bin/bash
# Frontend = GitHub Pages: saschahoffmannsh-gif/1001 → https://saschahoffmannsh-gif.github.io/1001/
# Backend  = Edge Function "tu" im gemeinsamen Supabase-Projekt (kein neues Projekt).
# Gebaute Seite liegt auf main (Pages-Quelle), Quellcode auf dem Branch "source".
set -euo pipefail
cd "$(dirname "$0")"
GH_USER="${GH_USER:-saschahoffmannsh-gif}"; REPO="${REPO:-1001}"
npm test
npm run build
touch dist/.nojekyll
for s in "sb_secret" "service_role" "SUPABASE_SERVICE_ROLE_KEY\"" "sbp_" "gho_"; do
  if grep -rqlF -- "$s" dist; then echo "ABBRUCH: Geheimnis in dist/ ($s)"; exit 1; fi
done
[ -z "${PUBLISH:-}" ] && { echo "Gebaut. Veröffentlichen: PUBLISH=1 ./deploy.sh"; exit 0; }
TMP=$(mktemp -d); cp -a dist/. "$TMP"; cd "$TMP"
git init -q -b main && git add -A
git -c user.name="$GH_USER" -c user.email="$GH_USER@users.noreply.github.com" commit -qm "Seite $(date -u +%FT%TZ)"
git push -fq "https://github.com/$GH_USER/$REPO.git" main
rm -rf "$TMP"
echo "Fertig: https://$GH_USER.github.io/$REPO/"
