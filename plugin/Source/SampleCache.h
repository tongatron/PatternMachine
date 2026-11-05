#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <map>
#include <memory>

// Un campione caricato dal disco, dritto e al contrario (il "reverse" della traccia).
struct SampleData
{
    juce::AudioBuffer<float> fwd, rev;
    double sampleRate = 44100.0;
    int length() const { return fwd.getNumSamples(); }
    double seconds() const { return length() / sampleRate; }
};

// Campioni del sito letti dalla cartella site/ (dentro il bundle o nel repository).
// __samples/ e __kits/ puntano invece alla cartella dati dell'app macOS, così un progetto
// con campioni o drum machine personali resta riproducibile anche dentro Logic.
// Si usa solo dal thread dei messaggi. I campioni non vengono mai liberati finche' il plug-in e'
// aperto: le voci in riproduzione tengono puntatori semplici e non devono mai restare appese.
class SampleCache
{
public:
    explicit SampleCache (juce::File siteRoot, juce::File userRoot = {});

    // Percorso relativo come lo usa il sito (es. "machines/tr808/BD.wav"). nullptr se manca.
    const SampleData* get (const juce::String& relativePath);
    juce::File resolve (const juce::String& relativePath) const;
    const juce::File& root() const { return siteRoot; }

private:
    juce::File siteRoot;
    juce::File userRoot;
    juce::AudioFormatManager formats;
    std::map<juce::String, std::unique_ptr<SampleData>> cache;
};
