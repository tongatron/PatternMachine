#!/usr/bin/env python3
"""Coerenza del sito: ogni file che la pagina usa deve esistere, stare nella cache offline
e poter essere servito da server.py (che serve solo le cartelle della sua lista bianca).
Lo lancia scripts/deploy.sh: un kit di campioni in una cartella non servita non arriva piu' online muto."""
import os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
site = lambda *p: os.path.join(ROOT, "site", *p)
read = lambda p: open(p, encoding="utf-8").read()
failures = []

def check(cond, msg):
    if not cond:
        failures.append(msg)

server = read(os.path.join(ROOT, "server.py"))
static_dirs = re.search(r"STATIC_DIRS = \((.*?)\)", server, re.S).group(1)
served = re.findall(r'"([^"]+/)"', static_dirs)
static_files = set(re.findall(r'"([^"]+)"', re.search(r"STATIC_FILES = \{(.*?)\}", server, re.S).group(1)))

# 1) ogni cartella e ogni file in site/ e' servito
for name in sorted(os.listdir(site())):
    if name.startswith("."):
        continue
    path = site(name)
    if os.path.isdir(path):
        check(name + "/" in served, f"site/{name}/ non e' in STATIC_DIRS di server.py: online risponderebbe 404")
    else:
        check(name in static_files, f"site/{name} non e' in STATIC_FILES di server.py")

# 1b) le immagini di anteprima dei link: esistono, sono leggere e sono visibili senza password.
# I social aprono il link, vengono rimandati alla pagina di accesso e leggono i tag og: da li':
# quella pagina deve averli, con un'immagine pubblica (altrimenti l'anteprima resta vuota).
open_paths = set(re.findall(r'"(/[^"]*)"', re.search(r"OPEN_PATHS = \{(.*?)\}", server, re.S).group(1)))
login = re.search(r'PAGE_SHELL = (?:r?"""|r?\'\'\')(.*?)(?:"""|\'\'\')', server, re.S)
check(login is not None, "pagina di accesso non trovata in server.py")
for name, text in (("pagina di accesso", login.group(1) if login else ""), ("index.html", read(site("index.html")))):
    for tag in ("og:title", "og:description", "og:image", "twitter:image"):
        check(f'"{tag}"' in text, f"{name}: manca il tag {tag}")
    for url in set(re.findall(r'content="https://patternmachine\.tongatron\.org(/assets/[^"]+)"', text)):
        check(url in open_paths, f"{name}: {url} non e' tra i percorsi pubblici di server.py (l'anteprima resterebbe vuota)")
        path = site(url.lstrip("/"))
        check(os.path.isfile(path), f"{name}: {url} non esiste in site/")
        if os.path.isfile(path):
            check(os.path.getsize(path) <= 600_000, f"{url} pesa {os.path.getsize(path)//1024} KB: troppo per WhatsApp e altri social (max ~600 KB)")

# 2) i campioni RX-5 usati dalla pagina esistono e sono nella cache offline
page, sw = read(site("index.html")), read(site("sw.js"))
used = set(re.findall(r'"([A-Za-z0-9]+-RX5)"', re.search(r"const RX5_SLOTS=.*?const TR808_SLOTS", page, re.S).group(0)))
cached = set(re.findall(r'"([A-Za-z0-9]+-RX5)"', re.search(r"const RX5_FILES = \[(.*?)\];", sw, re.S).group(1)))
on_disk = {f[:-4] for f in os.listdir(site("machines", "rx5")) if f.endswith(".wav")}
check(len(used) >= 40, f"tabella RX-5 nella pagina troppo corta ({len(used)})")
check(used <= on_disk, f"RX-5 usati ma senza file: {sorted(used - on_disk)}")
check(on_disk <= used, f"file RX-5 mai usati dalla pagina: {sorted(on_disk - used)}")
check(cached == on_disk, f"cache offline (sw.js) diversa dai file: {sorted(cached ^ on_disk)}")

# 2b) ogni macchina copre gli slot che il generatore usa (altrimenti una riga creata da un pattern resterebbe muta)
core = read(site("engine", "core.js"))
role_slots = {v for v in re.findall(r':\s*"([^"]+)"', re.search(r"const ROLE_SAMPLE = \{(.*?)\};", core, re.S).group(1))}
check(len(role_slots) >= 20, f"slot dei ruoli letti male: {len(role_slots)}")
for table in re.findall(r"const (\w+_SLOTS)=\[", page):
    body = re.search(r"const %s=\[(.*?)\n\];" % table, page, re.S).group(1)
    slots = set(re.findall(r'\["([^"]+)","[^"]+","[^"]+"\]', body))
    check(role_slots <= slots, f"{table}: mancano gli slot usati dal generatore: {sorted(role_slots - slots)}")
    kit = table[:-6].lower()                      # RX5_SLOTS -> rx5, TR808_SLOTS -> tr808
    files = set(re.findall(r'\["[^"]+","([^"]+)","[^"]+"\]', body))
    folder = site("machines", kit)
    if os.path.isdir(folder):                     # i kit delle macchine possono mancare (non sono nel repository)
        have = {f[:-4] for f in os.listdir(folder) if f.endswith(".wav")}
        check(files <= have, f"{table}: file mancanti in machines/{kit}: {sorted(files - have)}")

# 3) i campioni SP-1200: uno per slot in entrambe le cartelle
names = set(re.findall(r'"([^"]+)"', re.search(r"const SAMPLE_NAMES = \[(.*?)\];", sw, re.S).group(1)))
for d in ("samples", "samples12"):
    have = {f.replace(" SP-1200.wav", "") for f in os.listdir(site(d)) if f.endswith(".wav")}
    check(have == names, f"{d}: file diversi dall'elenco della cache offline: {sorted(have ^ names)}")

