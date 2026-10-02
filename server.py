#!/usr/bin/env python3
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import shutil
import smtplib
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "patterns.json")
USERS_FILE = os.environ.get("PATTERNMACHINE_USERS") or os.path.join(DATA_DIR, "users.json")
APP_MESSAGE_FILE = os.environ.get("PATTERNMACHINE_APP_MESSAGE") or os.path.join(DATA_DIR, "app-message.json")
MAIL_FILE = os.environ.get("PATTERNMACHINE_MAIL") or os.path.join(ROOT, "mail.json")
TELEGRAM_FILE = os.environ.get("PATTERNMACHINE_TELEGRAM") or os.path.join(ROOT, "telegram.json")

# Dal 2026-09 il sito si chiama PatternMachine. Il vecchio indirizzo resta attivo solo per il trasloco:
# le pagine portano progetti, preferiti e tema (salvati nel browser, quindi legati al dominio) al nuovo
# indirizzo, il vecchio service worker si disinstalla, tutto il resto viene rediretto.
SITE_URL = os.environ.get("SITE_URL", "https://patternmachine.tongatron.org")
OLD_HOSTS = {"drummachine.tongatron.org"}
LOCK = threading.Lock()

PATTERN_ID_RE = re.compile(r"^/api/patterns/([A-Za-z0-9\-]+)$")

# Si serve solo cio' che fa parte del sito: server.py, mail.json, data/ e qualunque altro
# file lasciato nella cartella (backup, appunti) restano fuori.
STATIC_FILES = {"index.html", "landing.html", "funzioni.html", "macchine.html", "synth.html", "app.html", "plugin.html", "embed.html", "privacy.html", "manifest.json", "sw.js", "robots.txt", "sitemap.xml"}
# download/: le app (zip da ~100 MB) e app.json con versione e dimensione, scritti da desktop/scripts/release.sh;
# il plug-in per Logic e plugin.json, scritti da plugin/scripts/release.sh.
# learn/: il corso (lezioni e mini drum machine), come il resto del sito solo per chi ha l'accesso.
STATIC_DIRS = ("engine/", "icons/", "samples/", "samples12/", "machines/", "assets/", "download/", "learn/")
DOWNLOAD_PLATFORMS = {
    "PatternMachine-macOS.zip": "macOS",
    "PatternMachine-Windows.exe": "Windows",
    "PatternMachine-Linux.AppImage": "Linux",
    "PatternMachine-Plugin-macOS.zip": "Logic plug-in",
}

# Visibili senza password: servono al browser per installare la PWA e alle anteprime dei link;
# landing.html presenta il progetto a chi non ha ancora un account (con le sue schermate).
OPEN_PATHS = {"/landing.html", "/funzioni.html", "/macchine.html", "/plugin.html", "/embed.html", "/privacy.html", "/robots.txt", "/sitemap.xml", "/login", "/logout", "/register", "/forgot", "/reset", "/manifest.json", "/api/app-message", "/assets/og-sp1200.png", "/assets/og-drum-machine-lab.jpg", "/assets/patternmachine-preview.jpg", "/assets/og-pattern-machine.png"}
OPEN_DIRS = ("/icons/", "/assets/landing/")

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
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".zip": "application/zip",
    ".exe": "application/vnd.microsoft.portable-executable",
    ".appimage": "application/octet-stream",
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


