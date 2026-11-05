#include "PluginEditor.h"
#include <regex>
#include <set>
#include <sys/stat.h>

// Stesse cartelle dell'app per Mac: i progetti salvati si aprono sia nell'app sia nel plug-in.
static juce::File homeDir() { return juce::File::getSpecialLocation (juce::File::userMusicDirectory).getChildFile ("PatternMachine"); }
static juce::File projectsDir() { return homeDir().getChildFile ("Progetti"); }
static juce::File exportDir() { return homeDir().getChildFile ("Export"); }
static constexpr const char* patternMachineServer = "https://patternmachine.tongatron.org";

struct PatternMachineEditor::Account
{
    juce::String name, uid, cookie;
};

struct HttpResult
{
    int status = 0;
    juce::String body, cookie;
};

static juce::File accountFile()
{
    return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
        .getChildFile ("PatternMachine").getChildFile ("plugin-account.json");
}

static juce::String formPart (const juce::String& value)
{
    return juce::URL::addEscapeChars (value, true).replace ("%20", "+");
}

static juce::String headerValue (const juce::StringPairArray& headers, const juce::String& wanted)
{
    for (const auto& key : headers.getAllKeys())
        if (key.equalsIgnoreCase (wanted)) return headers[key];
    return {};
}

static juce::String sessionCookie (const juce::StringPairArray& headers)
{
    auto all = headerValue (headers, "Set-Cookie");
    for (auto line : juce::StringArray::fromLines (all))
    {
        line = line.trim();
        const auto end = line.indexOfChar (';');
        const auto first = end >= 0 ? line.substring (0, end) : line;
        if (first.startsWith ("sp1200_session=") && first.length() > 16) return first;
    }
    return {};
}

static HttpResult httpRequest (const juce::String& path, const juce::String& method,
                               const juce::String& body = {}, const juce::String& cookie = {},
                               const juce::String& contentType = {})
{
    auto url = juce::URL (juce::String (patternMachineServer) + path);
    if (body.isNotEmpty()) url = url.withPOSTData (body);

    juce::String headers = "Accept: application/json\r\n";
    if (cookie.isNotEmpty()) headers << "Cookie: " << cookie << "\r\n";
    if (contentType.isNotEmpty()) headers << "Content-Type: " << contentType << "\r\n";

    int status = 0;
    juce::StringPairArray responseHeaders;
    auto options = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
        .withHttpRequestCmd (method)
        .withExtraHeaders (headers)
        .withConnectionTimeoutMs (20000)
        .withNumRedirectsToFollow (0)
        .withStatusCode (&status)
        .withResponseHeaders (&responseHeaders);
    auto stream = url.createInputStream (options);
    HttpResult result;
    result.status = status;
    result.cookie = sessionCookie (responseHeaders);
    if (stream != nullptr) result.body = stream->readEntireStreamAsString();
    return result;
}

static juce::var jsonObject (const juce::String& text)
{
    auto value = juce::JSON::parse (text);
    return value.isObject() ? value : juce::var();
}

static juce::String jsonError (const juce::String& fallback, const HttpResult& response)
{
    if (auto value = jsonObject (response.body); value.isObject())
        if (value["error"].toString().isNotEmpty()) return value["error"].toString();
    return fallback + " (HTTP " + juce::String (response.status) + ")";
}

static juce::File localProjectFile (const juce::String& id)
{
    auto safe = id.retainCharacters ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-").substring (0, 80);
    return safe.isEmpty() ? juce::File() : projectsDir().getChildFile (safe + ".json");
}

static bool writeLocalProject (const juce::String& id, const juce::var& data)
{
    auto file = localProjectFile (id);
    return file != juce::File() && file.replaceWithText (juce::JSON::toString (data));
}

class NetworkJob final : public juce::ThreadPoolJob
{
public:
    explicit NetworkJob (std::function<void()> f) : ThreadPoolJob ("PatternMachine network"), work (std::move (f)) {}
    JobStatus runJob() override { work(); return jobHasFinished; }
private:
    std::function<void()> work;
};

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

// Il plug-in viene aperto grande quanto l'area utile dello schermo. Logic aggiunge
// la propria barra del plug-in sopra l'editor, quindi lasciamo un margine verticale
// per non far uscire la finestra dal display. La dimensione resta poi ridimensionabile
// e viene salvata nel progetto come prima.
static juce::Point<int> defaultEditorSize()
{
    if (const auto* display = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay())
    {
        const auto area = display->userBounds.toNearestInt();
        return { juce::jmax (720, area.getWidth() - 32),
                 juce::jmax (480, area.getHeight() - 72) };
    }

    return { 1440, 900 };
}

