// Prova del motore senza Logic: un campione "click" (un solo impulso) permette di leggere
// al campione esatto quando parte ogni colpo. Si lancia con plugin/scripts/build.sh --test.
#include "../Source/Engine.h"
#include <iostream>

static int failures = 0;
static void check (bool ok, const juce::String& what)
{
    std::cout << (ok ? "  ok   " : "  FAIL ") << what << "\n";
    if (! ok) ++failures;
}

static juce::var parse (const juce::String& json) { return juce::JSON::parse (json); }

// Suona `seconds` secondi a blocchi di 512 partendo da `ppq`, come farebbe Logic. Ritorna gli attacchi.
static std::vector<int> run (SampleCache& cache, const juce::String& engineJson, double ppq, double bpm, double seconds,
                             double jumpAtSec = -1, double jumpToPpq = 0)
{
    const double sr = 48000;
    auto snap = pm::Snapshot::fromVar (parse (engineJson), cache);
    pm::Engine engine;
    engine.prepare (sr);
    juce::AudioBuffer<float> buf (2, 512);
    juce::MidiBuffer midi;
    std::vector<int> onsets;
    int done = 0;
    bool jumped = false;
    while (done < (int) (seconds * sr))
    {
        if (jumpAtSec >= 0 && ! jumped && done >= jumpAtSec * sr) { ppq = jumpToPpq; jumped = true; }
        std::array<juce::AudioBuffer<float>*, 16> aux {};
        engine.process (buf, midi, snap.get(), { true, ppq, bpm }, aux);
        for (int i = 0; i < 512; ++i)
            if (std::abs (buf.getSample (0, i)) > 0.3f) onsets.push_back (done + i);
        done += 512;
        ppq += 512 * bpm / 60.0 / sr;
    }
    return onsets;
}

static juce::String engineJson (const juce::String& extra, const juce::String& patterns, const juce::String& song = "[]")
{
    return R"({"mode":"pattern","patternId":"A","swing":0,"human":0,"master":100,"bpm":120,)" + extra
         + R"("tracks":[{"id":"t1","file":"click.wav","vol":1,"decay":100,"cutoff":100,"on":true}],"patterns":)"
         + patterns + R"(,"song":)" + song + "}";
}

int main()
{
    // campione di prova: impulso a 1.0 e poi silenzio
    auto dir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("pm-engine-test");
    dir.createDirectory();
    {
        juce::AudioBuffer<float> click (1, 2000);
        click.clear();
        click.setSample (0, 0, 1.0f);
        dir.getChildFile ("click.wav").deleteFile();
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::OutputStream> os (dir.getChildFile ("click.wav").createOutputStream());
        auto w = wav.createWriterFor (os, juce::AudioFormatWriterOptions {}.withSampleRate (48000).withNumChannels (1).withBitsPerSample (24));
        w->writeFromAudioSampleBuffer (click, 0, click.getNumSamples());
    }
    SampleCache cache (dir);
    const int step = 6000;   // un sedicesimo a 120 bpm e 48 kHz

    std::cout << "Pattern, swing, salti\n";
    {
        auto pats = R"([{"id":"A","len":16,"grid":{"t1":[2,0,0,0,0,0,2,0,0,0,0,0,0,0,2,0]}}])";
        auto o = run (cache, engineJson ("", pats), 0, 120, 4.1);
        check (o.size() == 7 && o[0] == 0 && o[1] == 6 * step && o[2] == 14 * step && o[3] == 16 * step,
               "colpi sugli step 0, 6, 14 e i giri dopo");

        auto sw = R"([{"id":"A","len":16,"grid":{"t1":[2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}}])";
        o = run (cache, engineJson (R"("swing":50,)", sw), 0, 120, 0.5);
        check (o.size() == 2 && o[1] == 7500, "swing 62%: il secondo sedicesimo arriva a 7500 campioni");

        o = run (cache, engineJson ("", pats), 4.0, 120, 0.2);
        check (! o.empty() && o[0] == 0, "partenza dalla battuta 2: primo colpo subito");

        o = run (cache, engineJson ("", pats), 0.1, 120, 1.6);
        check (! o.empty() && o[0] == 6 * step - (int) (0.1 * 24000), "partenza a meta' step: niente colpo anticipato");

        // ciclo di Logic: a 1 s si torna all'inizio (ppq 0)
        o = run (cache, engineJson ("", pats), 0, 120, 1.5, 1.0, 0.0);
        const int jumpAt = (int) std::ceil (48000 / 512.0) * 512;
        check (std::find (o.begin(), o.end(), jumpAt) != o.end(), "salto del ciclo: lo step 0 riparte al salto");
    }

    std::cout << "Blocchi dello step\n";
    {
        auto flam = R"([{"id":"A","len":16,"grid":{"t1":[0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0]},"mods":{"t1":{"4":{"f":1}}}}])";
        auto o = run (cache, engineJson ("", flam), 0, 120, 1.0);
        check (o.size() == 2 && o[1] == 4 * step && o[0] == 4 * step - (int) (0.024 * 48000), "flam 24 ms prima");

        auto rat = R"([{"id":"A","len":16,"grid":{"t1":[2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},"mods":{"t1":{"0":{"r":2}}}}])";
        o = run (cache, engineJson ("", rat), 0, 120, 0.5);
        check (o.size() == 2 && o[1] == step / 2, "ripetizione a meta' step");

        auto poly = R"([{"id":"A","len":16,"grid":{"t1":[2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},"lens":{"t1":3}}])";
        o = run (cache, engineJson ("", poly), 0, 120, 2.0);
        check (o.size() >= 6 && o[1] == 3 * step && o[5] == 15 * step && (o.size() < 7 || o[6] == 18 * step),
               "poliritmo: traccia di 3 step che non si riallinea");
    }

    std::cout << "Canzone\n";
    {
        auto pats = R"([{"id":"A","len":16,"grid":{"t1":[2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}},
                        {"id":"B","len":16,"grid":{"t1":[0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0]}}])";
        auto song = R"([{"id":"b1","patternId":"A","repeats":2},{"id":"b2","patternId":"B","repeats":1}])";
        auto json = engineJson ("", pats, song).replace (R"("mode":"pattern")", R"("mode":"song")");
        auto o = run (cache, json, 0, 120, 8.1);
        const int bar = 16 * step;
        check (o.size() == 5 && o[0] == 0 && o[1] == bar && o[2] == 2 * bar + 8 * step && o[3] == 3 * bar,
               "A x2, B, poi la canzone ricomincia");
        o = run (cache, json, -1.0, 120, 0.6);
        check (o.size() == 1 && o[0] == 24000, "pre-roll di Logic: silenzio fino alla battuta 1");
    }

    std::cout << "Campioni del sito\n";
    {
        SampleCache site (juce::File (PM_TEST_SITE_DIR));
        const auto* s = site.get ("machines/tr808/BD.wav");
        if (s == nullptr) s = site.get ("samples/Kick 1 SP-1200.wav");
        check (s != nullptr && s->length() > 100, "un kick del sito si carica");
        check (site.get ("../server.py") == nullptr, "niente file fuori da site/");
    }

    std::cout << (failures ? juce::String (failures) + " prove fallite\n" : juce::String ("tutte le prove passate\n"));
    return failures ? 1 : 0;
}
