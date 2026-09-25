#!/usr/bin/env bash
# Estrae dalla libreria di Logic Pro i kit delle macchine classiche e li converte per il sito:
#   - Ultrabeat "Boutique 808", "Boutique 909", "Boutique 78" (ricreazioni Apple di TR-808, TR-909, CR-78)
#   - Sampler "Cory's LinnDrum Kit" e "TR-707 Processed Kit" (EXS Factory Samples)
# Formato:
# WAV mono, 16 bit, 44,1 kHz, normalizzati a -0,1 dB come gli altri campioni.
#
#   scripts/extract-logic-kits.sh
#
# Output in site/machines/{tr808,tr909,cr78,linn,tr707}. Sono contenuti Apple: le cartelle sono escluse
# da git (.gitignore) e dal deploy (scripts/deploy.sh li pubblica solo con --con-kit-logic).
set -euo pipefail

SRC="${LOGIC_ULTRABEAT_SAMPLES:-/Library/Application Support/Logic/Ultrabeat Samples}"
EXS="${LOGIC_EXS_SAMPLES:-/Library/Application Support/Logic/EXS Factory Samples/03 Drums & Percussion/02 Electronic Drum Kits}"
cd "$(dirname "$0")/.."

command -v ffmpeg >/dev/null || { echo "serve ffmpeg (brew install ffmpeg)" >&2; exit 1; }
[ -d "$SRC" ] || { echo "libreria di Logic non trovata: $SRC" >&2; exit 1; }

convert_one() {   # file-sorgente  file-destinazione
  local peak gain
  peak=$(ffmpeg -nostdin -i "$1" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\{0,1\}[0-9.]*\) dB.*/\1/p')
  gain=$(python3 -c "print(-0.1 - ($peak))")
  ffmpeg -nostdin -y -loglevel error -i "$1" -af "volume=${gain}dB" -ar 44100 -ac 1 -c:a pcm_s16le "$2"
}

convert_kit() {   # cartella-sorgente  prefisso-da-togliere  cartella-destinazione   (kit Ultrabeat)
  local from="$SRC/$1" prefix="$2" to="site/machines/$3" n=0 f name
  [ -d "$from" ] || { echo "manca $from" >&2; exit 1; }
  mkdir -p "$to"
  for f in "$from"/*.aif; do
    name=$(basename "$f" .aif)
    case "$name" in "$prefix"*) ;; *) continue ;; esac      # salta i file estranei al kit (es. DX100 bass)
    name=${name#"$prefix"}
    convert_one "$f" "$to/$name.wav"
    n=$((n + 1))
  done
  echo "$3: $n campioni"
}

convert_exs() {   # cartella-sorgente  suffisso-da-togliere  cartella-destinazione   (kit del Sampler)
  local from="$EXS/$1" suffix="$2" to="site/machines/$3" n=0 f name
  [ -d "$from" ] || { echo "manca $from" >&2; exit 1; }
  mkdir -p "$to"
  for f in "$from"/*.aif; do
    name=$(basename "$f" .aif)
    name=${name%"$suffix"}
    name=${name//[ -]/}                                     # "Hi-Hat Open" -> "HiHatOpen"
    convert_one "$f" "$to/$name.wav"
    n=$((n + 1))
  done
  echo "$3: $n campioni"
}

convert_kit "Boutique 808" "GB_Tasty808_" tr808
convert_kit "Boutique 909" "GB_Tasty909kit_" tr909
convert_kit "Boutique 78" "GB_Tasty78_" cr78
convert_exs "Cory's LinnDrum Kit" " - Cory's LinnDrum" linn
convert_exs "TR-707 Processed Kit" " - TR-707 Processed" tr707
