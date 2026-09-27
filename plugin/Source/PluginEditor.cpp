#include "PluginEditor.h"
#include <regex>

// Stesse cartelle dell'app per Mac: i progetti salvati si aprono sia nell'app sia nel plug-in.
static juce::File homeDir() { return juce::File::getSpecialLocation (juce::File::userMusicDirectory).getChildFile ("PatternMachine"); }
static juce::File projectsDir() { return homeDir().getChildFile ("Progetti"); }
static juce::File exportDir() { return homeDir().getChildFile ("Export"); }

static juce::String mimeFor (const juce::File& f)
{
    static const std::map<juce::String, juce::String> types {
        { "html", "text/html; charset=utf-8" }, { "js", "text/javascript; charset=utf-8" },
        { "css", "text/css; charset=utf-8" },   { "json", "application/json" },
        { "wav", "audio/wav" },  { "mp3", "audio/mpeg" }, { "png", "image/png" },
        { "jpg", "image/jpeg" }, { "svg", "image/svg+xml" }, { "ico", "image/x-icon" },
        { "woff2", "font/woff2" }, { "webmanifest", "application/manifest+json" }, { "txt", "text/plain" } };
    auto it = types.find (f.getFileExtension().substring (1).toLowerCase());
    return it != types.end() ? it->second : "application/octet-stream";
}

static juce::String safeId (const juce::String& s)
{
    return s.retainCharacters ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-").substring (0, 80);
}

PatternMachineEditor::PatternMachineEditor (PatternMachineProcessor& p)
    : AudioProcessorEditor (p), proc (p),
      web (juce::WebBrowserComponent::Options {}
               .withNativeIntegrationEnabled()
               .withKeepPageLoadedWhenBrowserIsHidden()
               .withResourceProvider ([this] (const auto& url) { return serve (url); })
               .withEventListener ("pm", [this] (const juce::var& msg) { onMessage (msg); }))
{
    addAndMakeVisible (web);
    setResizable (true, true);
    setResizeLimits (720, 480, 4000, 3000);
    setSize (proc.editorW, proc.editorH);
    web.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    startTimerHz (30);
}

PatternMachineEditor::~PatternMachineEditor()
{
    stopTimer();
    proc.setInternalPlay (false, 0);   // chiudere la finestra ferma l'anteprima (Logic non la sente)
}

void PatternMachineEditor::resized()
{
    web.setBounds (getLocalBounds());
    proc.editorW = getWidth();
    proc.editorH = getHeight();
}

//==============================================================================
// Il sito servito dal bundle. index.html riceve in fondo il ponte del plug-in e perde le statistiche.
std::optional<juce::WebBrowserComponent::Resource> PatternMachineEditor::serve (const juce::String& url)
{
    auto path = juce::URL::removeEscapeChars (url.upToFirstOccurrenceOf ("?", false, false)
                                                 .upToFirstOccurrenceOf ("#", false, false)).trimCharactersAtStart ("/");
    if (path.isEmpty()) path = "index.html";
    if (path.contains ("..")) return std::nullopt;

    const bool bridge = path.startsWith ("__plugin/");
    const auto root = bridge ? proc.bridgeDir() : proc.siteDir();
    const auto file = root.getChildFile (bridge ? path.fromFirstOccurrenceOf ("__plugin/", false, false) : path);
    if (! file.existsAsFile() || ! file.isAChildOf (root)) return std::nullopt;

    juce::MemoryBlock mb;
    if (path == "index.html")
    {
        auto html = file.loadFileAsString().toStdString();
        html = std::regex_replace (html, std::regex (R"(<script[^>]*analytics\.tongatron\.org[^>]*></script>\n?)"), "");
        auto at = html.rfind ("</body>");
        if (at != std::string::npos)
            html.insert (at, "<link rel=\"stylesheet\" href=\"/__plugin/plugin-bridge.css\">\n"
                             "<script src=\"/__plugin/plugin-bridge.js\"></script>\n");
        mb.append (html.data(), html.size());
    }
    else if (! file.loadFileAsData (mb))
        return std::nullopt;

    juce::WebBrowserComponent::Resource r;
    r.data.resize (mb.getSize());
    std::memcpy (r.data.data(), mb.getData(), mb.getSize());
    r.mimeType = mimeFor (file);
    return r;
}

//==============================================================================
void PatternMachineEditor::send (const juce::var& msg)
{
    web.emitEventIfBrowserIsVisible ("pm", msg);
}

void PatternMachineEditor::reply (const juce::var& req, const juce::var& result, const juce::String& error)
{
    auto o = std::make_unique<juce::DynamicObject>();
    o->setProperty ("type", "reply");
    o->setProperty ("req", req);
    o->setProperty ("result", result);
    if (error.isNotEmpty()) o->setProperty ("error", error);
    send (juce::var (o.release()));
}

void PatternMachineEditor::stateRestored()
{
    if (! pageReady) return;
    auto o = std::make_unique<juce::DynamicObject>();
    o->setProperty ("type", "load");
    o->setProperty ("state", proc.getSavedState());
    send (juce::var (o.release()));
}

