#!/bin/bash
# Prepara il plug-in per la pagina "App" del sito: build di prova, poi
#   site/download/PatternMachine-Plugin-macOS.zip   (AU + VST3 + LEGGIMI.txt)
#   site/download/plugin.json                       (versione, dimensione, SHA-256: la legge site/app.html)
# Non tocca app.json ne' gli zip dell'app desktop. Poi si pubblica con scripts/deploy.sh --yes.
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/build.sh --test
ART=build/PatternMachine_artefacts/Release
OUT=../site/download
ZIP=PatternMachine-Plugin-macOS.zip
VERSION=$(sed -n 's/^project(PatternMachinePlugin VERSION \([0-9.]*\).*/\1/p' CMakeLists.txt)

STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/PatternMachine Plug-in"
ditto "$ART/AU/PatternMachine.component" "$STAGE/PatternMachine Plug-in/PatternMachine.component"
ditto "$ART/VST3/PatternMachine.vst3" "$STAGE/PatternMachine Plug-in/PatternMachine.vst3"
cat > "$STAGE/PatternMachine Plug-in/LEGGIMI.txt" <<TXT
PatternMachine $VERSION - plug-in per Logic Pro (Audio Unit) e altre DAW (VST3), Mac con Apple Silicon.

Installare
1. Copia PatternMachine.component in ~/Library/Audio/Plug-Ins/Components
   (e PatternMachine.vst3 in ~/Library/Audio/Plug-Ins/VST3 se usi un'altra DAW).
2. Il plug-in non e' notarizzato da Apple: in Terminale esegui
   xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/Components/PatternMachine.component
3. Riapri Logic. Se non lo vede: Logic Pro > Impostazioni > Plug-in Manager > Reimposta e ripeti la scansione.

Usare
Nuova traccia Strumento software > slot Strumento > AU Instruments > Tongatron > PatternMachine > Stereo.
Premi Play in Logic: PatternMachine suona a tempo dalla battuta 1.
TXT
rm -f "$OUT/$ZIP"
(cd "$STAGE" && ditto -c -k --keepParent "PatternMachine Plug-in" "$OLDPWD/$OUT/$ZIP")

BYTES=$(stat -f %z "$OUT/$ZIP")
SHA=$(shasum -a 256 "$OUT/$ZIP" | cut -d' ' -f1)
cat > "$OUT/plugin.json" <<JSON
{
 "version": "$VERSION",
 "date": "$(date +%Y-%m-%d)",
 "file": "$ZIP", "bytes": $BYTES, "sha256": "$SHA",
 "arch": "arm64", "minMacOS": "12", "formats": ["AU", "VST3"]
}
JSON
echo "pronto: $OUT/$ZIP ($((BYTES/1048576)) MB) e $OUT/plugin.json"
