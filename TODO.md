# Da fare

Idee e lavori rimandati per PatternMachine. In ordine di utilità per il lavoro con Logic.

## Integrazione con Logic (prossimi)
In ordine consigliato.
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
- [ ] **Una traccia per voce** nel MIDI (cassa, rullante, hat... su tracce separate).
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