PatternMachineEditor::PatternMachineEditor (PatternMachineProcessor& p)
    : AudioProcessorEditor (p), proc (p),
      web (juce::WebBrowserComponent::Options {}
               .withNativeIntegrationEnabled()
               .withKeepPageLoadedWhenBrowserIsHidden()
               .withResourceProvider ([this] (const auto& url) { return serve (url); })
               .withEventListener ("pm", [this] (const juce::var& msg) { onMessage (msg); })),
      account (std::make_unique<Account>())
{
    if (auto saved = jsonObject (accountFile().loadFileAsString()); saved.isObject())
    {
        account->name = saved["name"].toString();
        account->uid = saved["uid"].toString();
        account->cookie = saved["cookie"].toString();
        if (! account->cookie.startsWith ("sp1200_session=")) *account = Account {};
    }
    addAndMakeVisible (web);
    setResizable (true, true);
    setResizeLimits (720, 480, 4000, 3000);
    // 1280×860 era il default precedente; anche i progetti già salvati con una
    // finestra piccola vengono promossi una volta alla dimensione a tutto schermo.
    const bool legacySize = proc.editorW < 1100 || proc.editorH < 680
                         || (proc.editorW == 1280 && proc.editorH == 860);
    const auto full = defaultEditorSize();
    setSize (legacySize ? full.x : proc.editorW,
             legacySize ? full.y : proc.editorH);
    web.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    startTimerHz (30);
}

