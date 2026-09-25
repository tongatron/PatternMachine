# PatternMachine

Drum machine a step (E-mu SP-1200, Yamaha RX-5, Roland TR-808, TR-909, TR-707, TR-727, TR-606, CR-78, CR-8000, Linn LinnDrum, Oberheim DMX, E-mu Drumulator, Sequential DrumTraks, Simmons SDS-V) con generatore di pattern, online su https://patternmachine.tongatron.org
(prima si chiamava Drum Machine Lab, su drummachine.tongatron.org: quell'indirizzo ora trasferisce i dati salvati nel browser e rimanda al nuovo).

- `site/` — il sito: `index.html`, motore ritmico in `site/engine/` (core, variazioni e arrangiamento, schede degli stili in gruppi: punk, post-punk, macchine, alternative, hip hop/dance/latin, reggae/dub, breakbeat/DnB, soul/disco/afro, rock pesante/metal, elettronica/club), PWA (`sw.js`, `manifest.json`, `icons/`), campioni (`samples`, `samples12`) e macchine selezionabili in `machines/` (Yamaha RX-5; gli altri kit estratti da Logic, vedi sotto).
- `index.html` — Drum Machine Toolkit (sul server diventa `toolkit.html`).
- `server.py` — server statico + API `/api/patterns` usata dal toolkit.
- `desktop/` — prototipo di app per macOS (Electron): porta MIDI virtuale verso Logic, sync al MIDI Clock di Logic, trascinamento di MIDI/WAV nella timeline, progetti ed export su file. Vantaggi e istruzioni in `desktop/README.md`.
- `SP-1200.html` — versione autonoma con i campioni incorporati (non aggiornata al motore nuovo).
- `SP 1200/` — campioni originali, plugin Audio Unit, remap dei pad MPK.
- `TODO.md` — idee e lavori rimandati.

## Macchine (kit di campioni)

Il selettore "Macchina" cambia i suoni. Una macchina e' una cartella di WAV in `site/machines/<id>/` piu' una tabella in `site/index.html` (`*_SLOTS`, che deve coprire gli slot del generatore: lo verifica `tests/site_test.py`).
Tutti i kit tranne **SP-1200 e RX-5** vengono da Logic Pro (kit "Boutique" e kit del Sampler, ricreazioni di Apple): si estraggono con `scripts/extract-logic-kits.sh`, non stanno in git e `deploy.sh` li pubblica solo con `--con-kit-logic`.
Un kit i cui file il server non serve sparisce dal selettore.

| Cartella | Macchina | Da Logic Pro |
|---|---|---|
| `rx5` | Yamaha RX-5 | — (campioni RX-5, in git) |
| `tr808`, `tr909`, `cr78` | TR-808, TR-909, CR-78 | Ultrabeat "Boutique 808/909/78" |
| `sp12b` | SP-1200 · Boutique | Ultrabeat "Boutique SP12" |
| `dmx`, `drumulator` | Oberheim DMX, E-mu Drumulator | Ultrabeat "Vintage Machines" (DMX senza clap/rim, Drumulator senza hi-hat) |
| `linn` | LinnDrum | Sampler "Cory's LinnDrum Kit" |
| `tr707`, `tr727`, `tr606`, `cr8000`, `drumtraks`, `sdsv` | TR-707, TR-727, TR-606, CR-8000, DrumTraks, Simmons SDS-V | Sampler, kit "… Processed" (la 727 ha solo percussioni latine) |
| `tr808u`, `tr909u` | TR-808 / TR-909 · campioni | Sampler, kit "… Unprocessed" |

Per aggiungere un kit: una riga in `scripts/extract-logic-kits.sh`, la tabella `*_SLOTS` in `site/index.html`, la cartella
in `.gitignore` e in `LOGIC_KITS` di `scripts/deploy.sh`; la scheda storica (facoltativa) va in `site/macchine.html`.

## Test

```bash
node tests/engine.test.js
python3 tests/server_test.py
```

## Pubblicazione

```bash
scripts/deploy.sh          # prova a secco
scripts/deploy.sh --yes    # pubblica (backup in /srv/apps/patternmachine-backups)
```

Quando cambiano `site/sw.js` o `site/engine/*.js` va aumentata la versione in tre punti che lo script
controlla: `VERSION` in `sw.js`, `SW_VERSION` e i `?v=` degli script del motore in `site/index.html`.
Se cambia `server.py` serve `sudo systemctl restart patternmachine` sul server.

## Account

Ognuno entra con il proprio nome e la propria password (niente piu' password unica del sito).
- Dal sito ci si registra come **utente**: nome, password (qualsiasi) ed email facoltativa. Con l'email arriva una mail di benvenuto con le credenziali e si puo' chiedere un link per una nuova password (vale un'ora, si usa una volta).
- L'**admin** si crea sul server: `python3 add-user.py Giovanni --admin` (lo stesso script cambia password e ruolo). La pagina `/admin` elenca gli utenti, manda link di reset ed elimina account.
- Utenti in `data/users.json`, mail via Gmail con `mail.json` (`python3 set-mail.py`, poi `python3 set-mail.py --test tu@example.com`): stanno solo sul server, non vengono mai serviti.
