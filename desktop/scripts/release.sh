#!/usr/bin/env bash
# Prepara l'app da scaricare dal sito: build senza kit Apple, firma ad-hoc, zip e scheda app.json
# in ../site/download/ (fuori da git). Poi scripts/deploy.sh la pubblica insieme al sito.
#
#   desktop/scripts/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=../site/download
ZIP=PatternMachine-macOS.zip
APP=dist/mac-arm64/PatternMachine.app

echo "== build (senza kit 808/909 di Logic)"
rm -rf dist/mac-arm64
PM_KIT_LOGIC=0 npx electron-builder --mac dir --arm64 --config electron-builder.config.cjs >/dev/null
if [ -d "$APP/Contents/Resources/site/machines/tr808" ] || [ -d "$APP/Contents/Resources/site/machines/tr909" ]; then
  echo "i kit di Logic sono finiti nell'app: fermo tutto" >&2; exit 1
fi

echo "== firma ad-hoc"
# Senza firma valida, un'app scaricata su Apple Silicon risulta "danneggiata". Ad-hoc non basta per
# Gatekeeper (serve l'account Apple Developer), ma si apre da Impostazioni > Privacy e sicurezza.
# Si firma una copia senza attributi estesi e resource fork: con quelli codesign rifiuta il pacchetto.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ditto --noextattr --norsrc "$APP" "$STAGE/PatternMachine.app"
codesign --force --deep --sign - "$STAGE/PatternMachine.app"
codesign --verify --deep --strict "$STAGE/PatternMachine.app"

echo "== zip"
mkdir -p "$OUT"
rm -f "$OUT/$ZIP"
ditto -c -k --keepParent "$STAGE/PatternMachine.app" "$OUT/$ZIP"

version=$(node -p 'require("./package.json").version')
electron=$(node -p 'require("electron/package.json").version')
bytes=$(stat -f %z "$OUT/$ZIP")
sha=$(shasum -a 256 "$OUT/$ZIP" | cut -d' ' -f1)
cat > "$OUT/app.json" <<JSON
{
 "file": "$ZIP",
 "version": "$version",
 "date": "$(date +%Y-%m-%d)",
 "bytes": $bytes,
 "sha256": "$sha",
 "arch": "arm64",
 "minMacOS": "12",
 "electron": "$electron"
}
JSON
echo "ok: $OUT/$ZIP ($((bytes/1024/1024)) MB), versione $version"
echo "per pubblicarla: scripts/deploy.sh --yes (dalla radice del progetto)"
