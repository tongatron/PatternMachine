#include "Engine.h"
#include <cmath>

namespace pm
{

static juce::int64 floorDiv (juce::int64 a, juce::int64 b) { auto q = a / b; return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q; }
static juce::int64 floorMod (juce::int64 a, juce::int64 b) { return a - floorDiv (a, b) * b; }

// Livelli dello step: 1 normale, 2 accento, 3 nota fantasma (stepVel del sito).
static float stepVel (int v) { return v == 2 ? 1.0f : (v == 3 ? 0.42f : 0.76f); }
// 0..100 -> 200 Hz .. 20 kHz logaritmico (cutoffHz) e Q 0.7 .. 12 (resoQ)
static double cutoffHz (double v) { return 200.0 * std::pow (100.0, v / 100.0); }
static double resoQ (double v) { return 0.7 + v / 100.0 * 11.3; }

double RhythmDef::stepDurPpq (int localStep, double userSwing) const
{
    const auto amount = triplet ? 0.0 : juce::jmax (grooveSwing, juce::jlimit (0.0, 0.5, userSwing));
    const auto pair = (localStep & 1) == 0 ? 1.0 + amount : 1.0 - amount;
    return basePpq() * pair;
}

double RhythmDef::stepPpq (juce::int64 n, int localStep, double userSwing, double tempo) const
{
    const auto amount = triplet ? 0.0 : juce::jmax (grooveSwing, juce::jlimit (0.0, 0.5, userSwing));
    const auto pairOffset = (localStep & 1) ? basePpq() * amount : 0.0;
    const auto offset = offsetsMs[(size_t) juce::jmax (0, localStep) % offsetsMs.size()] / 1000.0;
    return (double) n * basePpq() + pairOffset + offset * tempo / 60.0;
}

//==============================================================================
std::unique_ptr<Snapshot> Snapshot::fromVar (const juce::var& e, SampleCache& samples)
{
    auto s = std::make_unique<Snapshot>();
    auto num = [] (const juce::var& v, double def) { return v.isVoid() || v.isUndefined() ? def : (double) v; };

    s->songMode = e["mode"].toString() == "song";
    s->swing = juce::jlimit (0.0, 100.0, num (e["swing"], 0)) / 100.0 * 0.5;
    s->human = juce::jlimit (0.0, 100.0, num (e["human"], 0)) / 100.0;
    s->master = juce::jlimit (0.0, 100.0, num (e["master"], 85)) / 100.0;
    s->bpm = juce::jlimit (20.0, 999.0, num (e["bpm"], 93));
    s->metronome = (bool) e["metronome"];

    if (auto* r = e["rhythm"].getDynamicObject())
    {
        const auto meter = r->getProperty ("meter").toString();
        const auto resolution = r->getProperty ("resolution").toString();
        s->rhythm.barQuarters = meter == "6/8" ? 1.5 : 4.0;
        s->rhythm.stepsPerBar = meter == "6/8" ? (resolution == "triplet" ? 18 : 12)
                                                   : (resolution == "triplet" ? 12 : 16);
        s->rhythm.triplet = resolution == "triplet";
        const auto groove = r->getProperty ("groove").toString();
        if (groove == "mpc") s->rhythm.grooveSwing = 0.16;
        else if (groove == "shuffle") s->rhythm.grooveSwing = 0.33;
        else if (groove == "laidback") s->rhythm.offsetsMs = { 0, 7, 0, 5, 0, 8, 0, 5 };
        else if (groove == "pushed") s->rhythm.offsetsMs = { -5, 0, -4, 0, -5, 0, -4, 0 };
        else if (groove == "dilla") { s->rhythm.grooveSwing = 0.08; s->rhythm.offsetsMs = { 0, 10, -2, 7, 0, 12, -3, 8 }; }
    }

    std::map<juce::String, size_t> trackIndex;
    if (auto* tracks = e["tracks"].getArray())
        for (auto& t : *tracks)
        {
            TrackDef d;
            d.id = t["id"].toString();
            d.file = t["file"].toString();
            d.voice.sample = samples.get (d.file);
            d.voice.output = (int) s->tracks.size();
            d.voice.vol = (float) num (t["vol"], 0.8);
            d.voice.tune = num (t["tune"], 0);
            d.voice.decay = (float) num (t["decay"], 100);
            d.voice.cutoff = (float) num (t["cutoff"], 100);
            d.voice.reso = (float) num (t["reso"], 0);
            d.voice.start = (float) num (t["start"], 0);
            d.voice.reverse = (bool) t["reverse"];
            d.voice.choke = juce::jlimit (0, 16, (int) num (t["choke"], 0));
            d.nudgeSec = num (t["nudge"], 0) / 1000.0;
            d.on = t.hasProperty ("on") ? (bool) t["on"] : true;
            trackIndex[d.id] = s->tracks.size();
            s->tracks.push_back (std::move (d));
        }

    const auto nt = s->tracks.size();
    std::map<juce::String, int> patternIndex;
    if (auto* pats = e["patterns"].getArray())
        for (auto& p : *pats)
        {
            PatternDef d;
            d.id = p["id"].toString();
            d.len = juce::jlimit (1, 256, (int) num (p["len"], 16));
            d.grid.assign (nt, std::vector<uint8_t> ((size_t) d.len, 0));
            d.mods.assign (nt, std::vector<Mod> ((size_t) d.len));
            d.lens.assign (nt, 0);

            if (auto* grid = p["grid"].getDynamicObject())
                for (auto& [tid, row] : grid->getProperties())
                    if (auto it = trackIndex.find (tid.toString()); it != trackIndex.end())
                        if (auto* arr = row.getArray())
                            for (int i = 0; i < juce::jmin (d.len, arr->size()); ++i)
                                d.grid[it->second][(size_t) i] = (uint8_t) juce::jlimit (0, 3, (int) (*arr)[i]);

            if (auto* mods = p["mods"].getDynamicObject())
                for (auto& [tid, row] : mods->getProperties())
                    if (auto it = trackIndex.find (tid.toString()); it != trackIndex.end())
                        if (auto* steps = row.getDynamicObject())
                            for (auto& [idx, m] : steps->getProperties())
                            {
                                auto i = idx.toString().getIntValue();
                                if (i < 0 || i >= d.len) continue;
                                auto& mod = d.mods[it->second][(size_t) i];
                                mod.p = (int) num (m["p"], 100);
                                mod.r = juce::jlimit (1, 8, (int) num (m["r"], 1));
                                mod.f = (int) num (m["f"], 0);
                                mod.t = num (m["t"], 0);
                                mod.d = (float) num (m["d"], 0);
                                mod.c = (float) num (m["c"], 0);
                            }

            if (auto* lens = p["lens"].getDynamicObject())
                for (auto& [tid, L] : lens->getProperties())
                    if (auto it = trackIndex.find (tid.toString()); it != trackIndex.end())
                        if ((int) L > 0 && (int) L < d.len) d.lens[it->second] = (int) L;

            patternIndex[d.id] = (int) s->patterns.size();
            s->patterns.push_back (std::move (d));
        }

    auto patIdx = [&] (const juce::var& id) { auto it = patternIndex.find (id.toString()); return it == patternIndex.end() ? -1 : it->second; };
    s->current = juce::jmax (0, patIdx (e["patternId"]));

    // songLayout(): blocchi uno dopo l'altro, lunghezza = pattern x ripetizioni
    auto soloId = e["soloBlockId"].toString();
    if (auto* song = e["song"].getArray())
        for (auto& b : *song)
        {
            BlockDef d;
            d.pattern = patIdx (b["patternId"]);
            if (d.pattern < 0) continue;
            d.fill = patIdx (b["fillPatternId"]);
            d.repeats = juce::jmax (1, (int) num (b["repeats"], 1));
            d.len = s->patterns[(size_t) d.pattern].len;
            d.start = s->total;
            d.steps = (juce::int64) d.len * d.repeats;
            if (auto* mutes = b["mutes"].getArray())
                for (const auto& id : *mutes)
                    if (auto it = trackIndex.find (id.toString()); it != trackIndex.end())
                        d.mutedTracks.push_back ((int) it->second);
            if (soloId.isNotEmpty() && b["id"].toString() == soloId) s->soloBlock = (int) s->song.size();
            s->total += d.steps;
            s->song.push_back (d);
        }

    // Linea synth del sito: il plug-in la renderizza nel bus principale di Logic,
    // invece di lasciarla suonare dentro il WebView (che Logic non sente).
    std::map<juce::String, int> synthPatternIndex;
    if (auto* pats = e["synthPatterns"].getArray())
        for (auto& p : *pats)
        {
            SynthPatternDef d;
            d.id = p["id"].toString();
            d.len = juce::jlimit (1, 256, (int) num (p["len"], 16));
            if (auto* notes = p["synth"].getArray())
                for (auto& n : *notes)
                {
                    SynthNoteDef x;
                    x.step = juce::jlimit (0, d.len - 1, (int) num (n["s"], 0));
                    x.note = juce::jlimit (0, 127, (int) num (n["n"], 60));
                    x.length = juce::jlimit (1, d.len - x.step, (int) num (n["l"], 1));
                    x.accent = (bool) n["a"];
                    x.slide = (bool) n["g"];
                    d.notes.push_back (x);
                }
            synthPatternIndex[d.id] = (int) s->synthPatterns.size();
            s->synthPatterns.push_back (std::move (d));
        }

    auto synthPatIdx = [&] (const juce::var& id)
    {
        auto it = synthPatternIndex.find (id.toString());
        return it == synthPatternIndex.end() ? -1 : it->second;
    };
    if (auto* sy = e["synth"].getDynamicObject())
    {
        s->synth.on = (bool) sy->getProperty ("on");
        s->synth.solo = (bool) sy->getProperty ("solo");
        s->synth.current = synthPatIdx (sy->getProperty ("patternId"));
        const auto synthSoloId = sy->getProperty ("soloBlockId").toString();
        s->synth.volume = (float) juce::jlimit (0.0, 1.0, num (sy->getProperty ("volume"), 100) / 100.0);
        if (auto* p = sy->getProperty ("params").getDynamicObject())
        {
            auto wave = [] (const juce::String& v) { return v == "square" ? 1 : v == "tri" ? 2 : v == "sine" ? 3 : 0; };
            s->synth.wave1 = wave (p->getProperty ("o1Wave").toString());
            s->synth.wave2 = wave (p->getProperty ("o2Wave").toString());
            s->synth.level1 = (float) juce::jlimit (0.0, 1.0, num (p->getProperty ("o1Lvl"), 80) / 100.0);
            s->synth.level2 = (float) juce::jlimit (0.0, 1.0, num (p->getProperty ("o2Lvl"), 0) / 100.0);
            s->synth.attack = (float) num (p->getProperty ("aA"), 0);
            s->synth.decay = (float) num (p->getProperty ("aD"), 50);
            s->synth.sustain = (float) num (p->getProperty ("aS"), 100);
            s->synth.release = (float) num (p->getProperty ("aR"), 20);
            s->synth.cutoff = (float) num (p->getProperty ("cutoff"), 100);
            s->synth.resonance = (float) num (p->getProperty ("reso"), 0);
            s->synth.transpose = (float) num (p->getProperty ("trans"), 0);
            s->synth.gate = (float) num (p->getProperty ("gate"), 75);
            s->synth.volume *= (float) juce::jlimit (0.0, 1.0, num (p->getProperty ("vol"), 70) / 100.0);
        }
        if (auto* song = e["synthSong"].getArray())
            for (auto& b : *song)
            {
                SynthBlockDef d;
                d.pattern = synthPatIdx (b["synthId"]);
                d.fill = synthPatIdx (b["fillSynthId"]);
                d.repeats = juce::jmax (1, (int) num (b["repeats"], 1));
                d.len = juce::jmax (1, (int) num (b["len"], d.pattern >= 0 ? s->synthPatterns[(size_t) d.pattern].len : 16));
                d.start = s->synthTotal;
                d.steps = (juce::int64) d.len * d.repeats;
                d.muted = (bool) b["mute"];
                if (synthSoloId.isNotEmpty() && b["id"].toString() == synthSoloId) s->synth.soloBlock = (int) s->synthSong.size();
                s->synthTotal += d.steps;
                s->synthSong.push_back (d);
            }
    }
    return s;
}

StepPos Snapshot::locate (juce::int64 n) const
{
    StepPos r;
    r.n = n;
    if (! songMode)
    {
        if (current < 0 || current >= (int) patterns.size()) return r;
        auto len = (juce::int64) patterns[(size_t) current].len;
        r.pattern = current;
        r.step = (int) floorMod (n, len);
        r.cycle = (int) floorDiv (n, len);
        r.valid = true;
        return r;
    }
    // Canzone: parte dalla battuta 1 di Logic e ricomincia alla fine. Nel pre-roll non suona.
    if (total <= 0 || n < 0) return r;
    int b = 0;
    juce::int64 o = 0;
    if (soloBlock >= 0)
    {
        b = soloBlock;
        o = n % song[(size_t) b].steps;
    }
    else
    {
        auto m = n % total;
        while (b + 1 < (int) song.size() && m >= song[(size_t) b].start + song[(size_t) b].steps) ++b;
        o = m - song[(size_t) b].start;
    }
    const auto& blk = song[(size_t) b];
    r.block = b;
    r.rep = (int) (o / blk.len);
    r.step = (int) (o % blk.len);
    r.cycle = r.rep;
    r.pattern = (r.rep == blk.repeats - 1 && blk.fill >= 0) ? blk.fill : blk.pattern;
    r.valid = true;
    return r;
}

// Poliritmi: la traccia gira sulla sua lunghezza e non si riallinea a fine pattern (stepIdx del sito).
int Snapshot::stepIdx (const PatternDef& pat, size_t track, const StepPos& p) const
{
    auto L = pat.lens[track];
    if (L > 0 && L < pat.len)
        return (int) floorMod ((juce::int64) p.cycle * pat.len + p.step, L);
    return p.step;
}

//==============================================================================
// Filtro lowpass come il BiquadFilterNode di Web Audio: la Q del lowpass e' in dB.
void Engine::Biquad::lowpass (double hz, double qDb, double rate)
{
    auto w0 = juce::MathConstants<double>::twoPi * juce::jmin (hz, rate * 0.49) / rate;
    auto alpha = std::sin (w0) / (2.0 * std::pow (10.0, qDb / 20.0));
    auto cw = std::cos (w0), a0 = 1.0 + alpha;
    b0 = (float) ((1.0 - cw) / 2.0 / a0);
    b1 = (float) ((1.0 - cw) / a0);
    b2 = b0;
    a1 = (float) (-2.0 * cw / a0);
    a2 = (float) ((1.0 - alpha) / a0);
    z1 = z2 = 0;
}

Engine::Engine()
{
    pending.reserve (4096);
    due.reserve (4096);
}

void Engine::prepare (double sampleRate)
{
    sr = sampleRate;
    reset();
}

void Engine::reset()
{
    pending.clear();
    for (auto& v : voices) v.active = false;
    for (auto& v : synthVoices) v.active = false;
    chokeOwner.fill ({ -1, 0 });
    wasPlaying = false;
}

void Engine::schedule (const Event& e)
{
    if (pending.size() < pending.capacity()) pending.push_back (e);
}

void Engine::pushHit (const VoiceParams& v, float velocity, double master, double delaySec)
{
    const auto scope = hitFifo.write (1);
    if (scope.blockSize1 + scope.blockSize2 == 0) return;
    const int i = scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2;
    hitBuf[(size_t) i] = Event { 0, v, (float) juce::jmin (1.4, v.vol * velocity * master), 0, false };
    hitDelay[i] = juce::jmax (0.0, delaySec);
}

// Uno step come in scheduler(): probabilita', blocchi, umanizza, ripetizioni e flam, nudge per traccia.
void Engine::emitStep (const Snapshot& s, const StepPos& p, double ppqStart, double ppqPerSample, int trackFilter)
{
    const double tempo = ppqPerSample * 60.0 * sr;
    const double at = s.stepPpq (p, tempo);
    const double secToPpq = s.bpm / 60.0;
    auto toClock = [&] (double ppq) { return clock + (juce::int64) std::llround ((ppq - ppqStart) / ppqPerSample); };

    if (s.metronome && p.step % 4 == 0)
    {
        Event e;
        e.time = toClock (at);
        e.gain = (float) ((p.step == 0 ? 0.18 : 0.11) * s.master);
        e.metro = p.step == 0 ? 2 : 1;
        e.sequenced = true;
        schedule (e);
    }

    if (p.pattern < 0 || p.pattern >= (int) s.patterns.size()) return;
    const auto& pat = s.patterns[(size_t) p.pattern];
    const double dur = s.stepDurPpq (p) / secToPpq;       // secondi

    for (size_t ti = 0; ti < s.tracks.size(); ++ti)
    {
        if (trackFilter >= 0 && (int) ti != trackFilter) continue;
        const auto& t = s.tracks[ti];
        if (! t.on || ti >= pat.grid.size()) continue;
        if (p.block >= 0 && p.block < (int) s.song.size())
        {
            const auto& muted = s.song[(size_t) p.block].mutedTracks;
            if (std::find (muted.begin(), muted.end(), (int) ti) != muted.end()) continue;
        }
        const int i = s.stepIdx (pat, ti, p);
        if (i < 0 || i >= pat.len) continue;
        const int v = pat.grid[ti][(size_t) i];
        if (! v) continue;
        const auto& m = pat.mods[ti][(size_t) i];
        if (m.p < 100 && rng.nextDouble() * 100.0 >= m.p) continue;

        VoiceParams vp = t.voice;            // lockedTrack()
        vp.tune += m.t;
        if (m.d > 0) vp.decay = m.d;
        if (m.c > 0) vp.cutoff = m.c;

        const double j = (rng.nextDouble() * 2 - 1) * s.human * 0.010;
        const double jv = 1 + (rng.nextDouble() * 2 - 1) * s.human * 0.15;

        auto hit = [&] (double offsetSec, double factor)
        {
            Event e;
            e.time = toClock (at + (t.nudgeSec + j + offsetSec) * secToPpq);
            e.v = vp;
            e.gain = (float) juce::jmin (1.4, vp.vol * stepVel (v) * factor * jv * s.master);
            e.sequenced = true;
            schedule (e);
        };
        if (m.f) hit (-flamSec, 0.5);
        for (int k = 0; k < m.r; ++k) hit (k * dur / m.r, k ? 0.82 : 1.0);
    }
}

void Engine::emitSynthStep (const Snapshot& s, const StepPos& p, double ppqStart, double ppqPerSample, int trackFilter)
{
    if (trackFilter >= 0 || ! s.synth.on || s.synthPatterns.empty()) return;

    int pattern = s.synth.current;
    int localStep = p.step;
    int block = -1;
    if (s.songMode)
    {
        if (s.synthTotal <= 0 || s.synthSong.empty()) return;
        juce::int64 m = p.n % s.synthTotal;
        if (s.synth.soloBlock >= 0 && s.synth.soloBlock < (int) s.synthSong.size())
        {
            block = s.synth.soloBlock;
            m = m % s.synthSong[(size_t) block].steps;
        }
        else
        {
            for (int i = 0; i < (int) s.synthSong.size(); ++i)
                if (m >= s.synthSong[(size_t) i].start && m < s.synthSong[(size_t) i].start + s.synthSong[(size_t) i].steps)
                { block = i; m -= s.synthSong[(size_t) i].start; break; }
        }
        if (block < 0) return;
        const auto& b = s.synthSong[(size_t) block];
        if (b.muted) return;
        const auto rep = (int) (m / b.len);
        localStep = (int) (m % b.len);
        pattern = (rep >= b.repeats - 1 && b.fill >= 0) ? b.fill : b.pattern;
    }
    if (pattern < 0 || pattern >= (int) s.synthPatterns.size()) return;
    const auto& pat = s.synthPatterns[(size_t) pattern];
    if (pat.len <= 0) return;
    localStep %= pat.len;

    const double tempo = ppqPerSample * 60.0 * sr;
    const double at = s.stepPpq (p, tempo);
    const double secPerPpq = 60.0 / juce::jmax (1.0, tempo);
    auto toClock = [&] (double ppq) { return clock + (juce::int64) std::llround ((ppq - ppqStart) / ppqPerSample); };

    for (const auto& n : pat.notes)
    {
        if (n.step != localStep) continue;
        double lengthPpq = 0;
        for (int k = 0; k < n.length; ++k)
            lengthPpq += s.rhythm.stepDurPpq ((localStep + k) % pat.len, s.swing);
        const auto last = s.rhythm.stepDurPpq ((localStep + n.length - 1) % pat.len, s.swing);
        const auto gate = juce::jlimit (10.0, 100.0, (double) s.synth.gate) / 100.0;
        const auto heldPpq = n.slide ? lengthPpq + juce::jmin (0.12, last * 0.5) : lengthPpq - last * (1.0 - gate);
        Event e;
        e.time = toClock (at);
        e.gain = (float) ((n.accent ? 1.0 : 0.72) * s.master * s.synth.volume);
        e.note = juce::jlimit (0, 127, n.note + (int) std::lround (s.synth.transpose));
        e.noteLengthSec = juce::jmax (0.004, heldPpq * secPerPpq);
        e.synth = true;
        e.slide = n.slide;
        e.sequenced = true;
        schedule (e);
    }
}

void Engine::startVoice (const Event& e)
{
    int idx = -1;
    for (int i = 0; i < maxVoices; ++i)
        if (! voices[(size_t) i].active) { idx = i; break; }
    if (idx < 0)                         // tutte occupate: si ruba la piu' vecchia
    {
        juce::int64 oldest = -1;
        for (int i = 0; i < maxVoices; ++i)
            if (voices[(size_t) i].age > oldest) { oldest = voices[(size_t) i].age; idx = i; }
    }
    auto& v = voices[(size_t) idx];
    v = Voice {};
    v.serial = ++serials;
    v.output = e.v.output;
    v.gain = e.gain;

    if (e.metro)
    {
        v.active = true;
        v.metro = e.metro;
        return;
    }

    const auto* s = e.v.sample;
    if (s == nullptr || s->length() < 2 || e.gain <= 0) return;

    const double rate = std::pow (2.0, e.v.tune / 12.0);
    const double offsetSec = juce::jmin (0.95, e.v.start / 100.0) * s->seconds();
    v.s = s;
    v.rev = e.v.reverse;
    v.pos = offsetSec * s->sampleRate;
    v.inc = rate * s->sampleRate / sr;

    const double avail = juce::jmax (0.01, (s->seconds() - offsetSec) / rate);
    const double dec = e.v.decay / 100.0;
    if (dec < 1.0) v.holdEnd = (juce::int64) (juce::jmax (0.005, avail * dec * dec) * sr);

    const double hz = cutoffHz (e.v.cutoff);
    v.filt = hz < 19000.0;
    if (v.filt)
        for (int ch = 0; ch < 2; ++ch)
        {
            v.f[0][ch].lowpass (hz, resoQ (e.v.reso), sr);
            v.f[1][ch].lowpass (hz, 0.7, sr);
        }

    // Choke: il colpo precedente dello stesso gruppo sfuma in 12 ms (hi-hat aperto/chiuso).
    if (e.v.choke > 0)
    {
        auto& [owner, serial] = chokeOwner[(size_t) e.v.choke];
        if (owner >= 0 && owner != idx)
        {
            auto& prev = voices[(size_t) owner];
            if (prev.active && prev.serial == serial && prev.chokeAt < 0) prev.chokeAt = prev.age;
        }
        owner = idx;
        serial = v.serial;
    }
    v.active = true;
}

void Engine::startSynthVoice (const Event& e, const Snapshot&)
{
    int idx = -1;
    for (int i = 0; i < (int) synthVoices.size(); ++i)
        if (! synthVoices[(size_t) i].active) { idx = i; break; }
    if (idx < 0)
    {
        juce::int64 oldest = -1;
        for (int i = 0; i < (int) synthVoices.size(); ++i)
            if (synthVoices[(size_t) i].age > oldest) { oldest = synthVoices[(size_t) i].age; idx = i; }
    }
    auto& v = synthVoices[(size_t) idx];
    v = SynthVoice {};
    v.active = true;
    v.pitch = v.target = e.note;
    v.gain = e.gain;
    v.velocity = e.gain > 0 ? juce::jlimit (0.0f, 1.0f, e.gain) : 0.8f;
    v.holdEnd = (juce::int64) (juce::jmax (0.004, e.noteLengthSec) * sr);
}

void Engine::render (juce::AudioBuffer<float>& out, int from, int to,
                     const std::array<juce::AudioBuffer<float>*, 16>& aux, int trackFilter)
{
    const int outCh = out.getNumChannels();
    if (outCh == 0 || to <= from) return;
    const double fade = 0.012 * sr;

    auto renderTarget = [&] (const Voice& v) -> juce::AudioBuffer<float>*
    {
        if (trackFilter >= 0) return &out;
        if (v.output <= 0) return &out;
        const auto i = v.output - 1;
        if (i >= 0 && i < (int) aux.size() && aux[(size_t) i] != nullptr
            && aux[(size_t) i]->getNumChannels() > 0)
            return aux[(size_t) i];
        return &out; // piu' di 16 righe o aux non attivo: resta udibile nel mix principale
    };

    for (auto& v : voices)
    {
        if (! v.active) continue;
        auto* target = renderTarget (v);
        const int targetCh = target->getNumChannels();
        if (targetCh == 0) continue;
        auto* L = target->getWritePointer (0);
        auto* R = targetCh > 1 ? target->getWritePointer (1) : nullptr;
        for (int i = from; i < to; ++i)
        {
            if (v.metro)
            {
                // Click a onda quadra come metronomeHit(): attacco di 2 ms, coda esponenziale fino a 55 ms.
                const double t = (double) v.age / sr;
                if (t >= 0.06) { v.active = false; break; }
                const double peak = v.gain, floor = 0.0001;
                const double env = t < 0.002 ? peak * std::pow (floor / peak, 1.0 - t / 0.002)
                                             : peak * std::pow (floor / peak, (t - 0.002) / 0.053);
                const float x = (float) ((std::fmod (v.phase, 1.0) < 0.5 ? 1.0 : -1.0) * env);
                v.phase += (v.metro == 2 ? 1320.0 : 880.0) / sr;
                L[i] += x;
                if (R) R[i] += x;
                ++v.age;
                continue;
            }

            const int len = v.s->length();
            const int ip = (int) v.pos;
            if (ip >= len - 1) { v.active = false; break; }

            double env = 1.0;
            if (v.holdEnd >= 0 && v.age >= v.holdEnd) env = 1.0 - (double) (v.age - v.holdEnd) / fade;
            if (v.chokeAt >= 0) env = juce::jmin (env, 1.0 - (double) (v.age - v.chokeAt) / fade);
            if (env <= 0.0) { v.active = false; break; }

            const auto& buf = v.rev ? v.s->rev : v.s->fwd;
            const float frac = (float) (v.pos - ip);
            const float g = (float) (v.gain * env);
            auto read = [&] (int ch) { auto* d = buf.getReadPointer (ch); return d[ip] + frac * (d[ip + 1] - d[ip]); };

            float l = read (0);
            float r = buf.getNumChannels() > 1 ? read (1) : l;
            if (v.filt)
            {
                l = v.f[1][0].run (v.f[0][0].run (l));
                r = buf.getNumChannels() > 1 ? v.f[1][1].run (v.f[0][1].run (r)) : l;
            }
            L[i] += l * g;
            if (R) R[i] += r * g;
            v.pos += v.inc;
            ++v.age;
        }
    }

    // Synth semplice nativo: la linea generata/variata dal sito deve uscire dal
    // canale di Logic, non dall'AudioContext del WebView. I parametri principali
    // restano quelli del preset del sito; gli oscillatori sono volutamente stabili
    // e leggeri per non rubare margine al motore drum.
    if (activeSynth.on)
    {
        auto* synthL = out.getWritePointer (0);
        auto* synthR = out.getNumChannels() > 1 ? out.getWritePointer (1) : nullptr;
        for (auto& v : synthVoices)
        {
            if (! v.active) continue;
            for (int i = from; i < to; ++i)
            {
                const auto age = (double) v.age / sr;
                const auto attack = 0.0005 * std::pow (20000.0, juce::jlimit (0.0f, 100.0f, activeSynth.attack) / 100.0f);
                const auto decay = 0.0005 * std::pow (20000.0, juce::jlimit (0.0f, 100.0f, activeSynth.decay) / 100.0f);
                const auto release = 0.0005 * std::pow (20000.0, juce::jlimit (0.0f, 100.0f, activeSynth.release) / 100.0f);
                const auto sustain = juce::jlimit (0.0f, 100.0f, activeSynth.sustain) / 100.0f;
                const auto hold = v.holdEnd >= 0 ? (double) v.holdEnd / sr : 1e9;
                double env = sustain;
                if (age < attack) env = attack > 0 ? age / attack : 1.0;
                else if (age < attack + decay) env = 1.0 - (1.0 - sustain) * (age - attack) / juce::jmax (0.001, decay);
                else if (age >= hold)
                {
                    const auto rel = age - hold;
                    env = sustain * std::exp (-rel / juce::jmax (0.002, release));
                    if (rel > release * 6.0) { v.active = false; break; }
                }

                const auto f1 = 440.0 * std::pow (2.0, (v.pitch - 69.0) / 12.0);
                const auto f2 = 440.0 * std::pow (2.0, (v.pitch - 69.0) / 12.0);
                auto wave = [] (int type, double p)
                {
                    if (type == 1) return p < 0.5 ? 1.0 : -1.0;
                    if (type == 2) return p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p;
                    if (type == 3) return std::sin (juce::MathConstants<double>::twoPi * p);
                    return 2.0 * p - 1.0;
                };
                const auto x1 = wave (activeSynth.wave1, v.phase1) * activeSynth.level1;
                const auto x2 = wave (activeSynth.wave2, v.phase2) * activeSynth.level2;
                const auto raw = (float) ((x1 + x2) * 0.5 * env * v.gain);
                const auto hz = 20.0 * std::pow (1000.0, juce::jlimit (0.0f, 100.0f, activeSynth.cutoff) / 100.0f);
                const auto a = (float) juce::jlimit (0.001, 1.0, 1.0 - std::exp (-juce::MathConstants<double>::twoPi * hz / sr));
                v.filter += (raw - v.filter) * a;
                synthL[i] += v.filter;
                if (synthR) synthR[i] += v.filter;
                v.phase1 += f1 / sr; if (v.phase1 >= 1.0) v.phase1 -= std::floor (v.phase1);
                v.phase2 += f2 / sr; if (v.phase2 >= 1.0) v.phase2 -= std::floor (v.phase2);
                ++v.age;
            }
        }
    }
}

void Engine::process (juce::AudioBuffer<float>& out, const juce::MidiBuffer& midi, const Snapshot* s, Transport t,
                      const std::array<juce::AudioBuffer<float>*, 16>& aux, int trackFilter)
{
    const int n = out.getNumSamples();
    out.clear();
    for (auto* a : aux) if (a != nullptr) a->clear();
    if (s != nullptr) activeSynth = s->synth;

    // colpi dal thread dei messaggi
    {
        const auto scope = hitFifo.read (hitFifo.getNumReady());
        auto take = [&] (int start, int size)
        {
            for (int i = start; i < start + size; ++i)
            {
                auto e = hitBuf[(size_t) i];
                if (trackFilter >= 0 && e.v.output != trackFilter) continue;
                e.time = clock + (juce::int64) (hitDelay[i] * sr);
                schedule (e);
            }
        };
        take (scope.startIndex1, scope.blockSize1);
        take (scope.startIndex2, scope.blockSize2);
    }

    // MIDI in ingresso: nota 36 = prima riga, 37 = seconda... (i pad dell'MPK partono da 36)
    if (s != nullptr)
        for (const auto meta : midi)
        {
            const auto msg = meta.getMessage();
            if (! msg.isNoteOn()) continue;
            const int row = msg.getNoteNumber() - 36;
            if (row < 0 || row >= (int) s->tracks.size()) continue;
            if (trackFilter >= 0 && row != trackFilter) continue;
            Event e;
            e.time = clock + meta.samplePosition;
            e.v = s->tracks[(size_t) row].voice;
            e.gain = (float) juce::jmin (1.4, e.v.vol * msg.getFloatVelocity() * s->master);
            schedule (e);
        }

    // Sequencer agganciato al PPQ dell'host
    auto dropSequenced = [&] { pending.erase (std::remove_if (pending.begin(), pending.end(), [] (const Event& e) { return e.sequenced; }), pending.end()); };
    if (s != nullptr && t.playing && t.bpm > 0)
    {
        const double pps = t.bpm / 60.0 / sr;
        if (! wasPlaying || std::abs (t.ppq - expectedPpq) > 4 * pps + 1e-6)
        {
            // partenza o salto (ciclo di Logic, click sul righello): si riparte dallo step che cade qui
            dropSequenced();
            nextN = (juce::int64) std::floor (t.ppq / s->rhythm.basePpq());
            if (s->stepPpq (s->locate (nextN), t.bpm) < t.ppq - 1e-9) ++nextN;
        }
        const double horizon = t.ppq + n * pps + lookaheadSec * t.bpm / 60.0;
        for (int guard = 0; guard < 512; ++guard)
        {
            const auto pos = s->locate (nextN);
            const double at = pos.valid ? s->stepPpq (pos, t.bpm) : (double) nextN * s->rhythm.basePpq();
            if (at >= horizon) break;
            if (pos.valid) emitStep (*s, pos, t.ppq, pps, trackFilter);
            if (pos.valid) emitSynthStep (*s, pos, t.ppq, pps, trackFilter);
            ++nextN;
        }
        expectedPpq = t.ppq + n * pps;
        wasPlaying = true;
    }
    else if (wasPlaying)
    {
        dropSequenced();
        wasPlaying = false;
    }

    // Colpi di questo blocco in ordine di tempo, audio renderizzato fra un colpo e l'altro
    due.clear();
    const auto end = clock + n;
    for (size_t i = 0; i < pending.size();)
    {
        if (pending[i].time < end)
        {
            due.push_back (pending[i]);
            pending[i] = pending.back();
            pending.pop_back();
        }
        else ++i;
    }
    std::sort (due.begin(), due.end(), [] (const Event& a, const Event& b) { return a.time < b.time; });

    int cursor = 0;
    for (const auto& e : due)
    {
        const int at = (int) juce::jlimit<juce::int64> (0, n - 1, e.time - clock);
        render (out, cursor, at, aux, trackFilter);
        cursor = at;
        if (e.synth && s != nullptr) startSynthVoice (e, *s);
        else startVoice (e);
    }
    render (out, cursor, n, aux, trackFilter);
    clock = end;
}

} // namespace pm
