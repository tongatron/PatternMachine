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
// Si usa solo dal thread dei messaggi. I campioni non vengono mai liberati finche' il plug-in e'
// aperto: le voci in riproduzione tengono puntatori semplici e non devono mai restare appese.
class SampleCache
{
public:
    explicit SampleCache (juce::File siteRoot);

    // Percorso relativo come lo usa il sito (es. "machines/tr808/BD.wav"). nullptr se manca.
    const SampleData* get (const juce::String& relativePath);
    juce::File resolve (const juce::String& relativePath) const;
    const juce::File& root() const { return siteRoot; }

private:
    juce::File siteRoot;
    juce::AudioFormatManager formats;
    std::map<juce::String, std::unique_ptr<SampleData>> cache;
};
