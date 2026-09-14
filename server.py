#!/usr/bin/env python3
import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "patterns.json")
LOCK = threading.Lock()

PATTERN_ID_RE = re.compile(r"^/api/patterns/([A-Za-z0-9\-]+)$")

# Si serve solo cio' che fa parte del sito: server.py, data/ e qualunque altro file
# lasciato nella cartella (backup, appunti) restano fuori.
STATIC_FILES = {"index.html", "toolkit.html", "manifest.json", "sw.js"}
STATIC_DIRS = ("engine/", "icons/", "samples/", "samples12/", "assets/")

# HTML, service worker, manifest e motore vanno sempre riconvalidati, cosi' Cloudflare e
# i browser non tengono versioni vecchie; campioni e immagini non cambiano.
NO_CACHE_EXT = (".html", ".js", ".json")
LONG_CACHE = "public, max-age=604800"

MAX_BODY = 256 * 1024
MAX_NAME = 120
MAX_TEXT = 100 * 1024
MAX_PATTERNS = 1000

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


class BodyTooLarge(Exception):
    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "DrumMachine/1.1"

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return None
        if length > MAX_BODY:
            raise BodyTooLarge()
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def _cross_site(self):
        # Le scritture arrivano solo dalle pagine del sito: una richiesta partita da un
        # altro sito (CSRF) viene rifiutata. Non sostituisce un'autenticazione.
        # Dietro il tunnel Cloudflare l'Host puo' essere quello interno, quindi il
        # confronto con Origin si usa solo con i browser che non mandano Sec-Fetch-Site.
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
        self.send_header("Cache-Control", "no-cache" if ext in NO_CACHE_EXT else LONG_CACHE)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/patterns":
            with LOCK:
                patterns = load_patterns()
            self._send_json(200, patterns)
            return
        self._serve_static()

    def do_POST(self):
        path = urlparse(self.path).path
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
