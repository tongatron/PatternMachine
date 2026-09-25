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
open_paths = set(re.findall(r'"(/[^"]+)"', re.search(r"OPEN_PATHS = \{(.*?)\}", server, re.S).group(1)))
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
    if os.path.isdir(folder):                     # i kit estratti da Logic possono mancare (non sono nel repository)
        have = {f[:-4] for f in os.listdir(folder) if f.endswith(".wav")}
        check(files <= have, f"{table}: file mancanti in machines/{kit}: {sorted(files - have)}")

# 3) i campioni SP-1200: uno per slot in entrambe le cartelle
names = set(re.findall(r'"([^"]+)"', re.search(r"const SAMPLE_NAMES = \[(.*?)\];", sw, re.S).group(1)))
for d in ("samples", "samples12"):
    have = {f.replace(" SP-1200.wav", "") for f in os.listdir(site(d)) if f.endswith(".wav")}
    check(have == names, f"{d}: file diversi dall'elenco della cache offline: {sorted(have ^ names)}")

print(f"{len(failures)} problemi" if failures else f"ok: {len(used)} suoni RX-5, cartelle servite {sorted(served)}")
for f in failures:
    print("  -", f)
sys.exit(1 if failures else 0)
