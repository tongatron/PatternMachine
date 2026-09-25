# PatternMachine per macOS (prototipo Electron)

Lo stesso PatternMachine del sito, in un'app per Mac che parla direttamente con Logic Pro.
Il sito (`../site`) non viene modificato: l'app lo carica dal disco e ci aggiunge un pannello **Logic**
(`bridge/`), che sostituisce alcune funzioni del sito con quelle native.

## Perché un'app: cosa si guadagna rispetto al browser

| Nel browser | Nell'app |
|---|---|
| Esporti uno zip, lo scarichi, lo scompatti, lo importi in Logic | **Trascini** `⠿ MIDI` o `⠿ WAV` dal pannello Logic direttamente nella timeline di Logic |
| Nessuna uscita MIDI dal vivo (Web MIDI c'è solo su Chrome, Safari non lo supporta) | **Porta MIDI virtuale "PatternMachine"**: Logic la vede come una tastiera, i pattern suonano Drum Kit Designer, Drum Machine Designer o qualsiasi strumento. I colpi suonati sui pad (tasti 1-4, Q-R…) si registrano in Logic |
| Play e BPM da impostare a mano | **Segue il MIDI Clock di Logic**: Play/Stop/Continua di Logic comandano l'app, la posizione del playhead (anche nei cicli) e il tempo arrivano da Logic, e ogni sedicesimo scatta al clock, quindi l'app non va fuori tempo |
| Progetti nel `localStorage` del browser, legati al dominio (li ha messi a rischio il trasloco drummachine → patternmachine) | Progetti come **file JSON** in `~/Music/PatternMachine/Progetti`: si copiano, si mettono in Time Machine o iCloud, si rimuovono nel Cestino |
| "Logic (zip)" finisce in Download | **"Logic (cartella)"**: cartella già scompattata in `~/Music/PatternMachine/Export`; anche MIDI e WAV vanno lì, e il pulsante "Mostra ultimo export" la apre nel Finder |
| Serve il server, la password e la rete | Tutto in locale, anche offline; niente login |
| Scorciatoie in conflitto con quelle del browser, tab e barre | Finestra propria, menu macOS (File › Apri cartella Progetti/Export) |

L'audio interno è lo stesso motore Web Audio del sito. Con "Suono interno" spento si sentono solo
gli strumenti di Logic pilotati dal MIDI.

## Usarla

```bash
cd desktop
npm install
npm start               # avvia l'app dai sorgenti (usa ../site così com'è)
npm run dist            # crea dist/mac-arm64/PatternMachine.app (non firmata)
```

L'app non è firmata: la prima volta si apre con tasto destro › Apri.
I kit 808 e 909 (contenuti Apple) entrano nell'app solo con `PM_KIT_LOGIC=1 npm run dist` e se sono stati estratti in `site/machines` (`scripts/extract-logic-kits.sh`).

## Pubblicarla sul sito (pagina "App per Mac")

```bash
desktop/scripts/release.sh     # build senza kit Apple, firma ad-hoc, zip + app.json in site/download/
scripts/deploy.sh --yes        # pubblica sito e download (come sempre)
```

La pagina `site/app.html` legge `download/app.json` (versione, dimensione, SHA-256) e punta allo zip con `?v=<impronta>`,
così una versione nuova non arriva mai dalla cache. `site/download/` non va in git.
Il download sta dietro la password del sito come tutto il resto e passa dal tunnel Cloudflare senza essere messo in cache
(`Cache-Control: private`): Cloudflare non ha limiti di dimensione sulle risposte (il limite di 100 MB vale solo per gli upload).
Per aggiornare l'app: alza `version` in `package.json`, rilancia i due comandi.

## Collegarla a Logic

**Note da PatternMachine a Logic (uscita MIDI)**
1. Nel pannello Logic dell'app lascia attiva **Uscita MIDI**. Con **Note: General MIDI** le note sono quelle di Drum Kit Designer e Drum Machine Designer (36 cassa, 38 rullante, 42 hat chiuso…). **Kit SP-1200 (36+)** è per il kit SP-1200 creato in Logic.
2. In Logic crea una traccia strumento (per esempio Drum Machine Designer) e mettila in registrazione o in monitor: in Logic il MIDI in ingresso arriva da tutte le porte, compresa "PatternMachine".
3. Premi Play nell'app, oppure fai partire Logic con il clock agganciato (sotto). Per registrare, avvia la registrazione in Logic.

**Logic come master (clock)**
1. In Logic: *File › Impostazioni progetto › Sincronizzazione › MIDI*: in *Clock MIDI* scegli la destinazione **PatternMachine** e attiva la trasmissione del clock.
2. Nell'app attiva **Segui il clock di Logic**. La scritta accanto dice se il clock arriva.
3. Premi Play in Logic: l'app parte al primo tempo, segue il tempo e i salti del ciclo e si ferma con Logic.
4. Se senti l'app leggermente in ritardo, regola il ritardo del clock nella stessa pagina delle impostazioni di Logic (valori negativi = clock in anticipo).

**Trascinare in Logic**
- `⠿ MIDI`: una regione MIDI del pattern (o della canzone, se il trasporto è su *Canzone*), con la mappa di note scelta.
- `⠿ WAV`: il pattern (4 giri) o la canzone renderizzati con mixer ed effetti, come "WAV pattern/canzone".

## Com'è fatta

- `main.js`: finestra, protocollo `app://pm/` che serve `../site` dal disco (e inserisce il ponte in `index.html`), porte MIDI virtuali ([`@julusian/midi`](https://www.npmjs.com/package/@julusian/midi), CoreMIDI), file di progetti ed export, trascinamento (`webContents.startDrag`).
- `preload.js`: le sole funzioni che la pagina può chiamare (`window.pmDesktop`), con isolamento del contesto e sandbox.
- `bridge/bridge.js`: si aggancia al sito senza modificarlo. Sostituisce `db` e `downloadsCap` (salvataggio ed export), `trigger` (ogni colpo diventa anche una nota MIDI), `stop` (spegne le note in sospeso) e `makeZip` (il pacchetto Logic diventa una cartella), e aggiunge il pannello.
  In modalità clock gli step li decide `clockStep()`, che è una copia di `scheduler()` del sito: **se cambia `scheduler()` in `site/index.html`, va allineata anche questa**.
- `PM_HOME=/percorso npm start` usa un'altra cartella al posto di `~/Music/PatternMachine` (serve per le prove).

## Limiti del prototipo

- I progetti salvati nel browser (`localStorage` del sito) non passano da soli nell'app: vanno riaperti sul sito e ricreati, oppure serve un'importazione (da fare).
- Il campo BPM mostra il tempo di Logic arrotondato all'intero, perché il sito lavora a BPM interi. Il passo reale però è quello del clock, quindi non c'è deriva.
- Le note MIDI escono con un timer del processo principale: precisione di circa 1-2 ms, più che sufficiente per suonare e registrare. Per la quantizzazione perfetta resta il trascinamento del file MIDI.
- Niente aggiornamenti automatici: un nuovo sito richiede `npm run dist`.
- App non firmata né notarizzata: per darla ad altri serve un account Apple Developer.

## Idee per dopo

- Caricare campioni e kit personali dal disco (anche direttamente da `/Applications/Logic Pro.app` o dalla libreria di Logic, senza estrarli prima).
- Importare i progetti dal sito (esportazione JSON sul web, importazione qui).
- Uscita multi-canale: una traccia MIDI o un canale per strumento, per il mixer di Logic.
- Plugin Audio Unit (JUCE 8 con interfaccia WebView) per avere PatternMachine dentro Logic, con sync automatico.