PatternMachineEditor::~PatternMachineEditor()
{
    stopTimer();
    networkJobs.removeAllJobs (true, 20000);
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

juce::var PatternMachineEditor::accountStatus() const
{
    const juce::ScopedLock sl (accountLock);
    auto o = std::make_unique<juce::DynamicObject>();
    o->setProperty ("signedIn", account != nullptr && account->cookie.isNotEmpty());
    o->setProperty ("name", account != nullptr ? account->name : juce::String());
    o->setProperty ("state", account != nullptr && account->cookie.isNotEmpty() ? "signed-in" : "signed-out");
    return juce::var (o.release());
}

void PatternMachineEditor::accountLoginAsync (const juce::var& req, juce::String name, juce::String password)
{
    juce::Component::SafePointer<PatternMachineEditor> safe (this);
    networkJobs.addJob (new NetworkJob ([safe, req, name, password]
    {
        auto loginResult = std::make_unique<juce::DynamicObject>();
        loginResult->setProperty ("ok", false);
        if (name.trim().isEmpty() || password.isEmpty())
        {
            loginResult->setProperty ("error", "Enter your name or email and password.");
        }
        else
        {
            const auto form = "name=" + formPart (name.trim()) + "&password=" + formPart (password) + "&next=%2F";
            const auto login = httpRequest ("/login", "POST", form, {}, "application/x-www-form-urlencoded");
            const auto cookie = login.cookie;
            if (login.status != 303 || cookie.isEmpty())
                loginResult->setProperty ("error", login.status == 429 ? "Too many attempts: try again later."
                                                                         : "Wrong name, email or password.");
            else
            {
                const auto meResponse = httpRequest ("/api/me", "GET", {}, cookie);
                const auto me = jsonObject (meResponse.body);
                if (meResponse.status != 200 || ! me.isObject() || me["id"].toString().isEmpty()
                    || me["role"].toString() == "guest")
                    loginResult->setProperty ("error", "This account cannot save projects.");
                else
                {
                    loginResult->setProperty ("ok", true);
                    loginResult->setProperty ("name", me["name"].toString());
                    loginResult->setProperty ("uid", me["id"].toString());
                    loginResult->setProperty ("cookie", cookie);
                }
            }
        }

        juce::MessageManager::callAsync ([safe, req, result = juce::var (loginResult.release())]() mutable
        {
            if (safe == nullptr) return;
            if ((bool) result["ok"])
            {
                const juce::ScopedLock sl (safe->accountLock);
                safe->account->name = result["name"].toString();
                safe->account->uid = result["uid"].toString();
                safe->account->cookie = result["cookie"].toString();
                auto file = accountFile();
                file.getParentDirectory().createDirectory();
                auto saved = std::make_unique<juce::DynamicObject>();
                saved->setProperty ("name", safe->account->name);
                saved->setProperty ("uid", safe->account->uid);
                saved->setProperty ("cookie", safe->account->cookie);
                file.replaceWithText (juce::JSON::toString (juce::var (saved.release())));
                ::chmod (file.getFullPathName().toRawUTF8(), 0600);
            }
            safe->reply (req, result);
        });
    }), true);
}

void PatternMachineEditor::accountSyncAsync (const juce::var& req)
{
    juce::String cookie;
    {
        const juce::ScopedLock sl (accountLock);
        if (account != nullptr) cookie = account->cookie;
    }
    juce::Component::SafePointer<PatternMachineEditor> safe (this);
    networkJobs.addJob (new NetworkJob ([safe, req, cookie]
    {
        auto syncResult = std::make_unique<juce::DynamicObject>();
        syncResult->setProperty ("ok", false);
        if (cookie.isEmpty())
            syncResult->setProperty ("error", "Sign in to sync projects.");
        else
        {
            const auto listResponse = httpRequest ("/api/projects", "GET", {}, cookie);
            const auto list = jsonObject (listResponse.body);
            if (listResponse.status == 401 || listResponse.status == 303)
                syncResult->setProperty ("expired", true);
            else if (listResponse.status != 200 || ! list.isObject())
                syncResult->setProperty ("error", jsonError ("Could not reach the PatternMachine server", listResponse));
            else
            {
                std::map<juce::String, juce::String> remote;
                if (auto* rows = list["projects"].getArray())
                    for (const auto& row : *rows)
                        if (! (bool) row["deleted"])
                            remote[row["id"].toString()] = row["rev"].toString();

                projectsDir().createDirectory();
                std::set<juce::String> seen;
                int uploaded = 0, downloaded = 0;
                for (const auto& file : projectsDir().findChildFiles (juce::File::findFiles, false, "*.json"))
                {
                    const auto id = file.getFileNameWithoutExtension();
                    const auto data = jsonObject (file.loadFileAsString());
                    if (! data.isObject()) continue;
                    seen.insert (id);
                    auto remoteIt = remote.find (id);
                    if (remoteIt == remote.end())
                    {
                        auto body = std::make_unique<juce::DynamicObject>();
                        body->setProperty ("data", data);
                        body->setProperty ("base", juce::var());
                        const auto saved = httpRequest ("/api/projects/" + id, "PUT",
                                                        juce::JSON::toString (juce::var (body.release())), cookie,
                                                        "application/json");
                        if (saved.status == 401 || saved.status == 303) { syncResult->setProperty ("expired", true); break; }
                        if (saved.status >= 200 && saved.status < 300) ++uploaded;
                        continue;
                    }

                    const auto detail = httpRequest ("/api/projects/" + id, "GET", {}, cookie);
                    const auto remoteData = jsonObject (detail.body);
                    if (detail.status == 401 || detail.status == 303) { syncResult->setProperty ("expired", true); break; }
                    if (detail.status != 200 || ! remoteData.isObject()) continue;
                    const auto localAt = (double) data["updatedAt"];
                    const auto serverData = remoteData["data"];
                    const auto remoteAt = (double) serverData["updatedAt"];
                    if (localAt >= remoteAt)
                    {
                        auto body = std::make_unique<juce::DynamicObject>();
                        body->setProperty ("data", data);
                        body->setProperty ("base", remoteData["rev"].toString());
                        const auto saved = httpRequest ("/api/projects/" + id, "PUT",
                                                        juce::JSON::toString (juce::var (body.release())), cookie,
                                                        "application/json");
                        if (saved.status == 401 || saved.status == 303) { syncResult->setProperty ("expired", true); break; }
                        if (saved.status >= 200 && saved.status < 300) ++uploaded;
                    }
                    else if (writeLocalProject (id, serverData)) ++downloaded;
                }

                if (! (bool) syncResult->getProperty ("expired"))
                    for (const auto& [id, rev] : remote)
                        if (! seen.count (id))
                        {
                            const auto detail = httpRequest ("/api/projects/" + id, "GET", {}, cookie);
                            const auto remoteData = jsonObject (detail.body);
                            if (detail.status == 401 || detail.status == 303) { syncResult->setProperty ("expired", true); break; }
                            if (detail.status == 200 && remoteData.isObject() && writeLocalProject (id, remoteData["data"])) ++downloaded;
                        }

                if (! (bool) syncResult->getProperty ("expired"))
                {
                    syncResult->setProperty ("ok", true);
                    syncResult->setProperty ("uploaded", uploaded);
                    syncResult->setProperty ("downloaded", downloaded);
                }
            }
        }

        juce::MessageManager::callAsync ([safe, req, result = juce::var (syncResult.release())]() mutable
        {
            if (safe == nullptr) return;
            if ((bool) result["expired"])
            {
                const juce::ScopedLock sl (safe->accountLock);
                safe->account = std::make_unique<Account>();
                accountFile().deleteFile();
            }
            safe->reply (req, result);
        });
    }), true);
}

void PatternMachineEditor::accountLogout()
{
    const juce::ScopedLock sl (accountLock);
    account = std::make_unique<Account>();
    accountFile().deleteFile();
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
        o->setProperty ("account", accountStatus());
        send (juce::var (o.release()));
        lastPos = {};
    }
    else if (type == "sync")      proc.setProject (msg["state"], msg["engine"]);
    else if (type == "hit")       proc.hit (msg["voice"], (double) msg["vel"], (double) msg["delay"]);
    else if (type == "transport") proc.setInternalPlay ((bool) msg["play"], (double) msg["start"]);
    else if (type == "instance-track") proc.setInstanceTrack ((int) msg["track"]);
    else if (type == "account-login") accountLoginAsync (msg["req"], msg["name"].toString(), msg["password"].toString());
    else if (type == "account-sync") accountSyncAsync (msg["req"]);
    else if (type == "account-logout") { accountLogout(); reply (msg["req"], accountStatus()); }
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
    const double stepSec = p.stepSec;
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
    o->setProperty ("frac", p.frac);
    o->setProperty ("stepSec", stepSec);
    send (juce::var (o.release()));
}
