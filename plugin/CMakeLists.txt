cmake_minimum_required(VERSION 3.22)

# PatternMachine come plug-in Audio Unit (strumento) per Logic Pro.
# L'interfaccia e' il sito (../site) in un WebView; sequencer e campionatore girano in C++
# agganciati alla posizione del progetto di Logic (vedi README.md).

project(PatternMachinePlugin VERSION 0.1.0 LANGUAGES C CXX OBJC OBJCXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING "")

set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/.deps/JUCE" CACHE PATH "Cartella di JUCE 8")
add_subdirectory("${JUCE_DIR}" JUCE EXCLUDE_FROM_ALL)

set(PM_SITE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../site")

juce_add_plugin(PatternMachine
    COMPANY_NAME "Tongatron"
    COMPANY_WEBSITE "https://patternmachine.tongatron.org"
    BUNDLE_ID "org.tongatron.patternmachine.plugin"
    PLUGIN_MANUFACTURER_CODE Tgtn
    PLUGIN_CODE PtMc
    FORMATS AU VST3 Standalone
    PRODUCT_NAME "PatternMachine"
    DESCRIPTION "Drum machine a pattern agganciata al trasporto"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    AU_MAIN_TYPE kAudioUnitType_MusicDevice
    VST3_CATEGORIES Instrument Drum
    NEEDS_WEB_BROWSER TRUE
    COPY_PLUGIN_AFTER_BUILD TRUE)

target_sources(PatternMachine PRIVATE
    Source/Engine.cpp
    Source/SampleCache.cpp
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp)

target_compile_definitions(PatternMachine PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0)

target_link_libraries(PatternMachine
    PRIVATE juce::juce_audio_utils juce::juce_gui_extra
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)

# Il sito (senza site/download, gli zip dell'app) e il ponte finiscono dentro ogni bundle, in
# Contents/Resources: il plug-in suona tutti i kit anche senza rete e senza il repository.
# Il target gira a ogni build, anche se e' cambiato solo il sito o il ponte, e aggiorna pure le copie
# gia' installate in ~/Library/Audio/Plug-Ins (le risorse non fanno parte della firma ad-hoc).
set(PM_ART "${CMAKE_BINARY_DIR}/PatternMachine_artefacts/$<CONFIG>")
set(PM_BUNDLES
    "${PM_ART}/AU/PatternMachine.component"
    "${PM_ART}/VST3/PatternMachine.vst3"
    "${PM_ART}/Standalone/PatternMachine.app"
    "$ENV{HOME}/Library/Audio/Plug-Ins/Components/PatternMachine.component"
    "$ENV{HOME}/Library/Audio/Plug-Ins/VST3/PatternMachine.vst3")
set(PM_COPY_COMMANDS)
foreach(bundle ${PM_BUNDLES})
    list(APPEND PM_COPY_COMMANDS
        COMMAND mkdir -p "${bundle}/Contents/Resources"
        COMMAND rsync -a --delete --exclude download/ --exclude .DS_Store "${PM_SITE_DIR}/" "${bundle}/Contents/Resources/site/"
        COMMAND rsync -a --delete "${CMAKE_CURRENT_SOURCE_DIR}/bridge/" "${bundle}/Contents/Resources/bridge/")
endforeach()
add_custom_target(PatternMachine_Resources ALL ${PM_COPY_COMMANDS} VERBATIM)
foreach(fmt AU VST3 Standalone)
    add_dependencies(PatternMachine_${fmt} PatternMachine_Resources)
endforeach()

# Prova del motore senza host: posizioni, swing, canzone, render audio.
juce_add_console_app(EngineTest PRODUCT_NAME "EngineTest")
target_sources(EngineTest PRIVATE tests/EngineTest.cpp Source/Engine.cpp Source/SampleCache.cpp)
target_compile_definitions(EngineTest PRIVATE JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0
    PM_TEST_SITE_DIR="${PM_SITE_DIR}")
target_link_libraries(EngineTest PRIVATE juce::juce_audio_formats juce::juce_audio_basics
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