# 4) il corso (learn/): le lezioni pronte esistono, suonano solo slot SP-1200 (le mini drum machine e le
# missioni nell'app li cercano per nome) e i file del corso nella cache offline esistono
learn = read(site("learn", "lessons.js"))
for url in re.findall(r'url:"([^"]+)"', learn):
    check(os.path.isfile(site("learn", url)), f"learn/lessons.js: la lezione {url} non esiste in site/learn/")
sounds = set(re.findall(r'sample:"([^"]+)"', learn))
for page in sorted(f for f in os.listdir(site("learn")) if f.endswith(".html")):
    sounds |= set(re.findall(r'sample:"([^"]+)"', read(site("learn", page))))
check(sounds and sounds <= names, f"corso: suoni che non sono slot SP-1200: {sorted(sounds - names)}")
shell = re.search(r"const SHELL = \[(.*?)\];", sw, re.S).group(1)
for path in re.findall(r'"(/learn/[^"]+)"', shell):
    check(os.path.isfile(site(path.lstrip("/"))), f"sw.js: {path} e' nella cache offline ma non esiste")

# 5) SEO: sitemap, robots, link canonici, parole chiave (i nomi delle drum machine) e dati strutturati
import json
sitemap, robots = read(site("sitemap.xml")), read(site("robots.txt"))
machine_names = re.findall(r'\{id:"[a-z0-9]+", name:"([^"]+)"', read(site("macchine.html")))
check(len(machine_names) == 14, f"macchine.html: {len(machine_names)} macchine lette invece di 14")
disallowed = re.findall(r"^Disallow: (\S+)", robots, re.M)
check("Sitemap: https://patternmachine.tongatron.org/sitemap.xml" in robots, "robots.txt: manca la riga Sitemap")
sitemap_paths = re.findall(r"<loc>https://patternmachine\.tongatron\.org(/[^<]*)</loc>", sitemap)
check("/" in sitemap_paths and "/home.html" not in sitemap_paths and "/landing.html" not in sitemap_paths, "sitemap.xml: la home deve essere /")
page_file = lambda url: "home.html" if url == "/" else url.lstrip("/")
for url in sitemap_paths:
    check(url in open_paths, f"sitemap.xml: {url} non e' pubblico in server.py (il crawler finirebbe sul login)")
    check(os.path.isfile(site(page_file(url))), f"sitemap.xml: {url} non esiste in site/")
    check(not any(url.startswith(d) for d in disallowed), f"sitemap.xml: {url} e' vietato da robots.txt")
    text = read(site(page_file(url)))
    check(f'<link rel="canonical" href="https://patternmachine.tongatron.org{url}">' in text, f"{url}: canonical diverso dall'indirizzo in sitemap")
    check("noindex" not in text, f"{url}: e' in sitemap ma ha noindex")
shell = login.group(1) if login else ""
for name, text in [("home.html", None), ("funzioni.html", None), ("macchine.html", None), ("plugin.html", None), ("index.html", None), ("pagina di accesso", shell)]:
    text = read(site(name)) if text is None else text
    kw = re.search(r'<meta name="keywords" content="([^"]*)"', text)
    check(kw is not None and sorted(k.strip() for k in kw.group(1).split(",")) == sorted(machine_names),
          f"{name}: le parole chiave devono essere i nomi delle {len(machine_names)} drum machine di macchine.html")
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S):
        try:
            check("@context" in json.loads(block), f"{name}: JSON-LD senza @context")
        except ValueError as e:
            check(False, f"{name}: JSON-LD non valido ({e})")
for name in ("home.html", "funzioni.html", "macchine.html", "plugin.html"):
    text = read(site(name))
    descr = re.search(r'<meta name="description" content="([^"]*)"', text)
    check(descr is not None and 50 <= len(descr.group(1)) <= 165, f"{name}: description assente o lunga/corta ({len(descr.group(1)) if descr else 0} caratteri, max ~160)")
    check(len(re.findall(r"<h1[ >]", text)) == 1, f"{name}: deve avere un solo h1")
check('type="application/ld+json"' in read(site("home.html")), "home.html: mancano i dati strutturati")
for name in ("live.html", "embed.html", "app.html", "synth.html"):
    check('<meta name="robots" content="noindex">' in read(site(name)), f"{name}: pagina non pubblica senza noindex")
home = read(site("home.html"))
for target in ("/funzioni.html", "/macchine.html", "/plugin.html"):
    check(f'href="{target}"' in home, f"home.html: manca un collegamento diretto a {target} (robots.txt vieta /login: il crawler non la raggiungerebbe)")
for name in sorted(f for f in os.listdir(site()) if f.endswith(".html")) + ["../server.py"]:
    check("/landing.html" not in read(site(name)) or name == "../server.py", f"{name}: punta ancora a /landing.html")
    check('href="/home.html"' not in read(site(name)), f"{name}: punta ancora a /home.html (la home e' /)")
# 6) l'app sta su /studio: dalle pagine del sito "Torna alla drum machine" non deve finire sulla home
for name in sorted(f for f in os.listdir(site()) if f.endswith(".html") and f != "app.html") + sorted("learn/" + f for f in os.listdir(site("learn")) if f.endswith((".html", ".js"))):
    text = read(site(name))
    check(not re.search(r'href="\.\.?/(#[^"]*|\?[^"]*)?"', text), f"{name}: link relativo alla radice: ora e' la home, l'app e' /studio")

print(f"{len(failures)} problemi" if failures else f"ok: {len(used)} suoni RX-5, cartelle servite {sorted(served)}")
for f in failures:
    print("  -", f)
sys.exit(1 if failures else 0)
