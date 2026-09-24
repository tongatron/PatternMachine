# Drum Machine Lab

Drum machine a step (SP-1200, Yamaha RX-5, 808, 909) con generatore di pattern, online su https://drummachine.tongatron.org.

- `site/` — il sito: `index.html`, motore ritmico in `site/engine/` (core, variazioni e arrangiamento, schede degli stili in gruppi: punk, post-punk, macchine, alternative, hip hop/dance/latin, reggae/dub, breakbeat/DnB, soul/disco/afro, rock pesante/metal, elettronica/club), PWA (`sw.js`, `manifest.json`, `icons/`), campioni (`samples`, `samples12`) e macchine selezionabili in `machines/` (Yamaha RX-5; kit 808 e 909 estratti da Logic).
- `index.html` — Drum Machine Toolkit (sul server diventa `toolkit.html`).
- `server.py` — server statico + API `/api/patterns` usata dal toolkit.
- `SP-1200.html` — versione autonoma con i campioni incorporati (non aggiornata al motore nuovo).
- `SP 1200/` — campioni originali, plugin Audio Unit, remap dei pad MPK.
- `TODO.md` — idee e lavori rimandati.

## Macchine (kit di campioni)

Il selettore "Macchina" cambia i suoni. Una macchina e' una cartella di WAV in `site/machines/<id>/` piu' una tabella in `site/index.html` (`*_SLOTS`, che deve coprire gli slot del generatore: lo verifica `tests/site_test.py`).
I kit **808 e 909** vengono da Logic Pro (kit "Boutique", ricreazioni di Apple): si estraggono con `scripts/extract-logic-kits.sh`, non stanno in git e `deploy.sh` li pubblica solo con `--con-kit-logic`.
Un kit i cui file il server non serve sparisce dal selettore.

## Test

```bash
node tests/engine.test.js
python3 tests/server_test.py
```

## Pubblicazione

```bash
scripts/deploy.sh          # prova a secco
scripts/deploy.sh --yes    # pubblica (backup in /srv/apps/drummachine-backups)
```

Quando cambiano `site/sw.js` o `site/engine/*.js` va aumentata la versione in tre punti che lo script
controlla: `VERSION` in `sw.js`, `SW_VERSION` e i `?v=` degli script del motore in `site/index.html`.
Se cambia `server.py` serve `sudo systemctl restart drummachine` sul server.
