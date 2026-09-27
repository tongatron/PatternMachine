#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

// La finestra del plug-in: il sito di PatternMachine in un WebView (WKWebView su macOS).
// Le pagine arrivano dalla cartella site/ del bundle; plugin-bridge.js aggancia la pagina al plug-in
// con l'evento "pm" (vedi bridge/plugin-bridge.js per l'elenco dei messaggi).
class PatternMachineEditor : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit PatternMachineEditor (PatternMachineProcessor&);
    ~PatternMachineEditor() override;

    void resized() override;
    void stateRestored();        // Logic ha ricaricato lo stato (es. riapertura del progetto)

private:
    void timerCallback() override;
    void onMessage (const juce::var& msg);
    void send (const juce::var& msg);
    void reply (const juce::var& req, const juce::var& result, const juce::String& error = {});
    std::optional<juce::WebBrowserComponent::Resource> serve (const juce::String& url);
    juce::var projects (const juce::var& msg);
    juce::var exportFile (const juce::var& msg);

    PatternMachineProcessor& proc;
    juce::WebBrowserComponent web;
    juce::String lastPos;
    bool pageReady = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PatternMachineEditor)
};
