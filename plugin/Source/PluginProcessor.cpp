#include "PluginProcessor.h"
#include "PluginEditor.h"

// Cartella del sito: quella copiata nel bundle (Contents/Resources/site) oppure, per le prove,
// PM_SITE_DIR.
static juce::File findResources (const char* name)
{
    auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
    auto inBundle = exe.getParentDirectory().getParentDirectory().getChildFile ("Resources").getChildFile (name);
    if (juce::String (name) == "site")
        if (auto env = juce::SystemStats::getEnvironmentVariable ("PM_SITE_DIR", {}); env.isNotEmpty())
            return juce::File (env);
    return inBundle;
}

PatternMachineProcessor::PatternMachineProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      samples (findResources ("site"))
{
}

PatternMachineProcessor::~PatternMachineProcessor() = default;

juce::File PatternMachineProcessor::bridgeDir() const { return findResources ("bridge"); }

bool PatternMachineProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void PatternMachineProcessor::prepareToPlay (double sampleRate, int)
{
    engine.prepare (sampleRate);
}

void PatternMachineProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const auto* snap = latest.load();
    inUse.store (snap);

    pm::Engine::Transport t;
    bool hostPlaying = false, hostTempo = false;
    double hostBpm = snap != nullptr ? snap->bpm : 120.0;

    if (auto* head = getPlayHead())
        if (auto info = head->getPosition())
        {
            if (auto b = info->getBpm()) { hostBpm = *b; hostTempo = true; }
            if (info->getIsPlaying())
                if (auto ppq = info->getPpqPosition())
                {
                    hostPlaying = true;
                    t = { true, *ppq, hostBpm };
                }
        }

    const double sr = getSampleRate() > 0 ? getSampleRate() : 44100.0;
    if (hostPlaying)
    {
        internalPlay = false;          // Logic parte: il trasporto interno si ferma
    }
    else if (internalPlay.load())
    {
        if (auto r = internalRestart.load(); r != internalSeen)
        {
            internalSeen = r;
            internalPpq = internalStart.load();
        }
        t = { true, internalPpq, hostBpm };
        internalPpq += buffer.getNumSamples() * hostBpm / 60.0 / sr;
    }

    engine.process (buffer, midi, snap, t);
    buffer.applyGain (outputGain);
    midi.clear();

    posPlaying = t.playing;
    posHost = hostPlaying;
    posHostPlaying = hostPlaying;
    posHostTempo = hostTempo;
    posPpq = t.playing ? t.ppq : 0.0;
    posBpm = hostBpm;
}

//==============================================================================
void PatternMachineProcessor::installSnapshot (std::unique_ptr<pm::Snapshot> s)
{
    const auto now = juce::Time::getMillisecondCounter();
    for (auto& [snap, retiredAt] : owned)
        if (snap.get() == latest.load() && retiredAt == 0) retiredAt = juce::jmax (1u, now);
    latest.store (s.get());
    owned.emplace_back (std::move (s), 0);
    collectGarbage();
}

void PatternMachineProcessor::collectGarbage()
{
    const auto now = juce::Time::getMillisecondCounter();
    const auto* used = inUse.load();
    owned.erase (std::remove_if (owned.begin(), owned.end(), [&] (auto& e)
    {
        return e.second != 0 && e.first.get() != used && e.first.get() != latest.load() && now - e.second > 2000;
    }), owned.end());
}

void PatternMachineProcessor::setProject (const juce::var& state, const juce::var& engineVar)
{
    auto newState = juce::JSON::toString (state, true);
    auto newEngine = juce::JSON::toString (engineVar, true);
    bool changed = false;
    {
        const juce::ScopedLock sl (stateLock);
        changed = newState != stateJson;
        stateJson = newState;
        engineJson = newEngine;
    }
    installSnapshot (pm::Snapshot::fromVar (engineVar, samples));
    if (changed)       // Logic segna il progetto come modificato
        updateHostDisplay (ChangeDetails().withNonParameterStateChanged (true));
}

