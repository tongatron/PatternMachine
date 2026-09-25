#!/usr/bin/env python3
"""Crea un utente di PatternMachine o gli cambia la password (e il ruolo).

Sul server, nella cartella del sito (accanto a server.py):
    python3 add-user.py Giovanni --admin                 chiede la password senza mostrarla
    python3 add-user.py Mario --email mario@example.com
    printf %s 'nuova' | python3 add-user.py Giovanni --stdin

Scrive data/users.json (permessi 600). Se l'utente esiste gli cambia la password: le sue sessioni
aperte si chiudono. --admin lo rende amministratore, --user lo riporta a utente normale.
Non serve riavviare: server.py rilegge il file a ogni richiesta.
"""
import argparse
import getpass
import importlib.util
import os
import sys


def load_server():
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, "server.py"), os.path.join(here, "..", "server.py")):
        if os.path.exists(path):
            spec = importlib.util.spec_from_file_location("pm_server", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    sys.exit("server.py non trovato accanto allo script")


def main():
    ap = argparse.ArgumentParser(description="Crea un utente o gli cambia la password")
    ap.add_argument("name")
    ap.add_argument("--email", default=None)
    role = ap.add_mutually_exclusive_group()
    role.add_argument("--admin", action="store_true")
    role.add_argument("--user", action="store_true")
    ap.add_argument("--stdin", action="store_true", help="legge la password da stdin")
    args = ap.parse_args()

    srv = load_server()
    name = srv.clean_name(args.name)
    if not name:
        sys.exit(f"nome non valido (da 1 a {srv.MAX_USERNAME} caratteri)")
    if args.email and not srv.EMAIL_RE.match(args.email):
        sys.exit("email non valida")
    if args.stdin:
        password = sys.stdin.read().rstrip("\r\n")
    else:
        password = getpass.getpass(f"Password per {name}: ")
        if getpass.getpass("Ripeti: ") != password:
            sys.exit("le password non coincidono")
    if not password:
        sys.exit("password vuota")

    with srv.USERS_LOCK:
        db = srv.load_users()
        srv.users_secret(db)
        user = srv.find_user(db, name=name)
        if user:
            srv.set_user_password(user, password)
            what = "password cambiata"
        else:
            user = srv.new_user(name, password)
            db["users"].append(user)
            what = "utente creato"
        if args.email is not None:
            user["email"] = args.email
        if args.admin:
            user["role"] = "admin"
        elif args.user:
            user["role"] = "user"
        srv.save_users(db)
    print(f"{what}: {user['name']} ({user['role']}) in {srv.USERS_FILE}")


if __name__ == "__main__":
    main()
