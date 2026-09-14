#!/usr/bin/env bash
# Pubblica drummachine.tongatron.org sul Server HP.
#
#   scripts/deploy.sh          prova a secco: test, controllo versioni, elenco dei file che cambierebbero
#   scripts/deploy.sh --yes    pubblica davvero (backup sul server, upload, verifica)
#
# Sul server la cartella e' piatta: site/* nella radice, index.html del toolkit come toolkit.html,
# server.py e set-password.py accanto. auth.json (password) vive solo sul server e non si tocca. Non cancella nulla sul server (data/, assets/*.zip restano dove sono).
set -euo pipefail

HOST=hp-ubuntu
REMOTE=/srv/apps/drummachine
BACKUPS=/srv/apps/drummachine-backups
SITE=https://drummachine.tongatron.org

cd "$(dirname "$0")/.."

echo "== test"
node tests/engine.test.js | tail -1
python3 tests/server_test.py | tail -1

echo "== versioni"
# Service worker, pagina e script del motore devono avere la stessa versione.
sw=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' site/sw.js)
page=$(sed -n 's/^const SW_VERSION="\(.*\)";$/\1/p' site/index.html)
tags=$(grep -o 'engine/[a-z-]*\.js?v=[0-9.-]*' site/index.html | sed 's/.*?v=//' | sort -u)
if [ -z "$sw" ] || [ "$sw" != "$page" ] || [ "$tags" != "$sw" ]; then
  echo "versioni non allineate: sw.js=$sw  SW_VERSION=$page  engine ?v=$tags" >&2
  exit 1
fi
echo "ok $sw"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
rsync -a --exclude .DS_Store site/ "$STAGE/"
cp index.html "$STAGE/toolkit.html"
cp server.py "$STAGE/server.py"
cp scripts/set-password.py "$STAGE/set-password.py"

# --checksum confronta i contenuti: una data diversa da sola non conta come modifica.
RSYNC=(rsync -rlt --checksum --exclude .DS_Store)

echo "== cosa cambierebbe sul server"
changes=$("${RSYNC[@]}" -n --itemize-changes "$STAGE/" "$HOST:$REMOTE/" | grep '^[<c]' || true)
if [ -z "$changes" ]; then
  echo "niente da pubblicare"
  exit 0
fi
echo "$changes"
server_changed=$(echo "$changes" | grep -c ' server.py$' || true)

if [ "${1:-}" != "--yes" ]; then
  echo
  echo "prova a secco: rilancia con --yes per pubblicare"
  exit 0
fi

ts=$(date +%Y%m%d-%H%M%S)
echo "== backup in $BACKUPS/$ts"
ssh "$HOST" "mkdir -p '$BACKUPS/$ts' && cd '$REMOTE' && cp -a index.html toolkit.html server.py sw.js manifest.json engine '$BACKUPS/$ts/' 2>/dev/null || true"

echo "== upload"
# Prima tutto il resto, index.html per ultimo: la pagina nuova non punta mai a file mancanti.
"${RSYNC[@]}" --exclude /index.html "$STAGE/" "$HOST:$REMOTE/"
"${RSYNC[@]}" "$STAGE/index.html" "$HOST:$REMOTE/index.html"

echo "== verifica"
left=$("${RSYNC[@]}" -n --itemize-changes "$STAGE/" "$HOST:$REMOTE/" | grep '^[<c]' || true)
if [ -n "$left" ]; then
  echo "file ancora diversi dopo l'upload:" >&2
  echo "$left" >&2
  exit 1
fi
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/")
echo "sito: HTTP $code"
[ "$code" = 200 ] || exit 1

echo
echo "pubblicato. Ripristino: ssh $HOST \"cp -a $BACKUPS/$ts/* $REMOTE/\""
if [ "$server_changed" != 0 ]; then
  echo "server.py e' cambiato: diventa attivo solo dopo  ssh -t $HOST sudo systemctl restart drummachine"
fi
