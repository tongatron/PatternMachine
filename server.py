#!/usr/bin/env python3
import hashlib
import hmac
import html
import json
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "patterns.json")
AUTH_FILE = os.environ.get("DRUMMACHINE_AUTH", os.path.join(ROOT, "auth.json"))
LOCK = threading.Lock()

PATTERN_ID_RE = re.compile(r"^/api/patterns/([A-Za-z0-9\-]+)$")

# Si serve solo cio' che fa parte del sito: server.py, auth.json, data/ e qualunque altro
# file lasciato nella cartella (backup, appunti) restano fuori.
STATIC_FILES = {"index.html", "toolkit.html", "funzioni.html", "manifest.json", "sw.js"}
STATIC_DIRS = ("engine/", "icons/", "samples/", "samples12/", "machines/", "assets/")

# Visibili senza password: servono al browser per installare la PWA e alle anteprime dei link.
OPEN_PATHS = {"/login", "/logout", "/manifest.json", "/assets/og-sp1200.png", "/assets/og-drum-machine-lab.jpg"}
OPEN_DIRS = ("/icons/",)

# Dietro la password niente cache condivise (Cloudflare): "private" tiene la copia solo nel
# browser. HTML, service worker e motore vanno sempre riconvalidati.
NO_CACHE_EXT = (".html", ".js", ".json")
LONG_CACHE = "private, max-age=604800"

MAX_BODY = 256 * 1024
MAX_NAME = 120
MAX_TEXT = 100 * 1024
MAX_PATTERNS = 1000

SESSION_COOKIE = "sp1200_session"
SESSION_DAYS = 30
LOGIN_WINDOW = 15 * 60       # secondi
LOGIN_MAX_FAILS = 10         # tentativi sbagliati per IP nella finestra

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".zip": "application/zip",
    ".wav": "audio/wav",
    ".mid": "audio/midi",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_patterns():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_patterns(patterns):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(patterns, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


def is_public(rel):
    if any(part.startswith(".") for part in rel.split("/")):
        return False
    return rel in STATIC_FILES or rel.startswith(STATIC_DIRS)


# ---------- password e sessioni ----------
# auth.json (creato da scripts/set-password.py): hash PBKDF2 della password e segreto che
# firma i cookie. Senza file il sito resta chiuso: nessuna password funziona.
def load_auth():
    try:
        with open(AUTH_FILE, "r", encoding="utf-8") as f:
            a = json.load(f)
        return {"salt": bytes.fromhex(a["salt"]), "hash": bytes.fromhex(a["hash"]),
                "iterations": int(a["iterations"]), "secret": bytes.fromhex(a["secret"])}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def check_password(auth, password):
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), auth["salt"], auth["iterations"])
    return hmac.compare_digest(digest, auth["hash"])


