"""Test di server.py: python3 tests/server_test.py

Costruisce in una cartella temporanea la stessa struttura del server (site/ + toolkit + server.py,
dati di prova, un backup e un file nascosto), imposta una password di prova con
scripts/set-password.py, avvia il server in un thread e verifica accesso, file pubblici,
intestazioni di cache e protezioni dell'API.
"""
import http.client
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

HERE = Path(__file__).resolve().parent.parent
TEST_PASSWORD = "prova-di-test"
FAKE_ZIP = bytes(range(256)) * (3 * 4096 + 7)
failures = 0


def build_stage():
    stage = Path(tempfile.mkdtemp(prefix="patternmachine-stage-"))
    # download/ vero (l'app da ~130 MB) resta fuori: al suo posto uno zip finto piu' grande di un pezzo (1 MB)
    shutil.copytree(HERE / "site", stage, dirs_exist_ok=True, ignore=shutil.ignore_patterns("download"))
    (stage / "download").mkdir()
    (stage / "download" / "PatternMachine-macOS.zip").write_bytes(FAKE_ZIP)
    (stage / "download" / "app.json").write_text(json.dumps({"file": "PatternMachine-macOS.zip", "bytes": len(FAKE_ZIP)}))
    shutil.copy(HERE / "index.html", stage / "toolkit.html")
    shutil.copy(HERE / "server.py", stage / "server.py")
    shutil.copy(HERE / "scripts" / "set-password.py", stage / "set-password.py")
    (stage / "data").mkdir()
    (stage / "data" / "patterns.json").write_text(json.dumps([{
        "id": "abc", "name": "prova", "text": "PATTERNTXT 1.0",
        "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"}]))
    (stage / "backup-index-x.html").write_text("backup")
    (stage / ".env").write_text("x")
    subprocess.run([sys.executable, str(stage / "set-password.py"), "--stdin"], input=TEST_PASSWORD,
                   text=True, check=True, capture_output=True, env={**os.environ, "PATTERNMACHINE_AUTH": "", "DRUMMACHINE_AUTH": ""})
    return stage


