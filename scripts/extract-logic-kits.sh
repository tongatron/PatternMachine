#!/usr/bin/env bash
# Estrae dalla libreria di Logic Pro i kit "Boutique 808" e "Boutique 909" (le ricreazioni di Apple
# di TR-808 e TR-909, nome file GB_Tasty808_* / GB_Tasty909kit_*) e li converte per il sito:
# WAV mono, 16 bit, 44,1 kHz, normalizzati a -0,1 dB come gli altri campioni.
#
#   scripts/extract-logic-kits.sh
#
# Output in site/machines/tr808 e site/machines/tr909. Sono contenuti Apple: le cartelle sono escluse
# da git (.gitignore) e dal deploy (scripts/deploy.sh li pubblica solo con --con-kit-logic).
set -euo pipefail

SRC="${LOGIC_ULTRABEAT_SAMPLES:-/Library/Application Support/Logic/Ultrabeat Samples}"
cd "$(dirname "$0")/.."

command -v ffmpeg >/dev/null || { echo "serve ffmpeg (brew install ffmpeg)" >&2; exit 1; }
[ -d "$SRC" ] || { echo "libreria di Logic non trovata: $SRC" >&2; exit 1; }

convert_kit() {   # cartella-sorgente  prefisso-da-togliere  cartella-destinazione
  local from="$SRC/$1" prefix="$2" to="site/machines/$3" n=0 f name peak gain
  [ -d "$from" ] || { echo "manca $from" >&2; exit 1; }
  mkdir -p "$to"
  for f in "$from"/*.aif; do
    name=$(basename "$f" .aif)
    case "$name" in "$prefix"*) ;; *) continue ;; esac      # salta i file estranei al kit (es. DX100 bass)
    name=${name#"$prefix"}
    peak=$(ffmpeg -nostdin -i "$f" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\{0,1\}[0-9.]*\) dB.*/\1/p')
    gain=$(python3 -c "print(-0.1 - ($peak))")
    ffmpeg -nostdin -y -loglevel error -i "$f" -af "volume=${gain}dB" -ar 44100 -ac 1 -c:a pcm_s16le "$to/$name.wav"
    n=$((n + 1))
  done
  echo "$3: $n campioni"
}

convert_kit "Boutique 808" "GB_Tasty808_" tr808
convert_kit "Boutique 909" "GB_Tasty909kit_" tr909