void PatternMachineEditor::onMessage (const juce::var& msg)
{
    const auto type = msg["type"].toString();

    if (type == "hello")
    {
        pageReady = true;
        auto o = std::make_unique<juce::DynamicObject>();
        o->setProperty ("type", "init");
        o->setProperty ("state", proc.getSavedState());
        o->setProperty ("version", JucePlugin_VersionString);
        o->setProperty ("host", juce::PluginHostType().getHostDescription());
        o->setProperty ("instanceTrack", proc.getInstanceTrack());
        send (juce::var (o.release()));
        lastPos = {};
    }
    else if (type == "sync")      proc.setProject (msg["state"], msg["engine"]);
    else if (type == "hit")       proc.hit (msg["voice"], (double) msg["vel"], (double) msg["delay"]);
    else if (type == "transport") proc.setInternalPlay ((bool) msg["play"], (double) msg["start"]);
    else if (type == "instance-track") proc.setInstanceTrack ((int) msg["track"]);
    else if (type == "projects")
    {
        try { reply (msg["req"], projects (msg)); }
        catch (const std::exception& e) { reply (msg["req"], {}, e.what()); }
    }
    else if (type == "export")
    {
        try { reply (msg["req"], exportFile (msg)); }
        catch (const std::exception& e) { reply (msg["req"], {}, e.what()); }
    }
    else if (type == "reveal")
    {
        exportDir().createDirectory();
        auto last = exportDir().getChildFile (msg["name"].toString());
        (last.existsAsFile() && last.isAChildOf (exportDir()) ? last : exportDir()).revealToUser();
    }
}

// Progetti come file JSON in ~/Music/PatternMachine/Progetti, gli stessi dell'app per Mac.
juce::var PatternMachineEditor::projects (const juce::var& msg)
{
    const auto op = msg["op"].toString();
    projectsDir().createDirectory();
    auto fileOf = [] (const juce::var& id)
    {
        auto s = safeId (id.toString());
        if (s.isEmpty()) throw std::runtime_error ("progetto non valido");
        return projectsDir().getChildFile (s + ".json");
    };

    if (op == "list")
    {
        juce::Array<juce::var> list;
        for (const auto& f : projectsDir().findChildFiles (juce::File::findFiles, false, "*.json"))
        {
            auto data = juce::JSON::parse (f);
            if (! data.isObject()) continue;
            auto o = std::make_unique<juce::DynamicObject>();
            o->setProperty ("id", f.getFileNameWithoutExtension());
            o->setProperty ("data", data);
            list.add (juce::var (o.release()));
        }
        return list;
    }
    if (op == "get")
    {
        auto f = fileOf (msg["id"]);
        return f.existsAsFile() ? juce::JSON::parse (f) : juce::var();
    }
    if (op == "set")
    {
        if (! fileOf (msg["id"]).replaceWithText (juce::JSON::toString (msg["data"])))
            throw std::runtime_error ("salvataggio non riuscito");
        return true;
    }
    if (op == "delete")
    {
        auto f = fileOf (msg["id"]);
        if (f.existsAsFile() && ! f.moveToTrash()) throw std::runtime_error ("rimozione non riuscita");
        return true;
    }
    throw std::runtime_error ("operazione sconosciuta");
}

// Esportazioni (MIDI, WAV, MP3, pacchetto Logic) in ~/Music/PatternMachine/Export.
juce::var PatternMachineEditor::exportFile (const juce::var& msg)
{
    auto name = juce::File::createLegalFileName (msg["filename"].toString());
    if (name.isEmpty()) name = "PatternMachine";
    juce::MemoryOutputStream data;
    if (! juce::Base64::convertFromBase64 (data, msg["base64"].toString()))
        throw std::runtime_error ("dati non validi");
    exportDir().createDirectory();
    auto file = exportDir().getNonexistentChildFile (juce::File (name).getFileNameWithoutExtension(),
                                                     juce::File (name).getFileExtension(), false);
    if (! file.replaceWithData (data.getData(), data.getDataSize()))
        throw std::runtime_error ("scrittura non riuscita");
    return file.getFileName();
}

//==============================================================================
// Posizione del trasporto per la pagina: testina, contatore, BPM di Logic.
void PatternMachineEditor::timerCallback()
{
    if (! pageReady) return;
    const auto p = proc.getPosition();
    const double stepSec = 60.0 / juce::jmax (1.0, p.bpm) / 4.0;
    const auto key = juce::String ((int) p.playing) + ":" + juce::String ((int) p.hostPlaying) + juce::String ((int) p.hostTempo) + ":"
                   + juce::String (p.bpm, 3) + ":" + juce::String (p.pos.n) + ":" + juce::String (p.pos.pattern);
    if (key == lastPos && ! p.playing) return;
    lastPos = key;

    auto o = std::make_unique<juce::DynamicObject>();
    o->setProperty ("type", "pos");
    o->setProperty ("playing", p.playing);
    o->setProperty ("host", p.hostPlaying);
    o->setProperty ("bpm", p.bpm);
    o->setProperty ("hostTempo", p.hostTempo);
    o->setProperty ("ppq", p.ppq);
    o->setProperty ("valid", p.pos.valid);
    o->setProperty ("n", (double) p.pos.n);
    o->setProperty ("step", p.pos.step);
    o->setProperty ("cycle", p.pos.cycle);
    o->setProperty ("rep", p.pos.rep);
    o->setProperty ("pattern", p.pos.pattern);
    o->setProperty ("block", p.pos.block);
    // frazione dello step gia' suonata, per far scorrere la testina della timeline
    o->setProperty ("frac", juce::jlimit (0.0, 1.0, p.ppq * 4.0 - std::floor (p.ppq * 4.0)));
    o->setProperty ("stepSec", stepSec);
    send (juce::var (o.release()));
}
