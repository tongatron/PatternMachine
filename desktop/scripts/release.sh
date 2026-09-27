#!/usr/bin/env bash
# Prepara le app da scaricare dal sito: build macOS, Windows e Linux con tutti i suoni del sito
# (campioni SP-1200 e RX-5 e i kit estratti da Logic in site/machines),
# firma ad-hoc e zip/installers con scheda app.json in ../site/download/ (fuori da git).
#
#   desktop/scripts/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=../site/download
MAC_ZIP=PatternMachine-macOS.zip
WIN_FILE=PatternMachine-Windows.exe
LINUX_FILE=PatternMachine-Linux.AppImage
APP=dist/mac-arm64/PatternMachine.app

# Ogni build deve avere tutte le macchine e tutti i campioni che ci sono nel sito.
check_sounds() {   # $1 = cartella site/ dentro la build
  local d
  for d in samples samples12 $(ls ../site/machines); do
    [ -d "../site/$d" ] && src="../site/$d" || src="../site/machines/$d"
    dst="$1/${src#../site/}"
    if [ "$(ls "$src" | wc -l)" != "$(ls "$dst" 2>/dev/null | wc -l)" ]; then
      echo "suoni mancanti nella build: ${src#../site/} ($1)" >&2; exit 1
    fi
  done
}

echo "== build macOS (tutti i suoni, anche i kit di Logic)"
rm -rf dist
npx electron-builder --mac dir --arm64 --config electron-builder.config.cjs >/dev/null
check_sounds "$APP/Contents/Resources/site"

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
rm -f "$OUT/$MAC_ZIP" "$OUT/$WIN_FILE" "$OUT/$LINUX_FILE"
ditto -c -k --keepParent "$STAGE/PatternMachine.app" "$OUT/$MAC_ZIP"

echo "== build Windows"
npx electron-builder --win nsis --x64 --config electron-builder.config.cjs >/dev/null
check_sounds dist/win-unpacked/resources/site
WIN_BUILD=$(find dist -maxdepth 1 -type f -name '*.exe' -print -quit)
[ -n "$WIN_BUILD" ] || { echo "installer Windows non trovato" >&2; exit 1; }
cp "$WIN_BUILD" "$OUT/$WIN_FILE"

echo "== build Linux"
npx electron-builder --linux AppImage --x64 --config electron-builder.config.cjs >/dev/null
check_sounds dist/linux-unpacked/resources/site
LINUX_BUILD=$(find dist -maxdepth 1 -type f -name '*.AppImage' -print -quit)
[ -n "$LINUX_BUILD" ] || { echo "AppImage Linux non trovata" >&2; exit 1; }
cp "$LINUX_BUILD" "$OUT/$LINUX_FILE"

version=$(node -p 'require("./package.json").version')
electron=$(node -p 'require("electron/package.json").version')
mac_bytes=$(stat -f %z "$OUT/$MAC_ZIP")
mac_sha=$(shasum -a 256 "$OUT/$MAC_ZIP" | cut -d' ' -f1)
win_bytes=$(stat -f %z "$OUT/$WIN_FILE")
win_sha=$(shasum -a 256 "$OUT/$WIN_FILE" | cut -d' ' -f1)
linux_bytes=$(stat -f %z "$OUT/$LINUX_FILE")
linux_sha=$(shasum -a 256 "$OUT/$LINUX_FILE" | cut -d' ' -f1)
cat > "$OUT/app.json" <<JSON
{
 "version": "$version",
 "date": "$(date +%Y-%m-%d)",
 "electron": "$electron",
 "platforms": {
   "mac": {"file": "$MAC_ZIP", "bytes": $mac_bytes, "sha256": "$mac_sha", "arch": "arm64", "minMacOS": "12"},
   "windows": {"file": "$WIN_FILE", "bytes": $win_bytes, "sha256": "$win_sha", "arch": "x64"},
   "linux": {"file": "$LINUX_FILE", "bytes": $linux_bytes, "sha256": "$linux_sha", "arch": "x64"}
 }
}
JSON
echo "ok: $OUT/$MAC_ZIP ($((mac_bytes/1024/1024)) MB)"
echo "ok: $OUT/$WIN_FILE ($((win_bytes/1024/1024)) MB)"
echo "ok: $OUT/$LINUX_FILE ($((linux_bytes/1024/1024)) MB), versione $version"
echo "per pubblicarla: scripts/deploy.sh --yes (dalla radice del progetto)"
