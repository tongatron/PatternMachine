#!/usr/bin/env bash
# Pubblica patternmachine.tongatron.org sul Server HP.
#
#   scripts/deploy.sh          prova a secco: test, controllo versioni, elenco dei file che cambierebbero
#   scripts/deploy.sh --yes    pubblica davvero (backup sul server, upload, verifica)
#   --con-kit-macchine         pubblica anche i kit delle macchine (808, 909, 707, CR-78, LinnDrum, 606, 727, CR-8000, DMX, Drumulator, DrumTraks, SDS-V, SP12): di norma restano solo in locale
#
# Sul server la cartella e' piatta: site/* nella radice,
# server.py, add-user.py, set-mail.py e set-telegram.py accanto. data/users.json (utenti), mail.json (Gmail) e
# telegram.json (bot delle segnalazioni) vivono solo sul server e non si toccano.
# Non cancella nulla sul server (data/, assets/*.zip restano dove sono).
set -euo pipefail

HOST=hp-ubuntu
# Sovrascrivibili dall'ambiente (es. REMOTE=... per un'installazione diversa).
REMOTE=${REMOTE:-/srv/apps/patternmachine}
BACKUPS=${BACKUPS:-/srv/apps/patternmachine-backups}
SITE=${SITE:-https://patternmachine.tongatron.org}
SERVICE=${SERVICE:-patternmachine}

cd "$(dirname "$0")/.."

echo "== test"
node tests/engine.test.js | tail -1
node tests/synth.test.js | tail -1
node tests/sample-editor.test.js | tail -1
node tests/vocal.test.js | tail -1
python3 tests/server_test.py | tail -1
python3 tests/site_test.py

echo "== versioni"
# Service worker, pagina, script del motore e file del corso (learn/) devono avere la stessa versione.
sw=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' site/sw.js)
page=$(sed -n 's/^const SW_VERSION="\(.*\)";$/\1/p' site/index.html)
tags=$( { grep -oh 'engine/[a-z-]*\.js?v=[0-9.-]*' site/index.html site/funzioni.html
          grep -ohE '[a-z-]+\.(js|css)\?v=[0-9.-]+' site/learn/*.html; } | sed 's/.*?v=//' | sort -u)
if [ -z "$sw" ] || [ "$sw" != "$page" ] || [ "$tags" != "$sw" ]; then
  echo "versioni non allineate: sw.js=$sw  SW_VERSION=$page  engine e learn ?v=$tags" >&2
  exit 1
fi
echo "ok $sw"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
# I kit delle macchine (site/machines/tr808, tr909, tr707, cr78, linn e gli altri in MACHINE_KITS) non vanno online se non richiesto.
MACHINE_KITS=(tr808 tr909 tr707 cr78 linn tr606 tr727 cr8000 dmx drumulator drumtraks sdsv sp12b tr808u tr909u)
EXCLUDE_KITS=(); for k in "${MACHINE_KITS[@]}"; do EXCLUDE_KITS+=(--exclude "machines/$k"); done
for arg in "$@"; do [ "$arg" = "--con-kit-macchine" ] && EXCLUDE_KITS=(); done
rsync -a --exclude .DS_Store ${EXCLUDE_KITS[@]+"${EXCLUDE_KITS[@]}"} site/ "$STAGE/"
# Data della versione nel footer: l'ultima modifica dei file del sito (non l'ora del deploy, cosi' se
# non cambia niente il confronto con il server resta vuoto).
build=$(python3 - <<'PY'
import glob, os, time
files = glob.glob("site/*.html") + glob.glob("site/*.js") + glob.glob("site/engine/*.js") + glob.glob("site/learn/*")
t = time.localtime(max(os.path.getmtime(f) for f in files))
mesi = "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre".split()
print(f"versione del {t.tm_mday} {mesi[t.tm_mon - 1]} {t.tm_year} {t.tm_hour:02d}:{t.tm_min:02d}")
PY
)
for f in "$STAGE/index.html" "$STAGE/funzioni.html" "$STAGE/macchine.html" "$STAGE/synth.html" "$STAGE"/learn/*.html; do
  sed -i '' "s|<!--build-->[^<]*<!--/build-->|<!--build-->$build<!--/build-->|" "$f"
done
echo "footer: $build"
cp server.py "$STAGE/server.py"
cp scripts/add-user.py "$STAGE/add-user.py"
cp scripts/set-mail.py "$STAGE/set-mail.py"
cp scripts/set-telegram.py "$STAGE/set-telegram.py"

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

YES=0; for arg in "$@"; do [ "$arg" = "--yes" ] && YES=1; done
if [ "$YES" != 1 ]; then
  echo
  echo "prova a secco: rilancia con --yes per pubblicare"
  exit 0
fi

ts=$(date +%Y%m%d-%H%M%S)
echo "== backup in $BACKUPS/$ts"
ssh "$HOST" "mkdir -p '$BACKUPS/$ts' && cd '$REMOTE' && cp -a index.html toolkit.html server.py sw.js manifest.json engine learn '$BACKUPS/$ts/' 2>/dev/null || true"

echo "== upload"
ssh "$HOST" "rm -f '$REMOTE/toolkit.html'"
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
# Con la password attiva la home rimanda al login (303); la pagina di login deve rispondere 200.
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/")
login=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/login")
echo "sito: home HTTP $code, login HTTP $login"
case "$code" in 200|303) ;; *) exit 1 ;; esac

echo
echo "pubblicato. Ripristino: ssh $HOST \"cp -a $BACKUPS/$ts/* $REMOTE/\""
if [ "$server_changed" != 0 ]; then
  echo "server.py e' cambiato: diventa attivo solo dopo  ssh -t $HOST sudo systemctl restart $SERVICE"
fi
