#pragma once
#include "SampleCache.h"
#include <array>
#include <vector>

// Motore del plug-in: la stessa musica di scheduler() e trigger() in site/index.html, ma in C++,
// dentro processBlock e agganciata alla posizione (PPQ) del progetto di Logic.
// Se cambia il modo in cui il sito suona uno step, va allineato anche qui (come clockStep() dell'app).
namespace pm
{

// Una voce come la vuole trigger(): la traccia con i blocchi dello step gia' applicati.
struct VoiceParams
{
    const SampleData* sample = nullptr;
    int output = 0;                     // 0 = uscita principale, 1..16 = aux dello strumento
    float vol = 0.8f;
    double tune = 0;                    // semitoni
    float decay = 100, cutoff = 100, reso = 0, start = 0;
    bool reverse = false;
    int choke = 0;
};

// Blocchi per step (mods nel sito): p probabilita', r ripetizioni, f flam, t semitoni, d decay, c filtro.
struct Mod
{
    int p = 100, r = 1, f = 0;
    double t = 0;
    float d = 0, c = 0;
};

struct TrackDef
{
    juce::String id, file;
    VoiceParams voice;
    double nudgeSec = 0;
    bool on = true;                     // non in mute e, se c'e' un solo, in solo
};

struct PatternDef
{
    juce::String id;
    int len = 16;
    std::vector<std::vector<uint8_t>> grid;   // [traccia][step] 0 spento, 1 normale, 2 accento, 3 fantasma
    std::vector<std::vector<Mod>> mods;       // [traccia][step]
    std::vector<int> lens;                    // [traccia] lunghezza propria (0 = quella del pattern)
};

struct RhythmDef
{
    // Durata in quarti della battuta e numero di passi della battuta. Il sito
    // usa 4/4 = 4 quarti e 6/8 = 1,5 quarti, con una griglia separata per le triplette.
    double barQuarters = 4.0;
    int stepsPerBar = 16;
    double grooveSwing = 0.0;           // 0..0.5, come PMRhythm
    std::array<double, 8> offsetsMs {}; // groove offset per passo, in millisecondi
    bool triplet = false;

    double basePpq() const { return barQuarters / juce::jmax (1, stepsPerBar); }
    double stepPpq (juce::int64 n, int localStep, double userSwing, double tempo) const;
    double stepDurPpq (int localStep, double userSwing) const;
};

struct BlockDef
{
    int pattern = -1, fill = -1, repeats = 1, len = 16;
    juce::int64 start = 0, steps = 16;
    std::vector<int> mutedTracks;
};

struct SynthNoteDef
{
    int step = 0, note = 60, length = 1;
    bool accent = false, slide = false;
};

struct SynthPatternDef
{
    juce::String id;
    int len = 16;
    std::vector<SynthNoteDef> notes;
};

struct SynthBlockDef
{
    int pattern = -1, fill = -1, repeats = 1, len = 16;
    juce::int64 start = 0, steps = 16;
    bool muted = false;
};

struct SynthDef
{
    bool on = false;
    bool solo = false;
    int current = -1, soloBlock = -1;
    float volume = 0.7f;
    int wave1 = 0, wave2 = 0;
    float level1 = 0.8f, level2 = 0.0f;
    float attack = 0, decay = 50, sustain = 100, release = 20;
    float cutoff = 100, resonance = 0, transpose = 0, gate = 75;
};

// Dove cade lo step numero n (sedicesimi dall'inizio del progetto di Logic).
struct StepPos
{
    bool valid = false;
    juce::int64 n = 0;
    int pattern = -1, step = 0, cycle = 0, block = -1, rep = 0;
};

struct Snapshot
{
    std::vector<TrackDef> tracks;
    std::vector<PatternDef> patterns;
    std::vector<BlockDef> song;
    SynthDef synth;
    std::vector<SynthPatternDef> synthPatterns;
    std::vector<SynthBlockDef> synthSong;
    juce::int64 synthTotal = 0;
    juce::int64 total = 0;
    bool songMode = false;
    RhythmDef rhythm;
    int current = 0, soloBlock = -1;
    double swing = 0, human = 0, master = 0.85, bpm = 93;
    bool metronome = false;

