# Da fare

Idee e lavori rimandati per PatternMachine. In ordine di utilità per il lavoro con Logic.

## Integrazione con Logic (prossimi)
In ordine consigliato.
- [x] **Plug-in Audio Unit** (fatto, prototipo in `plugin/`): JUCE 8 con il sito in un WebView, motore C++ agganciato al
  PPQ di Logic (play, tempo, cicli, bounce), progetto salvato dentro il progetto di Logic. Da fare: uscite separate
  per voce, kit personali, firma per distribuirlo.
- [x] **Uscita multi-canale**: export MIDI multitraccia e uscita MIDI live con canali separati.
- [x] **Modalità Logic a istanze separate**: ogni istanza del plug-in può filtrare una singola riga/strumento,
  con assegnazione salvata nello stato del progetto e un canale separato nel mixer.
- [ ] **Multi-output audio AU diretto**: Logic continua a esporre PatternMachine solo come Mono/Stereo anche
  dopo la registrazione dei bus; tenere come sperimentale/futura compatibilità con host AU diversi.
- [ ] **Export per Scripter**: pattern/canzone come script per il plug-in Scripter (MIDI FX, JavaScript) sulla
  traccia di batteria. Suona agganciato al trasporto di Logic senza browser aperto; probabilita', flam e
  umanizza decisi da Logic a ogni giro. Note sulla mappa General MIDI. La strada piu' solida.
- [ ] **Web MIDI in uscita**: il sito manda le note a Logic tramite IAC Driver (da attivare in Configurazione
  MIDI Audio) e suona con Drum Machine Designer / Drummer / Sampler; si puo' registrare come regione.
  Solo Chrome/Edge (Safari non ha Web MIDI).
- [ ] **Web MIDI in ingresso**: suonare i pad e registrare dall'MPK.
- [ ] **Sincronizzazione al MIDI Clock di Logic** (Impostazioni progetto > Sincronizzazione > MIDI): il sito
  segue Play/Stop/tempo. Qualche ms di imprecisione nel browser: buono per suonare, non per il definitivo.

## Export per Logic
- [x] **Mappa MIDI a scelta** (fatto: pacchetto "Logic (zip)"): oltre a "Kit SP-1200" (nota 36 + slot, in ordine cromatico) aggiungere
  "General MIDI" (cassa 36, rullante 38, clap 39, hi-hat chiuso 42, aperto 46, tom e piatti ai loro posti),
  così i pattern fatti con 808, 909 e RX-5 suonano subito con Drum Machine Designer / Drum Kit Designer.
- [x] **Una traccia per voce** nel MIDI (cassa, rullante, hat... su tracce separate): export MIDI formato 1,
  con traccia tempo, canali distinti e incluso nei pacchetti per DAW. Restano da fare l’uscita MIDI live e il
  routing audio multi-output del plug-in.
- [ ] **Marker delle sezioni** nell'export della canzone (nomi dei blocchi nella timeline di Logic).
- [ ] **Un solo file** con tutto il progetto: pattern come regioni separate più la canzone.
- [x] **Stems WAV** (fatto: nel pacchetto "Logic (zip)"): un file audio per voce.

## Per creare meglio
- [x] Blocchi per step (flam, intonazione, decay, filtro), lunghezza per riga, swing MPC, umanizza.
- [ ] **Griglia a 12 step (terzine)** per shuffle, swing jazz e 6/8 veri. Lavoro grande: tocca motore,
  formato dei codici, interfaccia, sequencer ed export. Oggi lo swing sposta solo i sedicesimi dispari.
- [ ] **Nuove lettere di variazione ibrida** quando si aggiungono stili: la lista dei donatori (`X_DONORS` in
  `site/engine/variations.js`) è fissa per non cambiare i codici già condivisi.

## Interfaccia
- [ ] Menù **File ▾** ed **Esporta ▾** al posto dei sette pulsanti in cima.
- [ ] Riga della traccia essenziale (nome, M, S, step) con gli altri controlli sotto **⋯**.
- [ ] Valutare il bordo doppio sul primo step di ogni battuta (segna il tempo, ma può sembrare pesante).

## Traduzione inglese
Il sito ha lo switch ITA/ENG (`site/engine/i18n.js` + dizionario `site/engine/lang-en.js`); le pagine restano
scritte in italiano. `node scripts/i18n-check.mjs` elenca le frasi del sito ancora senza traduzione (oggi nessuna).
Restano in italiano:
- [ ] **Pagina di download dell'app** (`site/app.html`): da tradurre solo con una richiesta esplicita (regola in `AGENTS.md`).
- [ ] **Accesso, registrazione, password dimenticata e pagina admin**: le genera `server.py`; dopo la modifica
  serve `sudo systemctl restart patternmachine` sul server.
- [ ] **Mail** di benvenuto e di reset della password (testi in `server.py`).
- [ ] **Messaggi di errore del server** (`{"error": "accesso richiesto"}`, "gli ospiti non possono salvare"...): arrivano
  in italiano nella barra di stato; aggiungerli al dizionario o tradurli nel server.
- [ ] **File esportati**: `Leggimi.txt` dei pacchetti per DAW, nomi di file e tracce ("Senza titolo").
- [ ] **Anteprime dei link e web app**: `<meta name="description">`, Open Graph e `manifest.json` (description)
  sono solo in italiano.
- [ ] **App desktop**: pannelli aggiunti da `desktop/bridge/` (Logic/DAW, importa drum machine, "Logic (cartella)").
  Alla prossima build va allineato anche `setStatus` di `bridge.js` (ora confronta un contrassegno, non il testo).
- [ ] **Plug-in per Logic**: pannello di `plugin/bridge/plugin-bridge.js` (selettore Istanza, badge Logic).
- [ ] **Scegliere la lingua dal browser** alla prima visita (oggi si parte sempre da ITA).

## Nome
- [ ] Nome del sito: da settembre 2026 **PatternMachine**. Alternative tenute da parte: **PatternLab**,
  **PatternBox**, **BeatBoxer**, **DrumWorks**.
- [ ] Spegnere il vecchio indirizzo `drummachine.tongatron.org` (oggi fa solo il trasloco dei dati salvati nel
  browser verso quello nuovo) quando nessuno lo usa piu': togliere l'hostname dal tunnel Cloudflare e `OLD_HOSTS`
  da `server.py`.
- [ ] Immagine di anteprima dei link (`assets/og-drum-machine-lab.jpg`): rifarla col nuovo nome.

## Manutenzione
- [ ] **Remote git** per avere una copia del codice fuori dal Mac (i kit 808/909 restano fuori da git).
- [ ] Togliere dal server `assets/og-sp1200.png` (vecchia immagine di anteprima, 2,2 MB, non più usata)
  quando le anteprime vecchie già condivise non servono più.
- [ ] `SP-1200.html` (versione autonoma) non è allineata al motore nuovo: aggiornarla o toglierla.