juce::var PatternMachineProcessor::getSavedState() const
{
    const juce::ScopedLock sl (stateLock);
    return stateJson.isEmpty() ? juce::var() : juce::JSON::parse (stateJson);
}

void PatternMachineProcessor::hit (const juce::var& v, double velocity, double delaySec)
{
    pm::VoiceParams p;
    p.sample = samples.get (v["file"].toString());
    if (p.sample == nullptr) return;
    auto num = [] (const juce::var& x, double def) { return x.isVoid() ? def : (double) x; };
    p.vol = (float) num (v["vol"], 0.8);
    p.tune = num (v["tune"], 0);
    p.decay = (float) num (v["decay"], 100);
    p.cutoff = (float) num (v["cutoff"], 100);
    p.reso = (float) num (v["reso"], 0);
    p.start = (float) num (v["start"], 0);
    p.reverse = (bool) v["reverse"];
    p.choke = juce::jlimit (0, 16, (int) num (v["choke"], 0));
    engine.pushHit (p, (float) velocity, num (v["master"], 85) / 100.0, delaySec);
}

void PatternMachineProcessor::setInternalPlay (bool play, double startStep)
{
    if (play)
    {
        internalStart = startStep * 0.25;
        ++internalRestart;
    }
    internalPlay = play;
}

PatternMachineProcessor::Position PatternMachineProcessor::getPosition() const
{
    Position p;
    p.playing = posPlaying;
    p.host = posHost;
    p.hostPlaying = posHostPlaying;
    p.hostTempo = posHostTempo;
    p.ppq = posPpq;
    p.bpm = posBpm;
    if (const auto* s = latest.load(); s != nullptr && p.playing)
    {
        // lo step che sta suonando adesso (con lo swing lo step dispari parte in ritardo)
        auto n = (juce::int64) std::floor (p.ppq * 4.0);
        auto pos = s->locate (n);
        if (pos.valid && s->stepPpq (pos) > p.ppq) pos = s->locate (n - 1);
        p.pos = pos;
    }
    return p;
}

//==============================================================================
void PatternMachineProcessor::getStateInformation (juce::MemoryBlock& dest)
{
    auto obj = std::make_unique<juce::DynamicObject>();
    {
        const juce::ScopedLock sl (stateLock);
        obj->setProperty ("format", 1);
        obj->setProperty ("state", stateJson);
        obj->setProperty ("engine", engineJson);
    }
    obj->setProperty ("w", editorW);
    obj->setProperty ("h", editorH);
    juce::MemoryOutputStream out (dest, false);
    out.writeString (juce::JSON::toString (juce::var (obj.release()), true));
}

void PatternMachineProcessor::setStateInformation (const void* data, int size)
{
    juce::MemoryInputStream in (data, (size_t) size, false);
    auto root = juce::JSON::parse (in.readString());
    if (! root.isObject()) return;
    editorW = juce::jlimit (720, 4000, (int) root.getProperty ("w", editorW));
    editorH = juce::jlimit (480, 3000, (int) root.getProperty ("h", editorH));
    auto st = root["state"].toString(), en = root["engine"].toString();
    {
        const juce::ScopedLock sl (stateLock);
        stateJson = st;
        engineJson = en;
    }
    // Il progetto suona anche senza aprire la finestra del plug-in.
    auto install = [this, en]
    {
        if (auto e = juce::JSON::parse (en); e.isObject()) installSnapshot (pm::Snapshot::fromVar (e, samples));
        if (auto* ed = dynamic_cast<PatternMachineEditor*> (getActiveEditor())) ed->stateRestored();
    };
    if (juce::MessageManager::getInstance()->isThisTheMessageThread()) install();
    else juce::MessageManager::callAsync ([safe = juce::WeakReference<PatternMachineProcessor> (this), install]
    {
        if (safe != nullptr) install();
    });
}

juce::AudioProcessorEditor* PatternMachineProcessor::createEditor()
{
    return new PatternMachineEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PatternMachineProcessor();
}
