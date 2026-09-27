#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "Engine.h"

// Il plug-in: tiene il progetto (salvato dentro il progetto di Logic), il motore e il trasporto.
// Se Logic suona, comanda Logic; se Logic e' fermo, il Play della pagina fa girare un trasporto interno.
class PatternMachineProcessor : public juce::AudioProcessor
{
public:
    PatternMachineProcessor();
    ~PatternMachineProcessor() override;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout&) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 2.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    //==============================================================================
    // Dalla pagina (thread dei messaggi)
    void setProject (const juce::var& state, const juce::var& engine);   // ogni modifica del progetto
    juce::var getSavedState() const;                                     // per riaprire la pagina com'era
    void hit (const juce::var& voice, double velocity, double delaySec);
    void setInternalPlay (bool play, double startStep);

    // Per la pagina: posizione attuale del trasporto
    struct Position
    {
        bool playing = false, host = false, hostPlaying = false, hostTempo = false;
        double ppq = 0, bpm = 120;
        pm::StepPos pos;
    };
    Position getPosition() const;

    juce::File siteDir() const { return samples.root(); }
    juce::File bridgeDir() const;

    int editorW = 1280, editorH = 860;

private:
    void installSnapshot (std::unique_ptr<pm::Snapshot>);
    void collectGarbage();

    // Margine sull'uscita: i volumi sono quelli del sito (fino a 1.4 per colpo), che in Logic
    // con piu' voci insieme andavano oltre 0 dBFS. -6 dB lascia spazio a mixer ed effetti.
    static constexpr float outputGain = 0.5f;

    SampleCache samples;
    pm::Engine engine;

    // Istantanee del progetto: le crea il thread dei messaggi, il thread audio legge l'ultima.
    // Una vecchia si libera solo quando non e' ne' l'ultima ne' quella in uso da almeno un secondo.
    std::atomic<const pm::Snapshot*> latest { nullptr }, inUse { nullptr };
    std::vector<std::pair<std::unique_ptr<pm::Snapshot>, juce::uint32>> owned;

    mutable juce::CriticalSection stateLock;
    juce::String stateJson, engineJson;

    std::atomic<bool> internalPlay { false };
    std::atomic<double> internalStart { 0 };
    std::atomic<int> internalRestart { 0 };
    int internalSeen = 0;
    double internalPpq = 0;

    std::atomic<bool> posPlaying { false }, posHost { false }, posHostPlaying { false }, posHostTempo { false };
    std::atomic<double> posPpq { 0 }, posBpm { 120 };

    JUCE_DECLARE_WEAK_REFERENCEABLE (PatternMachineProcessor)
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PatternMachineProcessor)
};
