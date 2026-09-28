#!/usr/bin/env bash
# Compila le unita' oscillatore della logue-sdk di KORG (NTS-1 mkII) in moduli WebAssembly per il synth del sito.
#
#   synth/build-logue.sh              compila le unita' elencate in UNITS
#   synth/build-logue.sh waves        solo quella
#
# Serve Emscripten (brew install emscripten). La logue-sdk si scarica la prima volta in synth/vendor/
# (fuori da git). I .wasm finiscono in site/engine/logue/ con units.json, l'elenco letto dal sito.
# Ogni unita' e' compilata con synth/logue/glue.cc: niente thread ne' JavaScript di Emscripten, solo
# funzioni C che site/engine/synth-worklet.js chiama direttamente.
set -euo pipefail
cd "$(dirname "$0")/.."

SDK=synth/vendor/logue-sdk
PLATFORM=$SDK/platform/nts-1_mkii
OUT=site/engine/logue
UNITS=(waves pluck)
[ $# -gt 0 ] && UNITS=("$@")

command -v emcc >/dev/null || { echo "manca emcc: brew install emscripten" >&2; exit 1; }
if [ ! -d "$SDK" ]; then
  git clone --depth 1 https://github.com/korginc/logue-sdk.git "$SDK"
fi
mkdir -p "$OUT"
cp "$SDK/LICENSE" "$OUT/LICENSE-logue-sdk.txt"

for u in "${UNITS[@]}"; do
  dir=$PLATFORM/$u
  [ -f "$dir/osc.h" ] || { echo "$u: non e' un'unita' oscillatore di $PLATFORM" >&2; exit 1; }
  echo "== $u"
  emcc -O3 -fno-exceptions -fno-rtti -ffast-math \
    -Wno-unknown-attributes -Wno-c99-designator -Wno-deprecated \
    -sSTANDALONE_WASM --no-entry -sINITIAL_MEMORY=262144 -sSTACK_SIZE=32768 -sALLOW_MEMORY_GROWTH=0 \
    -sFILESYSTEM=0 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
    -I"$dir" -I"$PLATFORM/common" -I"$SDK/websim/dsp" \
    synth/logue/glue.cc "$dir/header.c" "$SDK"/websim/dsp/*.c "$SDK/websim/dsp/osc_api.cpp" \
    -o "$OUT/$u.wasm"
  ls -l "$OUT/$u.wasm" | awk '{print $5" byte"}'
done

# Elenco delle unita' disponibili (tutte quelle compilate, non solo quelle appena rifatte).
python3 - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
units = sorted(f[:-5] for f in os.listdir(out) if f.endswith(".wasm"))
json.dump({"platform": "nts-1_mkii", "units": units}, open(os.path.join(out, "units.json"), "w"), indent=1)
print("units.json:", ", ".join(units))
PY
