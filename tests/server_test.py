"""Test di server.py: python3 tests/server_test.py

Costruisce in una cartella temporanea la stessa struttura del server (site/ + toolkit + server.py,
dati di prova, un backup e un file nascosto), avvia il server in un thread e verifica
quali file sono pubblici, le intestazioni di cache e le protezioni dell'API.
"""
import importlib.util
import json
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
failures = 0


def build_stage():
    stage = Path(tempfile.mkdtemp(prefix="drummachine-stage-"))
    shutil.copytree(HERE / "site", stage, dirs_exist_ok=True)
    shutil.copy(HERE / "index.html", stage / "toolkit.html")
    shutil.copy(HERE / "server.py", stage / "server.py")
    (stage / "data").mkdir()
    (stage / "data" / "patterns.json").write_text(json.dumps([{
        "id": "abc", "name": "prova", "text": "PATTERNTXT 1.0",
        "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00"}]))
    (stage / "backup-index-x.html").write_text("backup")
    (stage / ".env").write_text("x")
    return stage


def start(stage):
    spec = importlib.util.spec_from_file_location("server_under_test", stage / "server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), mod.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def call(base, path, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def check(label, got, expected):
    global failures
    ok = got == expected
    failures += not ok
    print(("ok  " if ok else "FAIL"), f"{label}: {got}" + ("" if ok else f" (atteso {expected})"))


def main():
    stage = build_stage()
    httpd, base = start(stage)
    same = {"Sec-Fetch-Site": "same-origin"}
    try:
        for path in ["/", "/toolkit.html", "/engine/core.js?v=1", "/samples/Kick%201%20SP-1200.wav",
                     "/icons/icon-192.png", "/sw.js", "/manifest.json", "/api/patterns"]:
            check("pubblico " + path, call(base, path)[0], 200)
        for path in ["/server.py", "/data/patterns.json", "/backup-index-x.html", "/.env",
                     "/engine/../server.py", "/samples/../data/patterns.json", "/nope.html"]:
            check("nascosto " + path, call(base, path)[0], 404)

        check("cache html", call(base, "/")[1].get("Cache-Control"), "no-cache")
        check("cache engine js", call(base, "/engine/core.js")[1].get("Cache-Control"), "no-cache")
        check("cache campioni", call(base, "/samples/Kick%201%20SP-1200.wav")[1].get("Cache-Control"),
              "public, max-age=604800")

        check("POST same-origin", call(base, "/api/patterns", "POST", {"name": "n", "text": "t"}, same)[0], 201)
        check("POST cross-site", call(base, "/api/patterns", "POST", {"text": "t"}, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        check("POST Origin estraneo", call(base, "/api/patterns", "POST", {"text": "t"}, {"Origin": "https://evil.example"})[0], 403)
        check("POST troppo grande", call(base, "/api/patterns", "POST", {"text": "x" * 300_000}, same)[0], 413)
        check("POST senza text", call(base, "/api/patterns", "POST", {"name": "n"}, same)[0], 400)

        pid = json.loads(call(base, "/api/patterns")[2])[-1]["id"]
        check("PUT same-origin", call(base, f"/api/patterns/{pid}", "PUT", {"name": "r"}, same)[0], 200)
        check("PUT cross-site", call(base, f"/api/patterns/{pid}", "PUT", {"name": "r"}, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        check("DELETE cross-site", call(base, f"/api/patterns/{pid}", "DELETE", None, {"Sec-Fetch-Site": "cross-site"})[0], 403)
        check("DELETE same-origin", call(base, f"/api/patterns/{pid}", "DELETE", None, same)[0], 204)
        check("dati integri", [p["id"] for p in json.loads(call(base, "/api/patterns")[2])][0], "abc")
    finally:
        httpd.shutdown()
        shutil.rmtree(stage, ignore_errors=True)
    print("\nfallimenti:", failures)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