def load_app_message():
    """Legge il messaggio breve mostrato dall'app macOS, senza esporre il file sorgente."""
    try:
        with open(APP_MESSAGE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {"show": False}
    if not isinstance(data, dict):
        return {"show": False}
    msg_id = str(data.get("id") or "").strip()[:120]
    title = str(data.get("title") or "").strip()[:160]
    message = str(data.get("message") or "").strip()[:2000]
    target = str(data.get("url") or (SITE_URL + "/app.html")).strip()
    if data.get("enabled") is False:
        return {"show": False}
    base = urlparse(SITE_URL)
    link = urlparse(target)
    if not msg_id or not title or not message or link.scheme not in ("http", "https") or link.netloc != base.netloc:
        return {"show": False}
    expires = data.get("expires")
    if expires:
        try:
            deadline = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
            if deadline.tzinfo is None:
                deadline = deadline.replace(tzinfo=timezone.utc)
            if deadline <= datetime.now(timezone.utc):
                return {"show": False}
        except ValueError:
            return {"show": False}
    return {"show": True, "id": msg_id, "title": title, "message": message, "url": target}


def load_app_message_admin():
    try:
        with open(APP_MESSAGE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_patterns(patterns):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(patterns, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


# ---------- progetti degli utenti ----------
# Un file per utente, data/projects/<id utente>.json (mai servito):
#   {"<id progetto>": {"rev": "...", "updated_at": "...", "data": {...progetto...}}}
# Un progetto cancellato resta come lapide {"rev", "updated_at", "deleted": true}: gli altri dispositivi
# lo tolgono invece di ricaricarlo. La rev cambia a ogni scrittura e chi scrive manda quella da cui e'
# partito ("base"): se nel frattempo un altro dispositivo l'ha cambiata, la versione in arrivo si salva
# come copia accanto all'altra, cosi' nessuna delle due si perde.
PROJECTS_DIR = os.environ.get("PATTERNMACHINE_PROJECTS") or os.path.join(DATA_DIR, "projects")
PROJECTS_LOCK = threading.Lock()
PROJECT_ID_RE = re.compile(r"^/api/projects/([A-Za-z0-9_-]{1,64})$")
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_PROJECT_BODY = 2 * 1024 * 1024
MAX_PROJECTS = 500           # progetti vivi per utente
MAX_TOMBSTONES = 1000        # lapidi per utente: oltre, cadono le piu' vecchie

# Campioni sincronizzati: i file restano separati dai progetti e non vengono mai serviti come
# contenuto statico. Il limite e' per account, cosi' il browser e l'app hanno lo stesso tetto.
SAMPLES_DIR = os.environ.get("PATTERNMACHINE_SAMPLES") or os.path.join(DATA_DIR, "samples-users")
SAMPLES_LOCK = threading.Lock()
SAMPLE_ID_RE = re.compile(r"^s-[A-Za-z0-9_-]{1,64}$")
SAMPLE_PATH_RE = re.compile(r"^/api/samples/([A-Za-z0-9_-]{1,64})$")
MAX_SAMPLE_BYTES = 20 * 1024 * 1024
MAX_SAMPLE_COUNT = 256


def projects_file(uid):
    if not SAFE_ID_RE.match(uid or ""):
        raise ValueError("id utente non valido")
    return os.path.join(PROJECTS_DIR, uid + ".json")


def load_projects(uid):
    try:
        with open(projects_file(uid), "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    return data if isinstance(data, dict) else {}


def save_projects(uid, projects):
    os.makedirs(PROJECTS_DIR, mode=0o700, exist_ok=True)
    tombs = sorted((k for k, v in projects.items() if v.get("deleted")), key=lambda k: projects[k].get("updated_at", ""))
    for k in tombs[:max(0, len(tombs) - MAX_TOMBSTONES)]:
        del projects[k]
    path = projects_file(uid)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(projects, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def delete_user_projects(uid):
    try:
        os.remove(projects_file(uid))
    except (FileNotFoundError, ValueError):
        pass


def samples_manifest_file(uid):
    if not SAFE_ID_RE.match(uid or ""):
        raise ValueError("id utente non valido")
    return os.path.join(SAMPLES_DIR, uid + ".json")


def samples_blob_dir(uid):
    if not SAFE_ID_RE.match(uid or ""):
        raise ValueError("id utente non valido")
    return os.path.join(SAMPLES_DIR, uid)


def load_samples(uid):
    try:
        with open(samples_manifest_file(uid), "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    return data if isinstance(data, dict) else {}


def save_samples(uid, samples):
    os.makedirs(SAMPLES_DIR, mode=0o700, exist_ok=True)
    path = samples_manifest_file(uid)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(samples, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def sample_blob_path(uid, sid):
    if not SAMPLE_ID_RE.match(sid or ""):
        raise ValueError("id campione non valido")
    return os.path.join(samples_blob_dir(uid), sid + ".blob")


def put_project(uid, pid, data, base):
    """Salva un progetto; ritorna (id, rev, conflict) o None se l'archivio e' pieno."""
    with PROJECTS_LOCK:
        projects = load_projects(uid)
        cur = projects.get(pid)
        conflict = bool(cur and not cur.get("deleted") and cur.get("rev") != base)
        if conflict:
            # cambiato altrove dopo "base": la versione in arrivo diventa una copia
            while pid in projects:
                pid = (pid[:52] + "-" + secrets.token_hex(5))
            data = dict(data, name=(str(data.get("name") or "Untitled")[:100] + " (copy)"))
        if (not cur or cur.get("deleted") or conflict) and sum(not v.get("deleted") for v in projects.values()) >= MAX_PROJECTS:
            return None
        rev = secrets.token_hex(8)
        projects[pid] = {"rev": rev, "updated_at": now_iso(), "data": data}
        save_projects(uid, projects)
    return pid, rev, conflict, data.get("name")


def is_public(rel):
    if any(part.startswith(".") for part in rel.split("/")):
        return False
    return rel in STATIC_FILES or rel.startswith(STATIC_DIRS)


# ---------- utenti e sessioni ----------
# data/users.json (mai servito): segreto che firma i cookie, utenti con hash PBKDF2 della password e
# token di reset (solo l'hash sha256, validi un'ora, usabili una volta). Il primo admin si crea sul
# server con scripts/add-user.py; dal sito ci si registra solo come utente.
ITERATIONS = int(os.environ.get("PATTERNMACHINE_PBKDF2_ITER", "600000"))
MAX_USERNAME = 40
RESET_TTL = 3600
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERS_LOCK = threading.Lock()


def load_users():
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            db = json.load(f)
    except (OSError, ValueError):
        db = {}
    db.setdefault("users", [])
    db.setdefault("resets", [])
    return db


def save_users(db):
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    tmp = USERS_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USERS_FILE)


def record_download(user_id, filename):
    """Registra un pacchetto scaricato da un utente registrato."""
    platform = DOWNLOAD_PLATFORMS.get(filename)
    if not platform:
        return
    with USERS_LOCK:
        db = load_users()
        user = find_user(db, uid=user_id)
        if not user or user.get("role") == "guest":
            return
        downloads = user.setdefault("downloads", [])
        downloads.append({"file": filename, "platform": platform, "at": now_iso()})
        # Mantiene il file utenti compatto anche dopo molti test o reinstallazioni.
        user["downloads"] = downloads[-200:]
        save_users(db)


def users_secret(db):
    """Il segreto dei cookie; se manca lo crea (chi lo chiama deve salvare db)."""
    if not db.get("secret"):
        db["secret"] = secrets.token_hex(32)
    return bytes.fromhex(db["secret"])


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return {"salt": salt.hex(), "hash": digest.hex(), "iterations": ITERATIONS}


def check_password(user, password):
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(user["salt"]), int(user["iterations"]))
    return hmac.compare_digest(digest.hex(), user["hash"])


def name_key(name):
    return " ".join(name.split()).casefold()


def clean_name(name):
    name = " ".join((name or "").split())
    if not name or len(name) > MAX_USERNAME or any(ord(c) < 32 for c in name):
        return None
    return name


def find_user(db, name=None, uid=None):
    for u in db["users"]:
        if (uid and u["id"] == uid) or (name and name_key(u["name"]) == name_key(name)):
            return u
    return None


def login_candidates(db, who):
    """Gli account che corrispondono a un nome o a una mail (piu' account possono avere la stessa mail)."""
    who = (who or "").strip()
    if not who:
        return []
    by_name = find_user(db, name=who)
    if by_name:
        return [by_name]
    return [u for u in db["users"] if u.get("email") and u["email"].casefold() == who.casefold()]


def new_user(name, password, email="", role="user"):
    return {"id": uuid.uuid4().hex, "name": name, "email": email, "role": role, "pwv": 1,
            "created_at": now_iso(), "last_login": "", **hash_password(password)}


def set_user_password(user, password):
    user.update(hash_password(password))
    user["pwv"] = int(user.get("pwv", 1)) + 1        # le sessioni aperte con la vecchia password decadono


# Cookie: v2.<id utente>.<versione password>.<scadenza>.<firma>
def make_session(secret, user, now=None):
    expires = int((now or time.time()) + SESSION_DAYS * 86400)
    payload = f"v2.{user['id']}.{user.get('pwv', 1)}.{expires}"
    return payload + "." + hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()


# Ospite ("Accedi senza registrarti"): cookie g2.<casuale>.<scadenza>.<firma>, niente account.
# Puo' usare il sito ma non salvare (progetti, preferiti, archivio pattern).
GUEST = {"id": "", "name": "Ospite", "role": "guest", "email": ""}


def make_guest_session(secret, now=None):
    expires = int((now or time.time()) + SESSION_DAYS * 86400)
    payload = f"g2.{secrets.token_hex(8)}.{expires}"
    return payload + "." + hmac.new(secret, payload.encode(), hashlib.sha256).hexdigest()


def session_user(db, value, now=None):
    if isinstance(value, str) and value.startswith("g2."):
        try:
            version, rnd, expires, sig = value.split(".")
        except ValueError:
            return None
        if not db.get("secret") or not expires.isdigit() or int(expires) <= (now or time.time()):
            return None
        good = hmac.new(bytes.fromhex(db["secret"]), f"{version}.{rnd}.{expires}".encode(), hashlib.sha256).hexdigest()
        return GUEST if hmac.compare_digest(sig, good) else None
    try:
        version, uid, pwv, expires, sig = value.split(".")
    except (AttributeError, ValueError):
        return None
    if version != "v2" or not db.get("secret") or not expires.isdigit() or int(expires) <= (now or time.time()):
        return None
    good = hmac.new(bytes.fromhex(db["secret"]), f"{version}.{uid}.{pwv}.{expires}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, good):
        return None
    user = find_user(db, uid=uid)
    return user if user and str(user.get("pwv", 1)) == pwv else None


def make_reset(db, user):
    token = secrets.token_urlsafe(32)
    now = time.time()
    db["resets"] = [r for r in db["resets"] if r["expires"] > now]
    db["resets"].append({"hash": hashlib.sha256(token.encode()).hexdigest(), "uid": user["id"], "expires": int(now + RESET_TTL)})
    return token


def reset_user(db, token):
    if not token:
        return None
    h = hashlib.sha256(token.encode()).hexdigest()
    for r in db["resets"]:
        if hmac.compare_digest(r["hash"], h) and r["expires"] > time.time():
            return find_user(db, uid=r["uid"])
    return None


# Limite di tentativi per IP, separato per azione (login sbagliati, registrazioni, richieste di reset).
LIMITS = {"login": LOGIN_MAX_FAILS, "register": 10, "forgot": 5, "report": 5}
FAILS = {}
FAILS_LOCK = threading.Lock()


def too_many(ip, kind="login"):
    cutoff = time.time() - LOGIN_WINDOW
    with FAILS_LOCK:
        key = (kind, ip)
        FAILS[key] = [t for t in FAILS.get(key, []) if t > cutoff]
        return len(FAILS[key]) >= LIMITS[kind]


def note(ip, kind="login"):
    with FAILS_LOCK:
        FAILS.setdefault((kind, ip), []).append(time.time())


def safe_next(target):
    # Solo percorsi interni: niente "//altro-sito" o URL assoluti (open redirect).
    if not target or not target.startswith("/") or target.startswith("//") or "\\" in target:
        return "/"
    return target


# ---------- mail (Gmail) ----------
# mail.json accanto a server.py (mai servito, creato da scripts/set-mail.py): {"user", "app_password", "from_name"}.
# In alternativa le variabili PATTERNMACHINE_SMTP_USER / PATTERNMACHINE_SMTP_PASS. Senza configurazione
# le mail non partono (la registrazione funziona lo stesso). PATTERNMACHINE_MAIL_OUTBOX=<cartella>
# scrive le mail come file .eml invece di spedirle: serve ai test e in locale.
def mail_config():
    cfg = {}
    try:
        with open(MAIL_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        pass
    user = os.environ.get("PATTERNMACHINE_SMTP_USER") or cfg.get("user")
    pw = os.environ.get("PATTERNMACHINE_SMTP_PASS") or cfg.get("app_password")
    if not (user and pw) and not os.environ.get("PATTERNMACHINE_MAIL_OUTBOX"):
        return None
    return {"user": user or "patternmachine@localhost", "password": pw or "",
            "from_name": cfg.get("from_name") or "PatternMachine",
            "host": cfg.get("host") or "smtp.gmail.com", "port": int(cfg.get("port") or 465)}


def send_mail(to, subject, text, html_body):
    """Spedisce in un thread: la pagina risponde subito. Gli errori finiscono nel log del servizio."""
    cfg = mail_config()
    if not cfg or not to:
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((cfg["from_name"], cfg["user"]))
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")

    def work():
        outbox = os.environ.get("PATTERNMACHINE_MAIL_OUTBOX")
        try:
            if outbox:
                os.makedirs(outbox, exist_ok=True)
                with open(os.path.join(outbox, f"{time.time():.6f}.eml"), "wb") as f:
                    f.write(bytes(msg))
                return
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20) as smtp:
                smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        except Exception as e:     # noqa: BLE001 - una mail persa non deve fermare il server
            print(f"mail a {to} non spedita: {e}", file=sys.stderr, flush=True)
    threading.Thread(target=work, daemon=True).start()
    return True


# ---------- segnalazioni ("Segnala un problema") ----------
# Vanno al bot Telegram dell'admin: telegram.json accanto a server.py (mai servito, creato da
# scripts/set-telegram.py): {"token", "chat_id"}. Se il bot non e' configurato o non risponde, la
# segnalazione arriva per mail agli admin con un indirizzo. PATTERNMACHINE_TELEGRAM_OUTBOX=<cartella>
# scrive i messaggi come file invece di spedirli: serve ai test.
def telegram_config():
    try:
        with open(TELEGRAM_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        cfg = {}
    token = os.environ.get("PATTERNMACHINE_TELEGRAM_TOKEN") or cfg.get("token")
    chat = os.environ.get("PATTERNMACHINE_TELEGRAM_CHAT") or cfg.get("chat_id")
    if os.environ.get("PATTERNMACHINE_TELEGRAM_OUTBOX"):
        return {"token": token or "", "chat_id": chat or ""}
    return {"token": token, "chat_id": str(chat)} if token and chat else None


def send_telegram(text):
    """Spedisce subito (chi segnala deve sapere se e' arrivata). False se non configurato o in errore."""
    cfg = telegram_config()
    if not cfg:
        return False
    outbox = os.environ.get("PATTERNMACHINE_TELEGRAM_OUTBOX")
    if outbox:
        os.makedirs(outbox, exist_ok=True)
        with open(os.path.join(outbox, f"{time.time():.6f}.txt"), "w", encoding="utf-8") as f:
            f.write(text)
        return True
    body = json.dumps({"chat_id": cfg["chat_id"], "text": text[:4000], "disable_web_page_preview": True}).encode()
    req = Request(f"https://api.telegram.org/bot{cfg['token']}/sendMessage", data=body,
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode()).get("ok", False)
    except Exception as e:     # noqa: BLE001 - il token non va nel log, solo il tipo di errore
        print(f"segnalazione su Telegram non spedita: {type(e).__name__}", file=sys.stderr, flush=True)
        return False


def report_text(fields, account):
    who = fields["name"] or "(no name)"
    if fields["email"]:
        who += f" <{fields['email']}>"
    acct = "guest" if account.get("role") == "guest" else f"account {account.get('name', '?')}"
    lines = ["Problem report from PatternMachine", f"From: {who} ({acct})"]
    if fields["page"]:
        lines.append(f"Page: {fields['page']}")
    lines += ["", fields["message"]]
    if fields["info"]:
        lines += ["", "---", fields["info"]]
    return "\n".join(lines)


try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo("Europe/Rome")
except Exception:  # senza tzdata le date restano in UTC
    LOCAL_TZ = timezone.utc


def local_time(stamp):
    """'2026-09-27T17:40:00+00:00' -> '27/09/2026 19:40' (ora italiana); il testo com'e' se non si legge."""
    try:
        return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone(LOCAL_TZ).strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return str(stamp or "")


def all_downloads(users):
    """Tutti i download registrati, dal piu' recente: (utente, download)."""
    rows = [(u, d) for u in users for d in (u.get("downloads") or [])]
    return sorted(rows, key=lambda r: str(r[1].get("at") or ""), reverse=True)


def registration_text(user):
    lines = ["New user signed up on PatternMachine", f"Name: {user['name']}"]
    if user.get("email"):
        lines.append(f"Email: {user['email']}")
    lines.append(f"Date: {user.get('created_at', now_iso())}")
    return "\n".join(lines)


def send_report_mail(text):
    admins = [u["email"] for u in load_users().get("users", []) if u.get("role") == "admin" and u.get("email")]
    if not admins or not mail_config():
        return False
    body = "<pre style=\"font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif;white-space:pre-wrap;\">" + html.escape(text) + "</pre>"
    return all(send_mail(a, "PatternMachine: problem report", text, body) for a in admins)


# Logo di tongatron.org in linea, nell'arancio dei pulsanti del sito, testo bianco.
TONGATRON_BADGE = ('<a href="https://tongatron.org/" style="display:inline-flex;align-items:center;gap:10px;'
                   'background:#c8471f;background-image:linear-gradient(180deg,#e0743f,#b8471f);color:#fff;padding:5px 12px;border-radius:999px;text-decoration:none;'
                   'font:700 14px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">'
                   '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#fff;'
                   'flex-shrink:0;"></span>tongatron.org</a>')


def mail_html(title, intro, button_text, button_url, rows=(), outro=""):
    e = html.escape
    table = "".join(f'<tr><td style="padding:6px 14px 6px 0;color:#6b6f75;">{e(k)}</td>'
                    f'<td style="padding:6px 0;font-weight:700;">{e(v)}</td></tr>' for k, v in rows)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;background:#eceae4;padding:24px 12px;
font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1d20;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:26px 24px;">
<div style="font:700 15px ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;">PatternMachine</div>
<div style="height:2px;background:#c8471f;margin:8px 0 20px;"></div>
<h1 style="font-size:19px;margin:0 0 10px;">{e(title)}</h1>
<p style="font-size:14px;line-height:1.55;margin:0 0 16px;">{e(intro)}</p>
{f'<table style="font-size:14px;border-collapse:collapse;margin:0 0 20px;">{table}</table>' if rows else ''}
<a href="{e(button_url)}" style="display:inline-block;background:#c8471f;background-image:linear-gradient(180deg,#e0743f,#b8471f);color:#fff;text-decoration:none;font-weight:700;
letter-spacing:.08em;text-transform:uppercase;font-size:13px;padding:13px 22px;border-radius:9px;">{e(button_text)}</a>
{f'<p style="font-size:12px;line-height:1.5;color:#6b6f75;margin:20px 0 0;">{e(outro)}</p>' if outro else ''}
<div style="border-top:1px solid #e3e1db;margin:24px 0 0;padding:18px 0 0;text-align:center;">{TONGATRON_BADGE}</div>
</div></body></html>"""


def send_welcome(user, password):
    rows = [("Name", user["name"]), ("Password", password), ("Email", user["email"])]
    text = (f"Hi {user['name']}, welcome to PatternMachine!\n\n"
            f"Name: {user['name']}\nPassword: {password}\nEmail: {user['email']}\n\nSign in: {SITE_URL}/login\n")
    return send_mail(user["email"], "Welcome to PatternMachine",
                     text, mail_html(f"Welcome, {user['name']}!", "Your account is ready. These are your credentials:",
                                     "Open PatternMachine", SITE_URL + "/login", rows,
                                     "Keep this email: if you forget your password you can reset it from the sign-in page."))


def send_reset(user, token):
    url = f"{SITE_URL}/reset?token={token}"
    text = (f"Hi {user['name']},\n\nto choose a new password open this link (valid for one hour):\n{url}\n\n"
            "If you didn't ask for this, ignore this email: your password stays the same.\n")
    return send_mail(user["email"], "PatternMachine: new password", text,
                     mail_html("New password", f"Hi {user['name']}, use the button below to choose a new password. The link is valid for one hour and works only once.",
                               "Choose a new password", url, (),
                               "If you didn't ask for this, ignore this email: your password stays the same."))


# Pagine di accesso (login, registrazione, recupero, admin): un solo guscio, {title} e {body} cambiano.
PAGE_SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#a3a097">
<title>PATTERN-MACHINE — {title}</title>
<meta name="description" content="Step drum machine in the browser with 14 classic machines, from the SP-1200 and TR-808 to the TR-909 and RX-5. Patterns, songs and MIDI, WAV and MP3 export.">
<!-- Anteprima dei link: chi condivide un link arriva qui (il sito e' dietro accesso), quindi i tag stanno in questa pagina. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="PATTERN-MACHINE">
<meta property="og:title" content="PATTERN-MACHINE — drum machines and patterns in the browser">
<meta property="og:description" content="Step drum machine in the browser with 14 classic machines, from the SP-1200 and TR-808 to the TR-909 and RX-5. Patterns, songs and MIDI, WAV and MP3 export.">
<meta property="og:image" content="https://patternmachine.tongatron.org/assets/og-pattern-machine.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="PATTERN-MACHINE, drum machines and patterns in the browser: SP-1200, TR-808, TR-909, RX-5, LinnDrum, TR-707, DMX, CR-78, TR-606, Drumulator, TR-727, SDS-V, DrumTraks, CR-8000">
<meta property="og:url" content="https://patternmachine.tongatron.org/">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="PATTERN-MACHINE — drum machines and patterns in the browser">
<meta name="twitter:image" content="https://patternmachine.tongatron.org/assets/og-pattern-machine.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
/* Stessi colori e materiali della drum machine: scocca grigia, pannelli chiari, tasti in rilievo, arancio. */
:root{--bg:#a3a097;--panel:#e2dfd6;--panel-2:#f4f2ec;--edge:#55534b;--edge-soft:#8f8c83;--text:#1c1b19;--dim:#3a3833;
  --accent:#c8471f;--ok:#c8471f;--on-ok:#fff6ee;--danger:#b83a30;
  --plate:linear-gradient(180deg,#e2dfd6,#cfccc2);--key:linear-gradient(180deg,#dcd9cf,#b5b2a8);
  --key-primary:linear-gradient(180deg,#e0743f,#b8471f);--key-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 1px 0 rgba(0,0,0,.35);
  --shadow:inset 0 1px 0 rgba(255,255,255,.65),inset 0 -1px 0 rgba(0,0,0,.18),0 2px 0 rgba(0,0,0,.25),0 18px 40px rgba(0,0,0,.18);
  color-scheme:light;}
*{box-sizing:border-box}
html{background:#9a978e;}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  background:linear-gradient(180deg,#adaaa1,#9a978e);color:var(--text);
  font-family:"SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));}
.brand{width:min(380px,100%);text-align:center;margin-bottom:4px;}
.brand .logo{display:block;font-size:22px;font-weight:800;line-height:1.1;letter-spacing:.22em;text-transform:uppercase;color:var(--text);text-decoration:none;}
.brand .tagline{margin:8px 0 0;font-size:11px;color:var(--dim);letter-spacing:.04em;}
.pads{display:flex;justify-content:center;gap:4px;margin-top:12px;}
.pads i{width:14px;height:14px;border-radius:2px;border:1px solid var(--edge-soft);background:linear-gradient(180deg,#f1eee6,#d9d6cc);}
.pads i.on{background:linear-gradient(180deg,#f58a4c,#d45a24);border-color:#a1421b;}
.card{width:min(380px,100%);background:var(--plate);border:1px solid var(--edge);border-radius:4px;padding:22px 22px 20px;box-shadow:var(--shadow);}
.card.wide{width:min(760px,100%);}
h1{margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);}
.line{height:1px;background:var(--accent);margin:0 0 16px;}
p{margin:0 0 14px;font-size:12px;color:var(--dim);line-height:1.55;}
label{display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin:12px 0 6px;}
label .opt{text-transform:none;letter-spacing:0;}
input{width:100%;font:inherit;font-size:16px;padding:11px 12px;border-radius:3px;border:1px solid var(--edge-soft);
  background:var(--panel-2);color:var(--text);box-shadow:inset 0 1px 2px rgba(0,0,0,.12);}
textarea{width:100%;min-height:100px;resize:vertical;font:inherit;font-size:14px;line-height:1.45;padding:11px 12px;border-radius:3px;border:1px solid var(--edge-soft);
  background:var(--panel-2);color:var(--text);}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent);}
button,.btn{display:inline-block;width:100%;margin-top:16px;font:inherit;font-size:13px;font-weight:800;letter-spacing:.12em;
  text-transform:uppercase;padding:12px;border-radius:3px;border:1px solid #8a3418;background:var(--key-primary);color:var(--on-ok);cursor:pointer;
  text-align:center;text-decoration:none;box-shadow:var(--key-shadow);transition:transform .08s,filter .15s;}
button:hover,.btn:hover{filter:brightness(1.06);}
button:active,.btn:active{transform:translateY(1px);}
button.small,.btn.small{width:auto;margin:0;padding:6px 10px;font-size:10px;letter-spacing:.08em;}
button.ghost,.btn.ghost{background:var(--key);color:var(--text);border:1px solid var(--edge);}
button.ghost:hover,.btn.ghost:hover{color:var(--accent);border-color:var(--accent);filter:none;}
button.danger{background:var(--danger);color:#fff;border-color:#7d1b16;}
.err{color:var(--danger);font-size:12px;margin:10px 0 0;min-height:1em;}
.err:empty{margin:0;min-height:0;}
.ok{color:#2f6f3b;font-size:12px;margin:0 0 12px;line-height:1.5;}
.links{display:flex;justify-content:space-between;gap:10px;margin-top:16px;font-size:11px;}
.or{display:flex;align-items:center;gap:10px;margin:18px 0 0;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);}
.or::before,.or::after{content:"";flex:1;height:1px;background:var(--edge-soft);}
.or + .btn{margin-top:12px;}
.guest{width:min(380px,100%);text-align:center;}
.guest button{margin-top:0;}
.guest p{margin:8px 0 0;font-size:11px;}
.about{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;}
a{color:var(--accent);}
table{width:100%;border-collapse:collapse;font-size:12px;}
th{text-align:left;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);padding:6px 8px 6px 0;border-bottom:1px solid var(--edge);}
td{padding:8px 8px 8px 0;border-bottom:1px solid var(--edge-soft);vertical-align:middle;}
td form{display:inline;}
.row-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
.tag{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);}
.table-wrap{overflow-x:auto;}
.admin-bar{width:min(760px,100%);display:flex;justify-content:space-between;gap:10px;}
.site-footer{margin-top:10px;display:flex;flex-direction:column;align-items:center;gap:12px;}
.site-footer a{transition:transform .2s;}
.site-footer a:hover{transform:translateY(-1px);}
code{word-break:break-all;font-size:12px;background:var(--panel-2);padding:8px;border-radius:3px;display:block;margin:0 0 12px;}
</style>
<script defer src="https://analytics.tongatron.org/script.js" data-website-id="9daa93b6-2afb-494a-89fb-288437a030d1" data-domains="patternmachine.tongatron.org"></script>
</head>
<body>
<script>
// Trasloco dal vecchio indirizzo: i dati arrivano nel frammento #trasloco=..., che il login perderebbe.
if(location.hash.startsWith("#trasloco=")){ try{ sessionStorage.setItem("trasloco", location.hash.slice(10)); }catch(e){} }
</script>
{body}
{footer}
</body>
</html>
"""


# Pagina servita sul vecchio indirizzo: legge i dati salvati nel browser per quel dominio, li comprime
# e li passa al nuovo indirizzo nel frammento (#), che non arriva a nessun server.
TRASLOCO_PAGE = r"""<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>PatternMachine — nuovo indirizzo</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15171a;color:#e9e6de;
font:14px/1.6 ui-monospace,Menlo,monospace;padding:16px;text-align:center}a{color:#3b8fd6}</style></head>
<body><p>Drum Machine Lab ora si chiama <b>PatternMachine</b>.<br>Trasferisco progetti e preferiti al nuovo indirizzo&hellip;<br>
<a id="go" href="{site}">{site}</a></p>
<script>
(async function(){
  const dest="{site}"+location.pathname+location.search;
  const data={};
  try{ for(const k of ["sp1200.projects","sp1200.favorites","sp1200.theme"]){ const v=localStorage.getItem(k); if(v) data[k]=v; } }catch(e){}
  let hash="";
  if(Object.keys(data).length){
    try{
      const bytes=new TextEncoder().encode(JSON.stringify(data));
      const gz=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      let bin=""; new Uint8Array(gz).forEach(b=>bin+=String.fromCharCode(b));
      hash="#trasloco="+btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    }catch(e){}
  }
  try{ const regs=await navigator.serviceWorker?.getRegistrations(); for(const r of regs||[]) await r.unregister(); }catch(e){}
  document.getElementById("go").href=dest+hash;
  location.replace(dest+hash);
})();
</script></body></html>
"""

# Service worker del vecchio indirizzo: sostituisce quello installato, svuota le cache e si disinstalla,
# cosi' l'app installata non resta ferma alla copia vecchia e al prossimo avvio passa dal trasloco.
RETIRED_SW = """self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil((async()=>{
  for(const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for(const c of await self.clients.matchAll({type:"window"})) c.navigate(c.url);
})()));
"""


class BodyTooLarge(Exception):
    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "PatternMachine/1.4"

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
    def _read_body(self, limit=MAX_BODY):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return None
        if length > limit:
            raise BodyTooLarge()
        return self.rfile.read(length) if length > 0 else b""

    def _read_json_body(self, limit=MAX_BODY):
        raw = self._read_body(limit)
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

    def _old_host(self):
        """True se la richiesta arriva al vecchio indirizzo: in quel caso ha gia' risposto."""
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").split(":")[0].lower()
        if host not in OLD_HOSTS:
            return False
        path = urlparse(self.path).path
        if self.command == "GET" and path == "/sw.js":
            body = RETIRED_SW.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        elif self.command == "GET" and (path == "/" or path.endswith(".html")
                                        or "text/html" in (self.headers.get("Accept") or "")):
            self._send_html(200, TRASLOCO_PAGE.replace("{site}", SITE_URL))
        else:
            self.send_response(308)
            self.send_header("Location", SITE_URL + self.path)
            self.send_header("Content-Length", "0")
            self.end_headers()
        return True

    def _user(self):
        """L'utente della sessione (una lettura di users.json per richiesta), o None."""
        if not hasattr(self, "_cached_user"):
            with USERS_LOCK:
                self._cached_user = session_user(load_users(), self._cookie(SESSION_COOKIE))
        return self._cached_user

    def _authorized(self):
        return self._user() is not None

    def _gate(self, path):
        """True se la richiesta puo' proseguire; altrimenti ha gia' risposto."""
        embed_home = path == "/" and parse_qs(urlparse(self.path).query).get("embed") == ["1"]
        if path in OPEN_PATHS or embed_home or path.startswith(OPEN_DIRS) or self._authorized():
            return True
        if self.command == "GET" and path.startswith("/download/"):
            self._page(401, "Members-only download", """<div class="card">
  <h1>Members-only download</h1>
  <div class="line"></div>
  <p>To download the apps, create an account or sign in first.</p>
  <div class="links"><a class="btn" href="/login?next=/app.html">Sign in</a><a class="btn ghost" href="/register?next=/app.html">Create an account</a></div>
</div>""")
            return False
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
        if (self._user() or {}).get("role") == "guest":
            self._send_json(403, {"error": "gli ospiti non possono salvare: registrati"})
            return False
        return True

    def _body_or_error(self, limit=MAX_BODY):
        try:
            return self._read_json_body(limit), False
        except BodyTooLarge:
            self._send_json(413, {"error": "richiesta troppo grande"})
            return None, True

    # ---------- accesso ----------
    def _page(self, status, title, body, badge=True):
        footer = f'<footer class="site-footer"><a href="/privacy.html">Privacy policy</a>{TONGATRON_BADGE}</footer>' if badge else ""
        self._send_html(status, PAGE_SHELL.replace("{title}", html.escape(title)).replace("{body}", body).replace("{footer}", footer))

    def _form(self):
        """Il form inviato (dict di stringhe), o None se ha gia' risposto (altro sito, troppo grande)."""
        if self._cross_site():
            self._send_json(403, {"error": "richiesta da un altro sito"})
            return None
        try:
            raw = self._read_body() or b""
        except BodyTooLarge:
            self._send_json(413, {"error": "richiesta troppo grande"})
            return None
        return {k: v[0] for k, v in parse_qs(raw.decode("utf-8", "replace"), keep_blank_values=True).items()}

    def _login_page(self, status=200, error="", next_path="/", name="", note=""):
        e = html.escape
        nxt = e(safe_next(next_path), quote=True)
        q = "" if safe_next(next_path) == "/" else "?next=" + quote(safe_next(next_path), safe="")
        self._page(status, "Sign in", f"""<header class="brand">
  <a class="logo" href="/landing.html">Pattern-Machine</a>
  <p class="tagline">Step drum machine · patterns · songs · MIDI, WAV, MP3 export</p>
  <div class="pads" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i><i class="on"></i><i></i><i></i><i class="on"></i><i class="on"></i><i></i><i></i><i></i><i class="on"></i><i></i><i></i><i></i></div>
</header>
<form class="card" method="post" action="/login">
  <h1>Sign in</h1>
  <div class="line"></div>
  {f'<p class="ok">{e(note)}</p>' if note else '<p>Sign in with your name (or email) and your password.</p>'}
  <label for="nm">Name or email</label>
  <input id="nm" name="name" autocomplete="username" placeholder="Steve or steve@example.com" value="{e(name, quote=True)}" {'' if name else 'autofocus'} required>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" {'autofocus' if name else ''} required>
  <input type="hidden" name="next" value="{nxt}">
  <button type="submit">Sign in</button>
  <div class="err" role="alert">{e(error)}</div>
  <div class="links"><span></span><a href="/forgot">Forgot your password?</a></div>
  <div class="or">New here?</div>
  <a class="btn ghost" href="/register{q}">Create an account</a>
</form>
<form class="card guest" method="post" action="/guest" style="padding:14px 22px;" onsubmit="try{{sessionStorage.setItem('guestWelcome','1')}}catch(e){{}}">
  <input type="hidden" name="next" value="{nxt}">
  <button type="submit">Try it without an account</button>
  <p>As a guest you can't save your patterns or download the apps.</p>
</form>
<a class="about" href="/landing.html">What is PATTERN-MACHINE? →</a>""")

    def _do_login(self):
        form = self._form()
        if form is None:
            return
        next_path = safe_next(form.get("next", "/"))
        name = form.get("name", "").strip()
        ip = self._client_ip()
        if too_many(ip, "login"):
            self._login_page(429, "Too many attempts. Try again in a few minutes.", next_path, name)
            return
        with USERS_LOCK:
            db = load_users()
            user = next((u for u in login_candidates(db, name) if check_password(u, form.get("password", ""))), None)
            ok = user is not None
            if ok:
                user["last_login"] = now_iso()
                cookie = make_session(users_secret(db), user)
                save_users(db)
        if not ok:
            note(ip, "login")
            time.sleep(0.4)
            self._login_page(401, "Wrong name, email or password.", next_path, name)
            return
        self._redirect(next_path, [self._session_cookie(cookie, SESSION_DAYS * 86400)])

    def _do_guest(self):
        form = self._form()
        if form is None:
            return
        with USERS_LOCK:
            db = load_users()
            fresh = not db.get("secret")
            cookie = make_guest_session(users_secret(db))
            if fresh:
                save_users(db)
        self._redirect(safe_next(form.get("next", "/")), [self._session_cookie(cookie, SESSION_DAYS * 86400)])

    def _register_page(self, status=200, error="", next_path="/", name="", email=""):
        e = html.escape
        self._page(status, "Create an account", f"""<form class="card" method="post" action="/register">
  <h1>PATTERN-MACHINE</h1>
  <div class="line"></div>
  <label for="nm">Name</label>
  <input id="nm" name="name" autocomplete="username" maxlength="{MAX_USERNAME}" placeholder="Steve" value="{e(name, quote=True)}" autofocus required>
  <label for="em">Email</label>
  <input id="em" name="email" type="email" autocomplete="email" placeholder="steve@example.com" value="{e(email, quote=True)}" required>
  <p style="margin:6px 0 0;font-size:11px;">We'll email you your credentials, and you'll need it to reset your password.</p>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="new-password" required>
  <input type="hidden" name="next" value="{e(safe_next(next_path), quote=True)}">
  <button type="submit">Create account</button>
  <div class="err" role="alert">{e(error)}</div>
  <div class="links"><a href="/login{'' if safe_next(next_path) == '/' else '?next=' + quote(safe_next(next_path), safe='')}">Already have an account? Sign in</a><a href="/landing.html">What is PATTERN-MACHINE?</a></div>
</form>""")

    def _do_register(self):
        form = self._form()
        if form is None:
            return
        next_path = safe_next(form.get("next", "/"))
        raw_name, email, password = form.get("name", ""), form.get("email", "").strip(), form.get("password", "")
        ip = self._client_ip()
        name = clean_name(raw_name)
        err = ("Too many sign-ups from this network. Try again in a few minutes." if too_many(ip, "register")
               else f"The name must be 1 to {MAX_USERNAME} characters long." if not name
               else "Enter your email." if not email
               else "Invalid email." if not EMAIL_RE.match(email)
               else "Choose a password." if not password else "")
        if not err:
            with USERS_LOCK:
                db = load_users()
                if find_user(db, name=name):
                    err = "This name is already taken: choose another one."
                else:
                    user = new_user(name, password, email)
                    user["last_login"] = now_iso()
                    db["users"].append(user)
                    cookie = make_session(users_secret(db), user)
                    save_users(db)
        if err:
            self._register_page(400, err, next_path, raw_name.strip(), email)
            return
        note(ip, "register")
        send_welcome(user, password)
        threading.Thread(target=send_telegram, args=(registration_text(user),), daemon=True).start()
        self._redirect(next_path, [self._session_cookie(cookie, SESSION_DAYS * 86400)])

    def _forgot_page(self, status=200, error="", done=False):
        e = html.escape
        body = ("""<p class="ok">If the account has an email address, we've sent you a message: open the link inside it (valid for one hour).
  If you didn't give an email when you signed up, ask the administrator.</p>
  <a class="btn ghost" href="/login">Back to sign in</a>""" if done else f"""<p>Enter your account name or email: we'll send you a link to choose a new password.</p>
  <label for="who">Name or email</label>
  <input id="who" name="who" autocomplete="username" placeholder="Steve or steve@example.com" autofocus required>
  <button type="submit">Send me the link</button>
  <div class="err" role="alert">{e(error)}</div>
  <div class="links"><a href="/login">Back to sign in</a></div>""")
        self._page(status, "Forgot password", f"""<form class="card" method="post" action="/forgot">
  <h1>PATTERN-MACHINE</h1>
  <div class="line"></div>
  {body}
</form>""")

    def _do_forgot(self):
        form = self._form()
        if form is None:
            return
        who = form.get("who", "").strip()
        ip = self._client_ip()
        if too_many(ip, "forgot"):
            self._forgot_page(429, "Too many requests. Try again in a few minutes.")
            return
        note(ip, "forgot")
        if not mail_config():
            self._forgot_page(503, "Password recovery by email is not active: ask the administrator.")
            return
        with USERS_LOCK:
            db = load_users()
            targets = [u for u in db["users"] if u.get("email") and
                       (name_key(u["name"]) == name_key(who) or u["email"].casefold() == who.casefold())]
            tokens = [(u, make_reset(db, u)) for u in targets]
            if tokens:
                save_users(db)
        for u, token in tokens:
            send_reset(u, token)
        # stessa risposta che l'account esista o no: nessuno scopre chi e' registrato
        self._forgot_page(done=True)

    def _reset_page(self, status=200, token="", error="", name=""):
        e = html.escape
        if not name:
            self._page(status, "New password", """<div class="card">
  <h1>PATTERN-MACHINE</h1>
  <div class="line"></div>
  <p>The link is invalid or has expired (it's valid for one hour and works only once).</p>
  <a class="btn" href="/forgot">Ask for a new link</a>
</div>""")
            return
        self._page(status, "New password", f"""<form class="card" method="post" action="/reset">
  <h1>PATTERN-MACHINE</h1>
  <div class="line"></div>
  <p>Hi <b>{e(name)}</b>, choose your new password.</p>
  <label for="pw">New password</label>
  <input id="pw" name="password" type="password" autocomplete="new-password" autofocus required>
  <input type="hidden" name="token" value="{e(token, quote=True)}">
  <button type="submit">Save and sign in</button>
  <div class="err" role="alert">{e(error)}</div>
</form>""")

    def _do_reset(self):
        form = self._form()
        if form is None:
            return
        token, password = form.get("token", ""), form.get("password", "")
        with USERS_LOCK:
            db = load_users()
            user = reset_user(db, token)
            if user and password:
                set_user_password(user, password)
                user["last_login"] = now_iso()
                db["resets"] = [r for r in db["resets"] if r["uid"] != user["id"]]
                cookie = make_session(users_secret(db), user)
                save_users(db)
        if not user:
            self._reset_page(400)
        elif not password:
            self._reset_page(400, token, "Choose a password.", user["name"])
        else:
            self._redirect("/", [self._session_cookie(cookie, SESSION_DAYS * 86400)])

    # ---------- amministrazione ----------
    def _admin_page(self, status=200, message="", confirm=None, link=""):
        e = html.escape
        me = self._user()
        with USERS_LOCK:
            users = sorted(load_users()["users"], key=lambda u: u["created_at"])
        app_msg = load_app_message_admin()
        app_expires = str(app_msg.get("expires") or "")
        if app_expires.endswith("Z"):
            app_expires = app_expires[:-1]
        app_expires = app_expires[:16] if len(app_expires) >= 16 else app_expires
        app_status = "active" if load_app_message().get("show") else "not active"
        app_section = f"""<div class="card wide" style="margin:0 0 16px;">
  <h2 style="margin:0 0 4px;font-size:16px;">In-app message</h2>
  <p>Publish a notice shown when the macOS app starts. Current status: <b>{app_status}</b>.</p>
  <form method="post" action="/admin/app-message">
    <label for="app-title">Title</label>
    <input id="app-title" name="title" maxlength="160" value="{e(str(app_msg.get('title') or ''), quote=True)}" required>
    <label for="app-message">Message</label>
    <textarea id="app-message" name="message" maxlength="2000" required>{e(str(app_msg.get('message') or ''))}</textarea>
    <label for="app-url">Link</label>
    <input id="app-url" name="url" type="url" value="{e(str(app_msg.get('url') or (SITE_URL + '/app.html')), quote=True)}" required>
    <label for="app-expires">Expires <span class="opt">(optional)</span></label>
    <input id="app-expires" name="expires" type="datetime-local" value="{e(app_expires, quote=True)}">
    <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;">
      <input name="enabled" type="checkbox" style="width:auto;margin:0;" {'checked' if app_msg.get('enabled', False) else ''}> Show the message in the app
    </label>
    <button type="submit">Publish message</button>
  </form>
</div>"""
        top = ""
        if confirm:
            top = f"""<div class="card" style="width:100%;margin:0 0 16px;box-shadow:none;">
  <p>Delete the user <b>{e(confirm['name'])}</b>? Their projects stay in their browser, but they won't be able to sign in again. This can't be undone.</p>
  <form method="post" action="/admin/delete" style="display:flex;gap:8px;">
    <input type="hidden" name="id" value="{e(confirm['id'], quote=True)}">
    <a class="btn ghost small" href="/admin">Cancel</a>
    <button class="danger small" type="submit">Delete</button>
  </form></div>"""
        rows = []
        for u in users:
            acts = []
            if u["id"] != me["id"]:
                acts.append(f'<form method="post" action="/admin/reset"><input type="hidden" name="id" value="{e(u["id"], quote=True)}">'
                            f'<button class="ghost small" type="submit">{"Send reset" if u.get("email") else "Reset link"}</button></form>')
                acts.append(f'<a class="btn ghost small" href="/admin?elimina={e(u["id"], quote=True)}">Delete</a>')
            rows.append(f"""<tr><td><b>{e(u['name'])}</b> {'<span class="tag">admin</span>' if u.get('role') == 'admin' else ''}</td>
<td>{e(u.get('email') or '—')}</td><td>{e(u['created_at'][:10])}</td><td>{e((u.get('last_login') or '—')[:10])}</td>
<td><div class="row-acts">{''.join(acts)}</div></td></tr>""")
        downloads = all_downloads(users)
        if downloads:
            per_app = {}
            for _, d in downloads:
                app = d.get("platform") or d.get("file") or "app"
                per_app[app] = per_app.get(app, 0) + 1
            people = len({u["id"] for u, _ in downloads})
            summary = " · ".join(f"{e(app)} <b>{n}</b>" for app, n in sorted(per_app.items()))
            dl_rows = "".join(
                f"<tr><td>{e(local_time(d.get('at')))}</td><td><b>{e(u['name'])}</b></td>"
                f"<td>{e(d.get('platform') or 'app')}</td><td>{e(d.get('file') or '')}</td></tr>"
                for u, d in downloads[:200])
            more = f"<p style=\"margin:10px 0 0;\">Showing the latest 200 of {len(downloads)}.</p>" if len(downloads) > 200 else ""
            dl_body = f"""<p>{len(downloads)} {'download' if len(downloads) == 1 else 'downloads'} by {people} {'user' if people == 1 else 'users'}: {summary}.</p>
  <div class="table-wrap"><table>
    <tr><th>When</th><th>User</th><th>App</th><th>File</th></tr>
    {dl_rows}
  </table></div>{more}"""
        else:
            dl_body = "<p>No downloads recorded yet.</p>"
        downloads_section = f"""<div class="card wide" style="margin:0 0 16px;">
  <h2 style="margin:0 0 4px;font-size:16px;">App downloads</h2>
  {dl_body}
</div>"""
        msg_html = f'<p class="ok">{e(message)}</p>' if message else ""
        link_html = ("<p>New password link (valid for one hour, send it to the user yourself):</p>"
                     f"<code>{e(link)}</code>") if link else ""
        self._page(status, "Users", f"""<nav class="admin-bar">
  <a class="btn ghost small" href="/">&larr; Back to PatternMachine</a>
  <a class="btn ghost small" href="/logout">Sign out</a>
</nav>
<div class="card wide">
  <h1>Users</h1>
  <div class="line"></div>
  {msg_html}{link_html}{top}
  <div class="table-wrap"><table>
    <tr><th>Name</th><th>Email</th><th>Signed up</th><th>Last sign-in</th><th></th></tr>
    {''.join(rows)}
  </table></div>
</div>
{downloads_section}
{app_section}""", badge=False)

    def _admin_only(self):
        user = self._user()
        if user and user.get("role") == "admin":
            return True
        self.send_error(403, "Administrators only")
        return False

    def _do_admin(self, action):
        form = self._form()
        if form is None:
            return
        me = self._user()
        with USERS_LOCK:
            db = load_users()
            target = find_user(db, uid=form.get("id", ""))
            if not target or target["id"] == me["id"]:
                self._redirect("/admin")
                return
            if action == "delete":
                db["users"] = [u for u in db["users"] if u["id"] != target["id"]]
                db["resets"] = [r for r in db["resets"] if r["uid"] != target["id"]]
                token = None
            else:
                token = make_reset(db, target)
            save_users(db)
        if action == "delete":
            with PROJECTS_LOCK:
                delete_user_projects(target["id"])
            self._admin_page(message=f"User {target['name']} deleted.")
        elif target.get("email") and mail_config():
            send_reset(target, token)
            self._admin_page(message=f"Email with the new password link sent to {target['name']}.")
        else:
            self._admin_page(link=f"{SITE_URL}/reset?token={token}")

    def _do_app_message(self):
        form = self._form()
        if form is None:
            return
        title = " ".join(form.get("title", "").split())[:160]
        message = form.get("message", "").strip()[:2000]
        target = form.get("url", "").strip()
        expires = form.get("expires", "").strip()
        if not title or not message:
            self._admin_page(400, "Enter a title and a message.")
            return
        base = urlparse(SITE_URL)
        link = urlparse(target)
        if link.scheme not in ("http", "https") or link.netloc != base.netloc:
            self._admin_page(400, "The link must point to the PatternMachine site.")
            return
        expires_out = ""
        if expires:
            try:
                deadline = datetime.fromisoformat(expires.replace("Z", "+00:00"))
                if deadline.tzinfo is None:
                    deadline = deadline.replace(tzinfo=timezone.utc)
                expires_out = deadline.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            except ValueError:
                self._admin_page(400, "The expiry date is not valid.")
                return
        data = {"id": "admin-" + uuid.uuid4().hex, "title": title, "message": message, "url": target,
                "expires": expires_out, "enabled": form.get("enabled") == "on"}
        try:
            os.makedirs(os.path.dirname(APP_MESSAGE_FILE) or ".", exist_ok=True)
            tmp = APP_MESSAGE_FILE + ".tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, APP_MESSAGE_FILE)
        except OSError:
            self._admin_page(500, "Couldn't save the message on the server.")
            return
        self._admin_page(message="Message published in the app." if data["enabled"] else "Message turned off.")

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
        if rel.startswith("download/") and os.path.basename(rel) in DOWNLOAD_PLATFORMS:
            user = self._user()
            if not user or user.get("role") == "guest":
                self._page(403, "Members-only download", """<div class="card">
  <h1>Members-only download</h1>
  <div class="line"></div>
  <p>To download the apps you need a registered account.</p>
  <div class="links"><a class="btn" href="/login?next=/app.html">Sign in</a><a class="btn ghost" href="/register?next=/app.html">Create an account</a></div>
</div>""")
                return
            record_download(user["id"], os.path.basename(rel))
        ext = os.path.splitext(full_path)[1].lower()
        size = os.path.getsize(full_path)
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(size))
        cache = "public, max-age=3600" if ext in (".txt", ".xml") else ("private, no-cache" if ext in NO_CACHE_EXT else LONG_CACHE)
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        parsed = urlparse(self.path)
        embed_frame = rel == "embed.html" or (rel == "index.html" and parse_qs(parsed.query).get("embed") == ["1"])
        if ext == ".html" and not embed_frame:
            self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        # a pezzi: lo zip dell'app non passa tutto dalla memoria
        try:
            with open(full_path, "rb") as f:
                shutil.copyfileobj(f, self.wfile, 1024 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            pass   # download interrotto dal browser

    # ---------- metodi ----------
    def do_GET(self):
        if self._old_host():
            return
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path in ("/login", "/register"):
            next_path = (query.get("next") or ["/"])[0]
            if self._authorized() and self._user().get("role") != "guest":
                self._redirect(safe_next(next_path))
            elif path == "/login":
                self._login_page(next_path=next_path)
            else:
                self._register_page(next_path=next_path)
            return
        if path == "/forgot":
            self._forgot_page()
            return
        if path == "/reset":
            token = (query.get("token") or [""])[0]
            with USERS_LOCK:
                user = reset_user(load_users(), token)
            self._reset_page(200 if user else 400, token, name=user["name"] if user else "")
            return
        if path == "/logout":
            self._redirect("/login", [self._session_cookie("", 0)])
            return
        if not self._gate(path):
            return
        if path == "/api/me":
            u = self._user()
            self._send_json(200, {"id": u.get("id", ""), "name": u["name"], "role": u.get("role", "user"), "email": u.get("email", "")})
            return
        if path == "/api/app-message":
            self._send_json(200, load_app_message())
            return
        if path == "/admin":
            if not self._admin_only():
                return
            with USERS_LOCK:
                target = find_user(load_users(), uid=(query.get("elimina") or [""])[0])
            self._admin_page(confirm=target if target and target["id"] != self._user()["id"] else None)
            return
        if path == "/api/patterns":
            with LOCK:
                patterns = load_patterns()
            self._send_json(200, patterns)
            return
        if path == "/api/samples":
            self._sample_list()
            return
        sm = SAMPLE_PATH_RE.match(path)
        if sm:
            self._get_sample(sm.group(1))
            return
        if path == "/api/projects" or PROJECT_ID_RE.match(path):
            self._get_projects(path)
            return
        self._serve_static()

    # ---------- progetti degli utenti ----------
    def _project_owner(self):
        """L'id dell'utente registrato, o None se ha gia' risposto (ospite)."""
        u = self._user() or {}
        if u.get("role") == "guest" or not SAFE_ID_RE.match(u.get("id") or ""):
            self._send_json(403, {"error": "gli ospiti non hanno progetti salvati: registrati"})
            return None
        return u["id"]

    def _get_projects(self, path):
        uid = self._project_owner()
        if not uid:
            return
        with PROJECTS_LOCK:
            projects = load_projects(uid)
        m = PROJECT_ID_RE.match(path)
        if m:
            p = projects.get(m.group(1))
            if not p or p.get("deleted"):
                self._send_json(404, {"error": "progetto non trovato"})
                return
            self._send_json(200, {"id": m.group(1), "rev": p["rev"], "data": p["data"]})
            return
        # l'elenco porta solo id e rev: i contenuti si chiedono uno per uno, solo quelli cambiati
        self._send_json(200, {"projects": [{"id": k, "rev": v.get("rev"), **({"deleted": True} if v.get("deleted") else {})}
                                           for k, v in projects.items()]})

    # ---------- campioni sincronizzati ----------
    def _sample_owner(self):
        u = self._user() or {}
        if u.get("role") == "guest" or not SAFE_ID_RE.match(u.get("id") or ""):
            self._send_json(403, {"error": "gli ospiti non hanno campioni sincronizzati: registrati"})
            return None
        return u["id"]

    def _sample_list(self):
        uid = self._sample_owner()
        if not uid:
            return
        with SAMPLES_LOCK:
            samples = load_samples(uid)
        rows = []
        used = 0
        for sid, item in samples.items():
            if not SAMPLE_ID_RE.match(sid) or not isinstance(item, dict):
                continue
            row = {"id": sid, **{k: item.get(k) for k in ("name", "size", "duration", "mime", "settings", "sha256", "updated_at", "rev", "deleted") if k in item}}
            rows.append(row)
            if not item.get("deleted"):
                used += max(0, int(item.get("size") or 0))
        rows.sort(key=lambda x: (x.get("updated_at") or "", x["id"]))
        self._send_json(200, {"samples": rows, "usedBytes": used, "quotaBytes": MAX_SAMPLE_BYTES})

    def _sample_metadata(self, query, raw_size):
        name = (query.get("name") or ["Sample"])[0].strip()[:60] or "Sample"
        try:
            duration = max(0.0, min(3600.0, float((query.get("duration") or [0])[0])))
        except (TypeError, ValueError):
            duration = 0.0
        mime = (query.get("mime") or [self.headers.get("Content-Type") or "application/octet-stream"])[0].split(";", 1)[0].strip().lower()
        if not mime.startswith("audio/"):
            mime = "application/octet-stream"
        try:
            settings = json.loads((query.get("settings") or ["{}"]) [0])
        except (TypeError, ValueError):
            settings = {}
        if not isinstance(settings, dict):
            settings = {}
        def number(key, fallback):
            try:
                return float(settings.get(key, fallback))
            except (TypeError, ValueError):
                return fallback
        clean_settings = {
            "start": max(0, min(95, number("start", 0))),
            "tune": max(-12, min(12, number("tune", 0))),
            "decay": max(5, min(100, number("decay", 100))),
            "reverse": bool(settings.get("reverse", False)),
            "vol": max(0, min(1.2, number("vol", .8))),
        }
        return {"name": name, "size": raw_size, "duration": duration, "mime": mime, "settings": clean_settings}

    def _get_sample(self, sid):
        uid = self._sample_owner()
        if not uid:
            return
        with SAMPLES_LOCK:
            entry = load_samples(uid).get(sid)
        if not entry or entry.get("deleted"):
            self._send_json(404, {"error": "campione non trovato"})
            return
        try:
            path = sample_blob_path(uid, sid)
        except ValueError:
            self._send_json(404, {"error": "campione non trovato"})
            return
        if not os.path.isfile(path):
            self._send_json(404, {"error": "campione non trovato"})
            return
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", entry.get("mime") or "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile, 1024 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _put_sample(self, sid, query):
        if not self._guard_write():
            return
        if not SAMPLE_ID_RE.match(sid):
            self._send_json(400, {"error": "id campione non valido"})
            return
        uid = self._sample_owner()
        if not uid:
            return
        try:
            raw = self._read_body(MAX_SAMPLE_BYTES)
        except BodyTooLarge:
            self._send_json(413, {"error": "il campione supera il limite di 20 MB"})
            return
        if raw is None or not raw:
            self._send_json(400, {"error": "il campione e' vuoto"})
            return
        digest = hashlib.sha256(raw).hexdigest()
        entry = self._sample_metadata(query, len(raw))
        entry.update({"sha256": digest, "updated_at": now_iso(), "rev": secrets.token_hex(8), "deleted": False})
        try:
            path = sample_blob_path(uid, sid)
        except ValueError:
            self._send_json(400, {"error": "id campione non valido"})
            return
        with SAMPLES_LOCK:
            samples = load_samples(uid)
            current = samples.get(sid) or {}
            used = sum(max(0, int(v.get("size") or 0)) for v in samples.values()
                       if isinstance(v, dict) and not v.get("deleted") and v is not current)
            if used + len(raw) > MAX_SAMPLE_BYTES:
                self._send_json(507, {"error": "spazio campioni esaurito: massimo 20 MB per account"})
                return
            os.makedirs(samples_blob_dir(uid), mode=0o700, exist_ok=True)
            tmp = path + ".tmp-" + secrets.token_hex(5)
            try:
                with open(tmp, "wb") as f:
                    f.write(raw)
                os.chmod(tmp, 0o600)
                os.replace(tmp, path)
                samples[sid] = entry
                save_samples(uid, samples)
            finally:
                try:
                    os.remove(tmp)
                except FileNotFoundError:
                    pass
        self._send_json(200, {"id": sid, **entry})

    def _delete_sample(self, sid):
        if not self._guard_write():
            return
        uid = self._sample_owner()
        if not uid:
            return
        with SAMPLES_LOCK:
            samples = load_samples(uid)
            if sid not in samples:
                self._send_json(404, {"error": "campione non trovato"})
                return
            samples[sid] = {"rev": secrets.token_hex(8), "updated_at": now_iso(), "deleted": True}
            save_samples(uid, samples)
            try:
                os.remove(sample_blob_path(uid, sid))
            except (FileNotFoundError, ValueError):
                pass
        self._send_json(200, {"id": sid, "deleted": True})

    def _put_project(self, pid):
        if not self._guard_write():
            return
        uid = self._project_owner()
        if not uid:
            return
        body, failed = self._body_or_error(MAX_PROJECT_BODY)
        if failed:
            return
        if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
            self._send_json(400, {"error": "richiede {data, base}"})
            return
        base = body.get("base")
        out = put_project(uid, pid, body["data"], base if isinstance(base, str) else None)
        if out is None:
            self._send_json(507, {"error": f"troppi progetti salvati (massimo {MAX_PROJECTS})"})
            return
        new_id, rev, conflict, name = out
        self._send_json(200, {"id": new_id, "rev": rev, "conflict": conflict, "name": name})

    def _delete_project(self, pid):
        if not self._guard_write():
            return
        uid = self._project_owner()
        if not uid:
            return
        with PROJECTS_LOCK:
            projects = load_projects(uid)
            if pid in projects and not projects[pid].get("deleted"):
                projects[pid] = {"rev": secrets.token_hex(8), "updated_at": now_iso(), "deleted": True}
                save_projects(uid, projects)
        self._send_json(200, {"id": pid, "deleted": True})

    def _do_report(self):
        if self._cross_site():
            self._send_json(403, {"error": "richiesta da un altro sito"})
            return
        ip = self._client_ip()
        if too_many(ip, "report"):
            self._send_json(429, {"error": "troppe segnalazioni da questa rete: riprova tra qualche minuto"})
            return
        body, failed = self._body_or_error()
        if failed:
            return
        body = body if isinstance(body, dict) else {}
        clean = lambda k, n: str(body.get(k) or "").strip()[:n]   # noqa: E731
        fields = {"name": clean("name", 80), "email": clean("email", 200), "message": clean("message", 3000),
                  "page": clean("page", 300), "info": clean("info", 600)}
        if not fields["message"]:
            self._send_json(400, {"error": "scrivi il messaggio"})
            return
        if fields["email"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", fields["email"]):
            self._send_json(400, {"error": "la mail non sembra valida"})
            return
        note(ip, "report")
        text = report_text(fields, self._user() or {})
        if send_telegram(text):
            self._send_json(200, {"ok": True, "via": "telegram"})
        elif send_report_mail(text):
            self._send_json(200, {"ok": True, "via": "mail"})
        else:
            self._send_json(503, {"error": "le segnalazioni non sono ancora configurate sul server"})

    def do_POST(self):
        if self._old_host():
            return
        path = urlparse(self.path).path
        routes = {"/login": self._do_login, "/register": self._do_register,
                  "/forgot": self._do_forgot, "/reset": self._do_reset, "/guest": self._do_guest}
        if path in routes:
            routes[path]()
            return
        if not self._gate(path):
            return
        if path == "/admin/app-message":
            if self._admin_only():
                self._do_app_message()
            return
        if path in ("/admin/delete", "/admin/reset"):
            if self._admin_only():
                self._do_admin(path.rsplit("/", 1)[1])
            return
        if path == "/api/report":
            self._do_report()
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
        if self._old_host():
            return
        path = urlparse(self.path).path
        if not self._gate(path):
            return
        pm = PROJECT_ID_RE.match(path)
        if pm:
            self._put_project(pm.group(1))
            return
        sm = SAMPLE_PATH_RE.match(path)
        if sm:
            self._put_sample(sm.group(1), parse_qs(urlparse(self.path).query))
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
        if self._old_host():
            return
        path = urlparse(self.path).path
        if not self._gate(path):
            return
        pm = PROJECT_ID_RE.match(path)
        if pm:
            self._delete_project(pm.group(1))
            return
        sm = SAMPLE_PATH_RE.match(path)
        if sm:
            self._delete_sample(sm.group(1))
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
