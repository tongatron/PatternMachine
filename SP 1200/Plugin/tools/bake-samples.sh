#!/bin/bash
# Fa passare una cartella di campioni attraverso il plugin e scrive i risultati
# in una cartella nuova. Gli originali non vengono toccati.
#
#   ./tools/bake-samples.sh                          impostazioni della macchina
#   ./tools/bake-samples.sh drive=4 alias=65         con un po' di spinta
#   ./tools/bake-samples.sh clock=17000 bits=12      come accordare in basso
#
# Perché può convenire rispetto a un Bitcrusher su ogni pad: il carattere è già
# nel campione, quindi il kit non porta 42 inserti da calcolare in tempo reale.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/../Samples"
DST="$HERE/../Samples 12 bit"
RENDER="$HERE/build/twelve-render"

if [ ! -x "$RENDER" ]; then
	echo "twelve-render non compilato. Lancia prima:"
	echo "  clang++ -std=c++23 -O2 -framework AudioToolbox -framework CoreFoundation \\"
	echo "    -o \"$HERE/build/twelve-render\" \"$HERE/tools/render.cpp\""
	exit 1
fi
if [ ! -d "$SRC" ]; then
	echo "cartella dei campioni non trovata: $SRC"
	exit 1
fi

mkdir -p "$DST"
count=0
for f in "$SRC"/*.wav; do
	[ -e "$f" ] || continue
	base="$(basename "$f")"
	# tail corto: su un one-shot non serve mezzo secondo di coda.
	"$RENDER" "$f" "$DST/$base" tail=0.03 "$@" > /dev/null
	count=$((count + 1))
done

echo "processati $count campioni"
echo "in: $DST"
echo
echo "I file d'uscita sono float a 32 bit, così la grana a 12 bit resta intatta"
echo "senza una seconda quantizzazione sopra. Logic li importa senza problemi."
