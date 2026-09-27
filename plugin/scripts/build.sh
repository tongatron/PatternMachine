#!/bin/bash
# Compila il plug-in PatternMachine (AU, VST3, Standalone) e lo installa in ~/Library/Audio/Plug-Ins.
#   plugin/scripts/build.sh           build Release + installazione + auval
#   plugin/scripts/build.sh --test    prima le prove del motore (EngineTest)
# Serve: Command Line Tools di Xcode, cmake e ninja (brew install cmake ninja).
set -euo pipefail
cd "$(dirname "$0")/.."

JUCE_TAG=8.0.15
if [ ! -d .deps/JUCE ]; then
  git clone --depth 1 --branch "$JUCE_TAG" https://github.com/juce-framework/JUCE.git .deps/JUCE
fi

cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
if [ "${1:-}" = "--test" ]; then
  cmake --build build --target EngineTest
  build/EngineTest_artefacts/Release/EngineTest
fi
cmake --build build --target PatternMachine_AU PatternMachine_VST3 PatternMachine_Standalone

echo
echo "Installato in ~/Library/Audio/Plug-Ins/Components/PatternMachine.component"
# Logic legge la cache degli AU: si svuota cosi' vede subito la versione nuova
killall -9 AudioComponentRegistrar 2>/dev/null || true
auval -v aumu PtMc Tgtn | tail -3
