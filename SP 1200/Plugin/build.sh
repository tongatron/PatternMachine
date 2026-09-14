#!/bin/bash
# Compila, firma, installa e valida l'Audio Unit "Twelve".
#
# Serve solo la toolchain dei Command Line Tools: niente Xcode, niente CMake.
#   ./build.sh                compila, installa in ~/Library/Audio/Plug-Ins/Components, valida
#   ./build.sh --no-install   si ferma dopo la compilazione (bundle in build/)
#
# Il bundle viene sovrascritto in posto: la lista dei file che contiene è fissa
# (Info.plist, PkgInfo, MacOS/Twelve), quindi non serve svuotarlo prima e non
# restano residui di build precedenti.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="Twelve"
SDKDIR="$HERE/vendor/AudioUnitSDK"
BUNDLE="$HERE/build/$NAME.component"
DEST="$HOME/Library/Audio/Plug-Ins/Components"

INSTALL=1
[ "${1:-}" = "--no-install" ] && INSTALL=0

if [ ! -d "$SDKDIR" ]; then
	echo "AudioUnitSDK assente. Recuperalo con:"
	echo "  git clone --depth 1 https://github.com/apple/AudioUnitSDK.git \"$SDKDIR\""
	exit 1
fi

echo "==> struttura del bundle"
mkdir -p "$BUNDLE/Contents/MacOS"
cp "$HERE/Info.plist" "$BUNDLE/Contents/Info.plist"
printf 'BNDL????' > "$BUNDLE/Contents/PkgInfo"

# -Wno-function-effects: l'SDK marca Process() come [[clang::nonblocking]] e
# clang segnalerebbe ogni chiamata a funzione non annotata, comprese quelle di
# <cmath>, che non allocano e non bloccano.
COMMON=(
	-std=c++23 -O3
	-mmacosx-version-min=11.0
	-bundle
	-I"$SDKDIR/include" -I"$HERE/src"
	-Wall -Wno-function-effects
	-framework AudioToolbox -framework AudioUnit
	-framework CoreAudio -framework CoreFoundation
	-o "$BUNDLE/Contents/MacOS/$NAME"
	"$HERE/src/Twelve.cpp"
)
SDK_SRC=("$SDKDIR"/src/AudioUnitSDK/*.cpp)

echo "==> compilazione (arm64 + x86_64)"
if ! clang++ -arch arm64 -arch x86_64 "${COMMON[@]}" "${SDK_SRC[@]}" 2>/tmp/twelve_build.log; then
	echo "    universale non riuscito, riprovo solo arm64"
	cat /tmp/twelve_build.log
	clang++ -arch arm64 "${COMMON[@]}" "${SDK_SRC[@]}"
fi

# Host offline, usato da tools/measure.py e tools/bake-samples.sh. Sta qui
# perché una build pulita debba ricostruire tutto con un comando solo.
echo "==> host offline (twelve-render)"
clang++ -std=c++23 -O2 -arch arm64 -mmacosx-version-min=11.0 \
	-framework AudioToolbox -framework CoreFoundation \
	-o "$HERE/build/twelve-render" "$HERE/tools/render.cpp"

echo "==> firma ad-hoc"
codesign --force --sign - "$BUNDLE"
lipo -archs "$BUNDLE/Contents/MacOS/$NAME" | sed 's/^/    architetture: /'

if [ "$INSTALL" = "0" ]; then
	echo "==> fatto: $BUNDLE"
	exit 0
fi

echo "==> installazione in $DEST"
mkdir -p "$DEST"
ditto "$BUNDLE" "$DEST/$NAME.component"

echo "==> validazione con auval"
auval -v aufx Sp12 Tnga
