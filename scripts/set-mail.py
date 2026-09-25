#!/usr/bin/env python3
"""Configura la mail di PatternMachine (Gmail): benvenuto ai nuovi utenti e link per la nuova password.

Sul server, nella cartella del sito (accanto a server.py):
    python3 set-mail.py                       chiede indirizzo Gmail e password per le app
    python3 set-mail.py --test tu@example.com manda una mail di prova con la configurazione salvata

Serve una "password per le app" di Google (account Google > Sicurezza > Verifica in due passaggi >
Password per le app): la stessa che usa gia' alcol-monitor va bene. Scrive mail.json (permessi 600),
che il server non serve mai. Non serve riavviare.
"""
import argparse
import getpass
import json
import os
import smtplib
import sys
from email.message import EmailMessage

HERE = os.path.dirname(os.path.abspath(__file__))


def target():
    if os.environ.get("PATTERNMACHINE_MAIL"):
        return os.environ["PATTERNMACHINE_MAIL"]
    base = HERE if os.path.exists(os.path.join(HERE, "server.py")) else os.path.join(HERE, "..")
    return os.path.join(base, "mail.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", metavar="DESTINATARIO")
    args = ap.parse_args()
    path = target()
    if args.test:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = "PatternMachine: mail di prova", cfg["user"], args.test
        msg.set_content("Se leggi questo messaggio, le mail di PatternMachine funzionano.")
        with smtplib.SMTP_SSL(cfg.get("host", "smtp.gmail.com"), int(cfg.get("port", 465)), timeout=20) as s:
            s.login(cfg["user"], cfg["app_password"])
            s.send_message(msg)
        print("mail di prova spedita a", args.test)
        return
    user = input("Indirizzo Gmail che spedisce: ").strip()
    pw = getpass.getpass("Password per le app (16 lettere, gli spazi non contano): ").replace(" ", "")
    if not user or not pw:
        sys.exit("servono indirizzo e password")
    data = {"user": user, "app_password": pw, "from_name": "PatternMachine", "host": "smtp.gmail.com", "port": 465}
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)
    print("salvato in", path, "- prova con: python3 set-mail.py --test tu@example.com")


if __name__ == "__main__":
    main()