def start(stage):
    os.environ["PATTERNMACHINE_AUTH"] = str(stage / "auth.json")
    spec = importlib.util.spec_from_file_location("server_under_test", stage / "server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), mod.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return mod, httpd, httpd.server_address[1]


class Client:
    """Richieste senza seguire i redirect, con un cookie di sessione facoltativo."""
    def __init__(self, port):
        self.port, self.cookie = port, None

    def call(self, path, method="GET", body=None, headers=None, form=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        h = dict(headers or {})
        data = None
        if form is not None:
            data = urlencode(form).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if self.cookie:
            h["Cookie"] = self.cookie
        conn.request(method, path, body=data, headers=h)
        r = conn.getresponse()
        out = (r.status, {k.lower(): v for k, v in r.getheaders()}, r.read())
        conn.close()
        return out


def check(label, got, expected):
    global failures
    ok = got == expected
    failures += not ok
    print(("ok  " if ok else "FAIL"), f"{label}: {got}" + ("" if ok else f" (atteso {expected})"))


def main():
    stage = build_stage()
    mod, httpd, port = start(stage)
    same = {"Sec-Fetch-Site": "same-origin"}
    anon, user = Client(port), Client(port)
    try:
        mode = stat.S_IMODE((stage / "auth.json").stat().st_mode)
        check("auth.json leggibile solo dal proprietario", oct(mode), "0o600")
        check("password non in chiaro nel file", TEST_PASSWORD in (stage / "auth.json").read_text(), False)

        # --- senza password ---
        s, h, _ = anon.call("/")
        check("anonimo / -> login", (s, h.get("location")), (303, "/login?next=/"))
        check("anonimo toolkit -> login", anon.call("/toolkit.html")[1].get("location"), "/login?next=/toolkit.html")
        check("anonimo pagina app -> login", anon.call("/app.html")[1].get("location"), "/login?next=/app.html")
        check("anonimo zip app: negato", anon.call("/download/PatternMachine-macOS.zip")[0], 401)
        loc = anon.call("/?p=dbeat-16S-111111~R000005BEEF&x=1")[1].get("location")
        check("link condiviso conserva la query", loc, "/login?next=/?p=dbeat-16S-111111~R000005BEEF%26x=1")
        page = anon.call(loc)[2].decode()
        check("la query arriva nel form di login", 'value="/?p=dbeat-16S-111111~R000005BEEF&amp;x=1"' in page, True)
        for path in ["/engine/core.js", "/samples/Kick%201%20SP-1200.wav", "/machines/rx5/BDrum1-RX5.wav", "/sw.js", "/api/patterns", "/server.py"]:
            check("anonimo bloccato " + path, anon.call(path)[0], 401)
        # Anteprima dei link: senza password si vede l'immagine e la pagina di accesso porta i tag og:
        st, hd, body = anon.call("/assets/og-drum-machine-lab.jpg")
        check("immagine di anteprima pubblica", st, 200)
        check("immagine di anteprima jpeg", hd.get("content-type"), "image/jpeg")
        check("immagine di anteprima leggera", len(body) < 600_000, True)
        login_html = anon.call("/login")[2].decode()
        check("pagina di accesso con og:image", 'property="og:image" content="https://patternmachine.tongatron.org/assets/og-drum-machine-lab.jpg"' in login_html, True)
        check("pagina di accesso con og:title", 'property="og:title"' in login_html, True)
        check("anonimo POST api", anon.call("/api/patterns", "POST", {"text": "t"}, same)[0], 401)
        check("anonimo DELETE api", anon.call("/api/patterns/abc", "DELETE", None, same)[0], 401)
        for path in ["/login", "/manifest.json", "/icons/icon-192.png", "/assets/og-sp1200.png"]:
            check("aperto " + path, anon.call(path)[0], 200)

        # --- vecchio indirizzo (drummachine.tongatron.org): solo trasloco verso il nuovo, senza password ---
        old = {"Host": "drummachine.tongatron.org"}
        st, hd, body = anon.call("/?p=abc", headers={**old, "Accept": "text/html"})
        check("vecchio indirizzo: pagina di trasloco", (st, b"#trasloco=" in body, b"https://patternmachine.tongatron.org" in body), (200, True, True))
        st, hd, body = anon.call("/sw.js", headers=old)
        check("vecchio indirizzo: service worker che si disinstalla", (st, b"unregister" in body), (200, True))
        st, hd, _ = anon.call("/api/patterns", headers=old)
        check("vecchio indirizzo: il resto rimanda al nuovo", (st, hd.get("location")), (308, "https://patternmachine.tongatron.org/api/patterns"))
        check("vecchio indirizzo: niente scritture", anon.call("/api/patterns", "POST", {"text": "t"}, {**old, **same})[0], 308)

        # --- login ---
        s, h, body = anon.call("/login", "POST", form={"password": "sbagliata", "next": "/"}, headers=same)
        check("password errata", (s, "set-cookie" in h, b"Password errata" in body), (401, False, True))
        s, h, _ = user.call("/login", "POST", form={"password": TEST_PASSWORD, "next": "/toolkit.html"}, headers=same)
        cookie = h.get("set-cookie", "")
        check("password giusta -> redirect a next", (s, h.get("location")), (303, "/toolkit.html"))
        check("cookie HttpOnly e SameSite", ("HttpOnly" in cookie, "SameSite=Lax" in cookie, "Secure" in cookie), (True, True, False))
        user.cookie = cookie.split(";")[0]
        s, h, _ = Client(port).call("/login", "POST", form={"password": TEST_PASSWORD, "next": "//evil.example"},
                                    headers={**same, "X-Forwarded-Proto": "https"})
        check("next esterno ignorato", h.get("location"), "/")
        check("cookie Secure dietro https", "Secure" in h.get("set-cookie", ""), True)
        check("login da altro sito", anon.call("/login", "POST", form={"password": TEST_PASSWORD},
                                               headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        check("/login da loggato -> sito", user.call("/login?next=/toolkit.html")[1].get("location"), "/toolkit.html")

        # --- con sessione ---
        for path in ["/", "/toolkit.html", "/engine/core.js?v=1", "/samples/Kick%201%20SP-1200.wav",
                     "/icons/icon-192.png", "/sw.js", "/manifest.json", "/api/patterns", "/machines/rx5/BDrum1-RX5.wav"]:
            check("loggato " + path, user.call(path)[0], 200)
        for path in ["/server.py", "/auth.json", "/set-password.py", "/data/patterns.json", "/backup-index-x.html",
                     "/.env", "/engine/../server.py", "/samples/../data/patterns.json", "/nope.html"]:
            check("nascosto anche da loggato " + path, user.call(path)[0], 404)
        s, h, body = user.call("/download/PatternMachine-macOS.zip?v=abc")
        check("zip app: intero, a pezzi", (s, h.get("content-length"), body == FAKE_ZIP), (200, str(len(FAKE_ZIP)), True))
        check("zip app: tipo", h.get("content-type"), "application/zip")
        check("pagina app", user.call("/app.html")[0], 200)
        check("scheda app non in cache", user.call("/download/app.json")[1].get("cache-control"), "private, no-cache")
        check("cache html privata", user.call("/")[1].get("cache-control"), "private, no-cache")
        check("cache campioni privata", user.call("/samples/Kick%201%20SP-1200.wav")[1].get("cache-control"),
              "private, max-age=604800")

        tampered = Client(port)
        tampered.cookie = user.cookie[:-1] + ("0" if user.cookie[-1] != "0" else "1")
        check("cookie manomesso", tampered.call("/")[0], 303)
        auth = mod.load_auth()
        check("sessione scaduta", mod.valid_session(auth, mod.make_session(auth, now=time.time() - 31 * 86400)), False)

        check("POST same-origin", user.call("/api/patterns", "POST", {"name": "n", "text": "t"}, same)[0], 201)
        check("POST cross-site", user.call("/api/patterns", "POST", {"text": "t"}, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        check("POST troppo grande", user.call("/api/patterns", "POST", {"text": "x" * 300_000}, same)[0], 413)
        pid = json.loads(user.call("/api/patterns")[2])[-1]["id"]
        check("PUT same-origin", user.call(f"/api/patterns/{pid}", "PUT", {"name": "r"}, same)[0], 200)
        check("DELETE same-origin", user.call(f"/api/patterns/{pid}", "DELETE", None, same)[0], 204)
        check("dati integri", [p["id"] for p in json.loads(user.call("/api/patterns")[2])], ["abc"])

        # --- logout, limite tentativi, configurazione mancante ---
        s, h, _ = user.call("/logout")
        check("logout cancella il cookie", (s, "Max-Age=0" in h.get("set-cookie", "")), (303, True))
        brute = Client(port)
        ip = {**same, "CF-Connecting-IP": "203.0.113.9"}
        for _ in range(10):
            brute.call("/login", "POST", form={"password": "no"}, headers=ip)
        check("troppi tentativi bloccano anche la password giusta",
              brute.call("/login", "POST", form={"password": TEST_PASSWORD}, headers=ip)[0], 429)
        check("altri IP non bloccati", Client(port).call("/login", "POST", form={"password": TEST_PASSWORD}, headers=same)[0], 303)

        (stage / "auth.json").rename(stage / "auth.off")
        check("senza auth.json il sito resta chiuso", anon.call("/")[0], 303)
        check("senza auth.json anche il vecchio cookie non vale", user.call("/api/patterns")[0], 401)
        check("senza auth.json il login lo dice", anon.call("/login", "POST", form={"password": TEST_PASSWORD}, headers=same)[0], 503)
    finally:
        httpd.shutdown()
        shutil.rmtree(stage, ignore_errors=True)
    print("\nfallimenti:", failures)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
