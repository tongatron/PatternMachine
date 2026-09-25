#!/usr/bin/env python3
"""Configura il bot Telegram che riceve le segnalazioni di PatternMachine ("Segnala un problema").

Sul server, nella cartella del sito (accanto a server.py):
    python3 set-telegram.py           chiede il token del bot e trova da solo la chat
    python3 set-telegram.py --test    manda un messaggio di prova con la configurazione salvata

Il token lo da' @BotFather (/mybots > il tuo bot > API Token). La chat: prima di lanciare lo script scrivi
un messaggio qualsiasi al bot da Telegram; lo script legge l'ultimo messaggio ricevuto e ne prende la chat.
Se il bot ha un webhook attivo (per esempio con Google Apps Script) i messaggi non restano da leggere:
in quel caso lo script chiede il chat_id a mano (lo mostra @userinfobot).
Scrive telegram.json (permessi 600), che il server non serve mai. Non serve riavviare.
"""
import argparse
import getpass
import json
import os
import sys
from urllib.request import Request, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))


def target():
    if os.environ.get("PATTERNMACHINE_TELEGRAM"):
        return os.environ["PATTERNMACHINE_TELEGRAM"]
    base = HERE if os.path.exists(os.path.join(HERE, "server.py")) else os.path.join(HERE, "..")
    return os.path.join(base, "telegram.json")


def call(token, method, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(f"https://api.telegram.org/bot{token}/{method}", data=data,
                  headers={"Content-Type": "application/json"} if data else {})
    with urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def send(cfg, text):
    try:
        return call(cfg["token"], "sendMessage", {"chat_id": cfg["chat_id"], "text": text}).get("ok", False)
    except Exception:  # noqa: BLE001 - chat sbagliata o bot mai avviato: Telegram risponde 400
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()
    path = target()
    if args.test:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        print("messaggio di prova spedito" if send(cfg, "PatternMachine: messaggio di prova delle segnalazioni.")
              else "Telegram ha rifiutato il messaggio")
        return
    token = getpass.getpass("Token del bot (da @BotFather): ").strip()
    if not token:
        sys.exit("serve il token")
    try:
        me = call(token, "getMe")
    except Exception as e:  # noqa: BLE001
        sys.exit(f"token non valido o Telegram non raggiungibile ({type(e).__name__})")
    print("bot:", "@" + me["result"].get("username", "?"))
    chat = None
    try:
        updates = call(token, "getUpdates").get("result", [])
        chats = [u["message"]["chat"] for u in updates if u.get("message")]
        if chats:
            c = chats[-1]
            print("ultima chat che ha scritto al bot:", c.get("first_name") or c.get("title") or "", c.get("id"))
            if input("uso questa? [S/n] ").strip().lower() in ("", "s", "si", "sì", "y", "yes"):
                chat = c["id"]
        else:
            print("nessun messaggio da leggere: scrivi al bot da Telegram e rilancia, oppure inserisci il chat_id")
    except Exception:  # noqa: BLE001 - con un webhook attivo getUpdates non si puo' usare
        print("non riesco a leggere i messaggi del bot (ha un webhook attivo?)")
    if chat is None:
        chat = input("chat_id a cui mandare le segnalazioni: ").strip()
    if not chat:
        sys.exit("serve la chat")
    data = {"token": token, "chat_id": str(chat)}
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)
    print("salvato in", path)
    print("messaggio di prova spedito" if send(data, "PatternMachine: le segnalazioni arriveranno qui.")
          else "attenzione: Telegram ha rifiutato il messaggio di prova (chat giusta? hai scritto al bot?)")


if __name__ == "__main__":
    main()
