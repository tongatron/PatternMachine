#!/usr/bin/env python3
"""Imposta (o cambia) la password di accesso al sito.

Sul server, nella cartella del sito:
    python3 set-password.py                 chiede la password senza mostrarla
    printf %s 'nuova' | python3 set-password.py --stdin

Scrive auth.json accanto allo script: hash PBKDF2 con sale e un segreto nuovo per i cookie,
quindi cambiare password chiude anche tutte le sessioni aperte. Il file non e' mai servito.
Non serve riavviare: server.py rilegge auth.json a ogni richiesta.
"""
import getpass
import hashlib
import json
import os
import secrets
import sys

ITERATIONS = 600_000


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    target = (os.environ.get("PATTERNMACHINE_AUTH") or os.environ.get("DRUMMACHINE_AUTH")) or os.path.join(here, "auth.json")
    if "--stdin" in sys.argv:
        password = sys.stdin.read().rstrip("\r\n")
    else:
        password = getpass.getpass("Nuova password: ")
        if getpass.getpass("Ripeti: ") != password:
            sys.exit("le password non coincidono")
    if not password:
        sys.exit("password vuota")
    salt = secrets.token_bytes(16)
    data = {
        "salt": salt.hex(),
        "hash": hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS).hex(),
        "iterations": ITERATIONS,
        "secret": secrets.token_bytes(32).hex(),
    }
    tmp = target + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    os.replace(tmp, target)
    print("password impostata in", target)


if __name__ == "__main__":
    main()
