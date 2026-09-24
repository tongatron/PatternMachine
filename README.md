# SP-1200 drum machine

Simulatore SP-1200 con generatore di pattern, online su https://drummachine.tongatron.org.

- `site/` — il sito: `index.html`, motore ritmico in `site/engine/` (core, variazioni e arrangiamento, schede degli stili in gruppi: punk, post-punk, macchine, alternative, hip hop/dance/latin, reggae/dub, breakbeat/DnB, soul/disco/afro), PWA (`sw.js`, `manifest.json`, `icons/`), campioni (`samples`, `samples12`, e il kit Yamaha RX-5 in `samples-rx5`).
- `index.html` — Drum Machine Toolkit (sul server diventa `toolkit.html`).
- `server.py` — server statico + API `/api/patterns` usata dal toolkit.
- `SP-1200.html` — versione autonoma con i campioni incorporati (non aggiornata al motore nuovo).
- `SP 1200/` — campioni originali, plugin Audio Unit, remap dei pad MPK.

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