def make_session(auth, now=None):
    expires = int((now or time.time()) + SESSION_DAYS * 86400)
    payload = f"v1.{expires}"
    sig = hmac.new(auth["secret"], payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def valid_session(auth, value, now=None):
    try:
        version, expires, sig = value.split(".")
    except (AttributeError, ValueError):
        return False
    good = hmac.new(auth["secret"], f"{version}.{expires}".encode(), hashlib.sha256).hexdigest()
    return (version == "v1" and hmac.compare_digest(sig, good)
            and expires.isdigit() and int(expires) > (now or time.time()))


FAILS = {}
FAILS_LOCK = threading.Lock()


def too_many_fails(ip):
    cutoff = time.time() - LOGIN_WINDOW
    with FAILS_LOCK:
        FAILS[ip] = [t for t in FAILS.get(ip, []) if t > cutoff]
        return len(FAILS[ip]) >= LOGIN_MAX_FAILS


def note_fail(ip):
    with FAILS_LOCK:
        FAILS.setdefault(ip, []).append(time.time())


def safe_next(target):
    # Solo percorsi interni: niente "//altro-sito" o URL assoluti (open redirect).
    if not target or not target.startswith("/") or target.startswith("//") or "\\" in target:
        return "/"
    return target


LOGIN_PAGE = """<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#15171a">
<title>Drum Machine Lab — Accesso</title>
<meta name="description" content="Drum machine a step con SP-1200, RX-5, 808 e 909: generatore di pattern in decine di stili, variazioni, arrangiamento della canzone ed export MIDI.">
<!-- Anteprima dei link: chi condivide un link arriva qui (il sito e' dietro password), quindi i tag stanno in questa pagina. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Drum Machine Lab">
<meta property="og:title" content="Drum Machine Lab — drum machine a step con generatore di pattern">
<meta property="og:description" content="Drum machine a step con SP-1200, RX-5, 808 e 909: generatore di pattern in decine di stili, variazioni, arrangiamento della canzone ed export MIDI.">
<meta property="og:image" content="https://drummachine.tongatron.org/assets/og-drum-machine-lab.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="800">
<meta property="og:image:alt" content="SP-1200, TR-808, TR-909 e Yamaha RX5 con l'interfaccia di Drum Machine Lab in primo piano">
<meta property="og:url" content="https://drummachine.tongatron.org/">
<meta property="og:locale" content="it_IT">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Drum Machine Lab — drum machine a step con generatore di pattern">
<meta name="twitter:description" content="Drum machine a step con SP-1200, RX-5, 808 e 909: generatore di pattern in decine di stili, variazioni, arrangiamento della canzone ed export MIDI.">
<meta name="twitter:image" content="https://drummachine.tongatron.org/assets/og-drum-machine-lab.jpg">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
:root{--bg:#15171a;--panel:#1e2126;--panel-2:#272b31;--edge:#3b424a;--text:#e9e6de;--dim:#9aa1aa;
  --accent:#3b8fd6;--ok:#4f9e63;--on-ok:#0e1a11;--danger:#e0624f;color-scheme:dark;}
@media (prefers-color-scheme: light){:root{--bg:#cdcbc4;--panel:#dcdad3;--panel-2:#cfcdc6;--edge:#a3a199;
  --text:#1b1d20;--dim:#54575b;--accent:#1f6fb2;--ok:#3d7a48;--on-ok:#fff;--danger:#b83a30;color-scheme:light;}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);
  font-family:"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));}
form{width:min(340px,100%);background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:22px 20px;
  box-shadow:0 18px 50px rgba(0,0,0,.35);}
h1{margin:0 0 4px;font-size:16px;letter-spacing:.2em;text-transform:uppercase;}
.line{height:2px;background:var(--accent);margin:0 0 18px;}
p{margin:0 0 14px;font-size:11px;color:var(--dim);line-height:1.5;}
label{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-bottom:6px;}
input{width:100%;font:inherit;font-size:16px;padding:11px 12px;border-radius:8px;border:1px solid var(--edge);
  background:var(--panel-2);color:var(--text);}
input:focus{outline:2px solid var(--accent);outline-offset:1px;}
button{width:100%;margin-top:14px;font:inherit;font-size:14px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;
  padding:12px;border-radius:9px;border:0;background:var(--ok);color:var(--on-ok);cursor:pointer;}
.err{color:var(--danger);font-size:11px;margin:10px 0 0;min-height:1em;}
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>Drum Machine Lab</h1>
  <div class="line"></div>
  <p>Il sito è protetto. Inserisci la password per entrare.</p>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
  <input type="hidden" name="next" value="{next}">
  <button type="submit">Entra</button>
  <div class="err" role="alert">{error}</div>
</form>
</body>
</html>
"""


class BodyTooLarge(Exception):
    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "DrumMachine/1.2"

    # ---------- risposte ----------
    def _send_json(self, status, payload, extra_headers=()):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status, text):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, location, extra_headers=()):
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()

    # ---------- richieste ----------
    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return None
        if length > MAX_BODY:
            raise BodyTooLarge()
        return self.rfile.read(length) if length > 0 else b""

    def _read_json_body(self):
        raw = self._read_body()
        if raw is None:
            return None
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def _client_ip(self):
        return self.headers.get("CF-Connecting-IP") or self.client_address[0]

    def _https(self):
        return (self.headers.get("X-Forwarded-Proto") == "https"
                or '"https"' in (self.headers.get("CF-Visitor") or ""))

    def _cookie(self, name):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return None

    def _session_cookie(self, value, max_age):
        attrs = [f"{SESSION_COOKIE}={value}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={max_age}"]
        if self._https():
            attrs.append("Secure")
        return ("Set-Cookie", "; ".join(attrs))

    def _authorized(self):
        auth = load_auth()
        return bool(auth) and valid_session(auth, self._cookie(SESSION_COOKIE))

    def _gate(self, path):
        """True se la richiesta puo' proseguire; altrimenti ha gia' risposto."""
        if path in OPEN_PATHS or path.startswith(OPEN_DIRS) or self._authorized():
            return True
        wants_page = self.command == "GET" and (path == "/" or path.endswith(".html")
                                                 or "text/html" in (self.headers.get("Accept") or ""))
        if wants_page:
            # Si conserva anche la query (es. ?p=<codice> dei link condivisi); "&" va codificato.
            query = urlparse(self.path).query
            target = path + ("?" + query if query else "")
            self._redirect("/login?next=" + quote(target, safe="/?=~"))
        else:
            self._send_json(401, {"error": "accesso richiesto"})
        return False

    def _cross_site(self):
        # Le scritture arrivano solo dalle pagine del sito: una richiesta partita da un
        # altro sito (CSRF) viene rifiutata. Dietro il tunnel Cloudflare l'Host puo' essere
        # quello interno, quindi il confronto con Origin si usa solo senza Sec-Fetch-Site.
        site = self.headers.get("Sec-Fetch-Site")
        if site:
            return site not in ("same-origin", "none")
        origin = self.headers.get("Origin")
        if origin:
            hosts = {self.headers.get("X-Forwarded-Host"), self.headers.get("Host")}
            return urlparse(origin).netloc not in hosts
        return False

    def _guard_write(self):
        if self._cross_site():
            self._send_json(403, {"error": "richiesta da un altro sito"})
            return False
        return True

    def _body_or_error(self):
        try:
            return self._read_json_body(), False
        except BodyTooLarge:
            self._send_json(413, {"error": "richiesta troppo grande"})
            return None, True

    # ---------- login ----------
    def _login_page(self, status=200, error="", next_path="/"):
        page = (LOGIN_PAGE.replace("{next}", html.escape(safe_next(next_path), quote=True))
                .replace("{error}", html.escape(error)))
        self._send_html(status, page)

    def _do_login(self):
        if self._cross_site():
            self._send_json(403, {"error": "richiesta da un altro sito"})
            return
        try:
            raw = self._read_body() or b""
        except BodyTooLarge:
            self._send_json(413, {"error": "richiesta troppo grande"})
            return
        form = parse_qs(raw.decode("utf-8", "replace"))
        next_path = safe_next((form.get("next") or ["/"])[0])
        ip = self._client_ip()
        if too_many_fails(ip):
            self._login_page(429, "Troppi tentativi. Riprova tra qualche minuto.", next_path)
            return
        auth = load_auth()
        if not auth:
            self._login_page(503, "Accesso non configurato sul server.", next_path)
            return
        if not check_password(auth, (form.get("password") or [""])[0]):
            note_fail(ip)
            time.sleep(0.4)
            self._login_page(401, "Password errata.", next_path)
            return
        self._redirect(next_path, [self._session_cookie(make_session(auth), SESSION_DAYS * 86400)])

    # ---------- file statici ----------
    def _serve_static(self):
        path = unquote(urlparse(self.path).path)
        if path == "/":
            path = "/index.html"
        rel = os.path.normpath(path).lstrip("/")
        full_path = os.path.join(ROOT, rel)
        if (not full_path.startswith(ROOT + os.sep) or not is_public(rel.replace(os.sep, "/"))
                or not os.path.isfile(full_path)):
            self.send_error(404, "Not found")
            return
        ext = os.path.splitext(full_path)[1].lower()
        with open(full_path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, no-cache" if ext in NO_CACHE_EXT else LONG_CACHE)
        self.send_header("X-Content-Type-Options", "nosniff")
        if ext == ".html":
            self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(data)

    # ---------- metodi ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/login":
            next_path = (parse_qs(parsed.query).get("next") or ["/"])[0]
            if self._authorized():
                self._redirect(safe_next(next_path))
            else:
                self._login_page(next_path=next_path)
            return
        if path == "/logout":
            self._redirect("/login", [self._session_cookie("", 0)])
            return
        if not self._gate(path):
            return
        if path == "/api/patterns":
            with LOCK:
                patterns = load_patterns()
            self._send_json(200, patterns)
            return
        self._serve_static()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/login":
            self._do_login()
            return
        if not self._gate(path):
            return
        if path == "/api/patterns":
            if not self._guard_write():
                return
            body, failed = self._body_or_error()
            if failed:
                return
            if body is None or not isinstance(body.get("text"), str):
                self._send_json(400, {"error": "richiede {name, text}"})
                return
            if len(body["text"]) > MAX_TEXT:
                self._send_json(413, {"error": "pattern troppo lungo"})
                return
            name = (body.get("name") or "").strip()[:MAX_NAME] or "Senza nome"
            entry = {
                "id": uuid.uuid4().hex,
                "name": name,
                "text": body["text"],
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            with LOCK:
                patterns = load_patterns()
                if len(patterns) >= MAX_PATTERNS:
                    self._send_json(507, {"error": "archivio pieno"})
                    return
                patterns.append(entry)
                save_patterns(patterns)
            self._send_json(201, entry)
            return
        self.send_error(404, "Not found")

    def do_PUT(self):
        path = urlparse(self.path).path
        if not self._gate(path):
            return
        m = PATTERN_ID_RE.match(path)
        if not m:
            self.send_error(404, "Not found")
            return
        if not self._guard_write():
            return
        pid = m.group(1)
        body, failed = self._body_or_error()
        if failed:
            return
        if body is None:
            self._send_json(400, {"error": "JSON non valido"})
            return
        if isinstance(body.get("text"), str) and len(body["text"]) > MAX_TEXT:
            self._send_json(413, {"error": "pattern troppo lungo"})
            return
        with LOCK:
            patterns = load_patterns()
            for p in patterns:
                if p["id"] == pid:
                    if isinstance(body.get("name"), str) and body["name"].strip():
                        p["name"] = body["name"].strip()[:MAX_NAME]
                    if isinstance(body.get("text"), str):
                        p["text"] = body["text"]
                    p["updated_at"] = now_iso()
                    save_patterns(patterns)
                    self._send_json(200, p)
                    return
        self._send_json(404, {"error": "pattern non trovato"})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not self._gate(path):
            return
        m = PATTERN_ID_RE.match(path)
        if not m:
            self.send_error(404, "Not found")
            return
        if not self._guard_write():
            return
        pid = m.group(1)
        with LOCK:
            patterns = load_patterns()
            remaining = [p for p in patterns if p["id"] != pid]
            if len(remaining) == len(patterns):
                self._send_json(404, {"error": "pattern non trovato"})
                return
            save_patterns(remaining)
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(os.environ.get("PORT", "8095"))
    host = os.environ.get("HOST", "127.0.0.1")
    server = ThreadingHTTPServer((host, port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