    // Stato mandato dal ponte JS (vedi engineState() in bridge/plugin-bridge.js).
    static std::unique_ptr<Snapshot> fromVar (const juce::var& engine, SampleCache& samples);

    StepPos locate (juce::int64 n) const;
    // Swing alla MPC: gli step dispari arrivano in ritardo, la coppia dura sempre due sedicesimi.
    double stepPpq (const StepPos& p, double tempo = -1) const { return rhythm.stepPpq (p.n, p.step, swing, tempo > 0 ? tempo : bpm); }
    double stepDurPpq (const StepPos& p) const { return rhythm.stepDurPpq (p.step, swing); }
    int stepIdx (const PatternDef& pat, size_t track, const StepPos& p) const;
};

class Engine
{
public:
    struct Transport
    {
        bool playing = false;
        double ppq = 0, bpm = 120;
    };

    Engine();
    void prepare (double sampleRate);
    void reset();

    // Thread audio. snapshot puo' essere nullptr (niente progetto ancora arrivato dalla pagina).
    void process (juce::AudioBuffer<float>& out, const juce::MidiBuffer& midi, const Snapshot* snapshot, Transport t,
                  const std::array<juce::AudioBuffer<float>*, 16>& aux, int trackFilter = -1);

    // Thread dei messaggi: un colpo da suonare subito (pad, ascolto, libreria), con un ritardo opzionale.
    void pushHit (const VoiceParams& v, float velocity, double master, double delaySec);

    static constexpr int maxVoices = 64;
    static constexpr double lookaheadSec = 0.05;   // anticipo per flam, nudge e umanizza negativi
    static constexpr double flamSec = 0.024;        // FLAM_SEC del sito

private:
    struct Event
    {
        juce::int64 time = 0;          // in campioni dall'avvio del motore
        VoiceParams v;
        float gain = 0;
        int metro = 0;                  // 0 campione, 1 click normale, 2 click accentato
        bool sequenced = false;
        bool synth = false;
        int note = 60;
        double noteLengthSec = 0;
        bool slide = false;
    };

    struct Biquad
    {
        float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
        void lowpass (double hz, double qDb, double sr);
        inline float run (float x) { auto y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; }
    };

    struct Voice
    {
        bool active = false;
        juce::uint32 serial = 0;
        const SampleData* s = nullptr;
        int output = 0;
        bool rev = false, filt = false;
        double pos = 0, inc = 1;
        float gain = 0;
        juce::int64 age = 0, holdEnd = -1, chokeAt = -1;
        Biquad f[2][2];                 // [stadio][canale]: lowpass a 4 poli come nel sito
        int metro = 0;
        double phase = 0;
    };

    struct SynthVoice
    {
        bool active = false, releasing = false;
        double phase1 = 0, phase2 = 0, pitch = 60, target = 60;
        float gain = 0, velocity = 0.8f;
        juce::int64 age = 0, holdEnd = -1, releaseAge = -1;
        float filter = 0;
    };

    void emitStep (const Snapshot& s, const StepPos& p, double ppqStart, double ppqPerSample, int trackFilter);
    void emitSynthStep (const Snapshot& s, const StepPos& p, double ppqStart, double ppqPerSample, int trackFilter);
    void schedule (const Event& e);
    void startVoice (const Event& e);
    void startSynthVoice (const Event& e, const Snapshot& s);
    void render (juce::AudioBuffer<float>& out, int from, int to,
                 const std::array<juce::AudioBuffer<float>*, 16>& aux, int trackFilter);

    double sr = 44100;
    juce::int64 clock = 0;
    bool wasPlaying = false;
    double expectedPpq = 0;
    juce::int64 nextN = 0;
    std::vector<Event> pending, due;
    std::array<Voice, maxVoices> voices;
    std::array<SynthVoice, 16> synthVoices;
    SynthDef activeSynth;
    juce::uint32 serials = 0;
    std::array<std::pair<int, juce::uint32>, 17> chokeOwner {};
    juce::Random rng;

    // Colpi dal thread dei messaggi
    juce::AbstractFifo hitFifo { 256 };
    std::array<Event, 256> hitBuf;
    double hitDelay[256] {};
};

} // namespace pm
