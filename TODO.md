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

## Sampler
Dal 30 settembre 2026. Oggi: editor a tutto schermo (`site/engine/sample-editor.js`) con taglio, dissolvenze,
normalizzazione, reverse e "12 bit" SP-1200 fisso; card con Start, Pitch, Tail, REV; riga della griglia con
passa-basso a 4 poli, decay, pan, choke. In ordine consigliato.

### 1. Pannello "Color" nell'editor
Effetti che si "stampano" sul campione, con ascolto prima di applicare. Funzioni pure in `dsp` (filtri biquad
scritti in JS, niente OfflineAudioContext) provate da `tests/sample-editor.test.js`. Non tocca le funzioni che
l'app desktop sostituisce.
- [x] **Pannello con anteprima**: i quattro effetti si aprono al posto degli strumenti, con cursori, Bypass per il
  confronto, Play che ascolta il risultato, forma d'onda aggiornata, picco dopo l'effetto, Cancel / Apply (con
  undo). Save ed export aspettano che l'effetto sia applicato o annullato. Dissolvenze brevi ai bordi della
  selezione, per non avere click.
- [x] **Crunch** (bitcrusher/resampler) al posto del pulsante fisso "SP-1200 12-bit": frequenza 2–48 kHz, bit
  4–16, quantizzazione lineare o compandata, Mix. Preset: SP-1200 (26,04 kHz, 12 bit), SP-12 (27,5 kHz, 12 bit),
  MPC60 (40 kHz, 12 bit), Emulator II (27,7 kHz, 8 bit compandati), Casio SK-1 (9,38 kHz, 8 bit).
- [x] **Trucco del 45 giri** nel Crunch: campionare accelerato di N semitoni e riabbassare equivale a campionare
  a una frequenza più bassa; il cursore mostra la frequenza che ne risulta.
- [x] **Drive**: Soft (tanh), Tube (asimmetrico, armoniche pari), Hard clip, Fold; guadagno 0–36 dB, uscita, Mix.
- [x] **Filter**: passa-basso, passa-alto, passa-banda, notch; cutoff, risonanza, pendenza 12/24 dB.
- [x] **EQ** a 3 bande: bassi (shelf 100 Hz), medi (campana 200 Hz–5 kHz), alti (shelf 8 kHz), ±12 dB.
- [ ] Più avanti: **Vinyl** (fruscio, crackle, wow & flutter) e filtro con sweep lungo la selezione.

### 2. Chop: da un break a tanti pad
Pulsante **Chop…** nel gruppo Cut dell'editor: lavora sulla selezione o su tutto il suono.
- [x] Dividere in 2/4/8/16/32 parti uguali; lunghezza del pezzo in battute (½, 1, 2, 3 secondo gli step del
  progetto) con il tempo che ne risulta e la scelta di portarci il progetto.
- [x] Dividere sui colpi (sensibilità regolabile), marker spostabili sulla forma d'onda: trascinare per spostare,
  doppio clic per aggiungere o togliere, clic su una fetta o tasti 1–9 per ascoltarla.
- [x] **Fette → righe della griglia**: un campione e una riga per fetta (stesso gruppo choke, il primo libero),
  un pattern che le risuona dove stavano e un blocco "Break" di 4 battute nella canzone dopo quello selezionato
  (il Play principale suona la canzone). "Save slices" le mette solo nel Sampler.

### 3. Resampling
- [x] **⟲ Resample** nella scheda Sampler: il beat come si sente (batteria e synth, con mute, solo, pan e
  limiter) diventa un campione nuovo. Un pattern di batteria e/o una sezione del synth fra quelli del progetto
  (menu del sito), 1, 2 o 4 volte, oppure la canzone; finale "loop" (le code
  tornano all'inizio: il campione gira senza buchi e dura giusto N battute, il Chop ne ricava il tempo esatto),
  "code" o "taglio"; si apre nell'editor. Usa `renderWav(which, loops, {drums, synth})` dell'export WAV (`makeZip`
  non si tocca).

### 3b. Voce sulla canzone
- [x] **● Record vocal** nel Sequencer (`site/engine/vocal.js`): il microfono registra mentre la canzone suona
  (dall'inizio o dalla battuta scelta sulla timeline, count-in di 1 o 2 battute, senza il blocco in solo); cattura
  con un AudioWorklet nello stesso AudioContext del Play, quindi la ripresa si allinea a `nextTime`; latenza
  automatica (uscita + ingresso) o a mano, anche dopo la ripresa. Ascolto con la canzone, livello della voce e
  salvataggio nel Sampler: solo voce (mono, dal primo colpo) o voce + canzone (`renderWav`). Usa `play()`,
  `stop()` e `nextTime` senza cambiarli.
- [ ] Più riprese sulla stessa canzone (comping) e una corsia audio nel Sequencer che le suona al loro posto.
- [ ] Attacco prima del primo colpo (le note in levare durante il count-in oggi restano fuori).

### 4. Suono per riga, in tempo reale
Tocca `trigger()`, che l'app desktop sostituisce: l'app andrà allineata al suo prossimo aggiornamento.
- [ ] Filtro multimodo per riga (passa-alto e passa-banda oltre al passa-basso).
- [ ] Modalità "canale SP-1200": canali 1–2 filtro dinamico, 3–6 filtri fissi, 7–8 senza filtro.
- [ ] Bitcrush per riga, attacco, velocity → filtro, modalità loop.

### 5. Piccole cose
- [ ] Registrazione che parte da sola sopra una soglia, come sull'SP-1200.
- [ ] Adattare un loop al BPM (time-stretch).
- [ ] Dissolvenza incrociata sul punto di loop.

## Interfaccia
- [ ] Menù **File ▾** ed **Esporta ▾** al posto dei sette pulsanti in cima.
- [ ] Riga della traccia essenziale (nome, M, S, step) con gli altri controlli sotto **⋯**.
- [ ] Valutare il bordo doppio sul primo step di ogni battuta (segna il tempo, ma può sembrare pesante).

## UX
Dall'analisi UX del 28 settembre 2026 (sito provato in locale a 1440×900, su iPhone emulato 390×844 e come
primo accesso senza dati salvati). Numeri di riga riferiti a `site/index.html` in quella data. In ordine di
priorità. Nota: i punti su barra di stato (`setStatus`) e trasporto (`stop`, `scheduler`) toccano funzioni che
l'app desktop sostituisce da `desktop/bridge/bridge.js`: l'app andrà allineata al suo prossimo aggiornamento.

### Priorità alte
- [x] **Il lavoro non si perde.** Bozza automatica nel browser con recupero all'avvio e avviso alla chiusura se la bozza non è ancora stata scritta.
  (nessun `beforeunload`), e all'avvio si apre sempre un progetto nuovo (`project=starterProject()`, riga ~5265):
  chi ricarica perde il beat non salvato senza avviso; gli ospiti non possono salvare affatto.
  - bozza automatica nel browser a ogni modifica (con ritardo di qualche centinaio di ms), anche per gli ospiti;
  - all'avvio: "Riprendi il progetto di 5 minuti fa?" (finestra `ask()`, non popup del browser);
  - accanto al nome del progetto: "• non salvato" / "salvato ✓";
  - avviso alla chiusura solo se ci sono modifiche che nemmeno la bozza ha salvato.
- [x] **Griglia visibile subito e trasporto sempre a portata.** Trasporto compatto e sticky, con posizione Pattern/Canzone esplicita; su telefono resta a portata in fondo.
  intero una sola riga di step, ogni strumento occupa 121 px. Su iPhone Play è a 986 px e il primo step a 1589 px
  (due schermate sotto). Scorrendo fino alla griglia, Play, BPM e posizione escono dallo schermo (si può fermare
  solo con la barra spaziatrice).
  - barra di trasporto compatta e fissa in alto (in basso su telefono): Play/Stop, Rec, Pattern|Canzone, BPM,
    Tap, metronomo, posizione, swing;
  - Progetto + Macchina + Pattern in un'unica riga compatta;
  - link "Guide and features", "App for Mac, Win, Linux", "Logic plug-in" in un menu ☰ o nel footer;
  - obiettivo: a 1440×900 almeno 8 righe di griglia nella prima schermata.
- [x] **Un solo trasporto, identico in tutte le schede.** Pattern/Canzone è indipendente dalla scheda e il trasporto non viene più fermato cambiando vista; i comandi Play solo sono ricondotti ai mute/solo del Mixer.
  - Griglia: "Play All", "Play solo drums", Rec, Live View;
  - Sequencer: "Play", senza Rec, senza Live View;
  - Synth: "Play solo synth"; Swing sale in prima riga, Humanize scende in seconda.

  Cosa suona dipende dalla scheda: `setView` passa da canzone a pattern (`setMode(v==="seq"?"song":"pattern")`,
  riga ~2876) e uscendo dalla Griglia mentre suona "solo drums" la riproduzione si ferma. "Play All" si legge
  come "suona tutta la canzone", invece vuol dire batteria + synth del pattern.
  - selettore esplicito **Pattern | Canzone** nel trasporto, indipendente dalla scheda aperta;
  - cambiare scheda non ferma e non cambia quello che suona;
  - "solo batteria/synth" come M/S dei gruppi Drums e Synth (esistono già nel Mixer) al posto di due pulsanti Play.
- [ ] **Generatore in evidenza e senza sorprese.**
  - chiamare **✦ Genera** (o "Libreria e generatore") il pulsante "Browse…": la landing promette "writes the beat
    with you", nell'app il generatore non si vede;
  - stile iniziale compatibile col tempo del progetto: al primo accesso è Punk '77 (165–195 BPM) con il progetto a
    93 BPM, e il primo messaggio è un ripiego ("the closest ones"). A 93 BPM, boom bap / hip hop (coerente con l'SP-1200);
  - il messaggio sul tempo fuori portata dura pochi secondi e intanto spinge le linguette tagliando "★ Favorites":
    renderlo fisso vicino al campo Tempo, con due scelte ("stili vicini a 93 BPM" / "porta il progetto a 165");
  - "Load" cambia senza dirlo tempo, swing e feel dell'intero progetto (`applyLibrary`, riga ~4940): rinominare
    "Load" / "+ Add" in **Sostituisci il pattern** / **Aggiungi come nuovo**, con casella "mantieni il tempo del progetto";
  - ogni scheda ha 10 comandi (▶, ☆, Load, + Add, ×, Similar, Vary, Arrange, Link, Lock) e ne stanno 2–3 per
    schermata: righe compatte con ▶ e "Usa" in evidenza, il resto sotto **⋯**, così si confrontano tutte e 8;
  - ascolto da tastiera: ↑/↓ passa al pattern successivo e lo suona, Invio lo carica;
  - nome leggibile al posto del codice esadecimale nel titolo ("Punk '77 43D685"): il codice resta sotto, una volta sola;
  - etichettare le righe dell'anteprima (BD, SD, HH…);
  - il campo Codice può stare in una sezione secondaria.
- [x] **Bug: i primi step di ogni battuta sono più piccoli.** Rimosso il margine dalla cella: gli step restano uguali
  e il righello non va più a zig-zag. `.step.g{margin-left:9px}` (riga 391) dentro la
  griglia con `aspect-ratio:1/1` rimpicciolisce gli step 5, 9 e 13: 54×54 px contro 63×63 (misurato a 1440 px).
  Su telefono la seconda fila di step parte rientrata e il righello dei tempi va a zig-zag ("1 2" / "3 4").
  - spazio tra i gruppi nel `grid-template` (o gruppi da 4 come contenitori), non come margine della cella;
  - per segnare il tempo, al posto del bordo doppio: step spenti colorati a gruppi di 4 come sulla TR-808
    (rosso, arancio, giallo, bianco). Sostituisce il punto "bordo doppio" della sezione Interfaccia.

### Struttura
- [x] **Riga dello strumento compatta** (vedi anche Interfaccia). Oggi 11 comandi su una riga sopra gli step
  (anteprima, menu suono, M, S, Grp, Len., intonazione, volume, ▾, ⚙, ×), il nome ripetuto due volte (etichetta
  "BD 1" + menu "BD 1"), su telefono tre righe di comandi per strumento (~450 px a strumento). I parametri di riga
  stanno in tre posti: menu in riga, pannello ⚙, corsie ▾.
  - una riga sola: nome che fa anche da menu del suono, M, S, gli step, **⋯**;
  - tutto il resto (Grp, Len., intonazione, volume, Decay, Filter, Reso, Start, Rev, Feel, corsie) in un
    pannello laterale della riga selezionata;
  - il numero della riga oggi è anche il pulsante di ascolto: renderlo riconoscibile come pad.
- [ ] **Parametri per step visibili e disegnabili.** Probability, Ratchets, Flam, Tuning, Decay e Filter si
  cambiano cliccando a ciclo (100→75→50→25): il valore non si vede prima di cliccare e le corsie sono celle vuote.
  - corsie a barre (altezza = valore), trascinare in verticale per regolare e in orizzontale per disegnare su più
    step, come le velocity di Logic/Ableton; valore al passaggio del mouse;
  - nelle modalità "Step click", etichetta del valore su tutti gli step modificati.
- [x] **Accento, normale, ghost distinguibili senza colore.** Oggi rosso vs arancio (ghost = 50% di opacità):
  per chi non distingue rosso e arancio sono quasi uguali. Codificarli anche con luminosità o forma (es. accento
  pieno + punto, ghost quadratino interno) e aggiungere una piccola legenda.
- [x] **Testina più visibile.** Oggi è un contorno sottile sullo step corrente: evidenziare tutta la colonna
  (banda su tutte le righe) e un LED sopra la griglia.
- [ ] **Viste coerenti.** Le viste sono 7 (Griglia, Synth, Sequencer, Mixer, Live, Saved projects, MIDI) ma le
  linguette 4: "Saved projects" e "MIDI" nella barra del progetto e "Live View" nel trasporto cambiano tutta la
  pagina come linguette travestite da pulsanti. Le linguette sembrano grossi pulsanti 3D e quella attiva usa lo
  stesso arancio di Save, MIDI e Browse.
  - linguette vere, più leggere, con indicatore della scheda attiva;
  - "Saved projects" → finestra **Apri progetto**; MIDI → impostazioni; Live → quinta linguetta.
- [ ] **Pannello Pattern.**
  - "✦ Variations" nel pannello, "✦ Vary" sulle schede della libreria, "Variation of the current pattern" nella
    libreria e "✦ Vary" nell'aiuto: un solo nome per ogni concetto;
  - le 20 variazioni in gruppi (groove, hi-hat, densità, struttura, ibridi) con descrizione; "Hybrid", "Cross-style
    rhythm", "Half and half", "Voice mix", "Double hybrid" oggi non dicono cosa fanno; se possibile ascolto prima di applicare;
  - chiarire se le variazioni si sommano o si sostituiscono;
  - il selettore Steps vicino alla griglia che modifica;
  - spiegare il pallino colorato accanto al pattern (colore del pattern nel Sequencer).
- [ ] **Sequencer.** La canzone compare due volte (timeline + schede sotto) con azioni doppie: Duplicate/Remove
  nella barra e ⧉/× sulla scheda, ←/→ e trascinamento. Il synth è una lista separata invece di una seconda corsia
  allineata alle battute. Il blocco si apre solo con doppio clic (lo dice solo il testo in fondo). "Rename" non
  dice cosa rinomina. Remove e Clear rossi uno accanto all'altro.
  - timeline come superficie principale, con corsie Drums e Synth sullo stesso righello delle battute;
  - clic su un blocco → pannello dettagli (sezione, pattern, ripetizioni, Vary, Fill, Solo, Mute, ✎ Modifica);
  - un solo posto per duplicare/eliminare.
- [ ] **Export come finestra guidata.** Oggi 13 voci in un menu piatto che esce dalla colonna della pagina;
  "MIDI pattern/song" usano di default la mappa del kit SP-1200 di Logic (caso di nicchia) mentre General MIDI è
  la terza voce; "Follows Pattern/Song" dipende da una modalità che non si vede; le spiegazioni sono solo nei
  tooltip (assenti su touch).
  - tre scelte: **Cosa** (Pattern | Canzone) → **Per** (Logic, Ableton, REAPER, altro DAW, MP3 da ascoltare,
    file di progetto) → opzioni (mappa GM o SP-1200, multitraccia, stems);
  - General MIDI come default; ricordare l'ultima scelta. (Si lega a "Menù File ▾ ed Esporta ▾" qui sotto.)
- [ ] **Volumi in un posto solo.** Oggi lo stesso volume sta in tre posti: cursore della riga, "Vol. drums /
  synth / general" nel trasporto e Mixer (lo dice anche il testo del Mixer). Togliere i tre cursori dal trasporto
  (libera una riga intera), livelli nel Mixer; valori in dB invece di 0–100.

### Leggibilità e feedback
- [ ] **Colori con un significato solo.** L'arancio oggi vuol dire insieme azione principale (Save), attenzione
  (MIDI), linguetta attiva, interruttore acceso (Variations aperto), Browse, step attivo e riempimento dei
  cursori; nel tema scuro Save, Browse e gli step diventano blu. Un colore per l'azione principale di ogni zona,
  uno per lo stato "selezionato", i colori degli step riservati alla griglia, uguali nei due temi.
- [ ] **Scala tipografica.** 55 regole CSS hanno testo ≤10,5 px (titoli dei pannelli 9,5, numeri dei tempi 8,5,
  conteggio pattern e valore swing 9) e ci sono 19 dimensioni diverse. Il contrasto è buono (5–12:1): il problema
  è la dimensione, più il maiuscolo spaziato ovunque. Scala di 4–5 misure (es. 11/12/14/16/20) con minimo 11–12 px;
  maiuscolo solo per le etichette dei pannelli. L'aiuto in monospazio è faticoso da leggere: la landing usa un
  sans proporzionale molto più leggibile.
- [ ] **Messaggi che restano.** `setStatus` (riga ~3724) svuota la barra di stato dopo 3 secondi, errori
  compresi, e la barra sta in cima, spesso fuori schermo mentre si lavora sulla griglia.
  - avviso fisso in basso, più lungo per gli errori, con **Annulla** dopo le azioni distruttive ("Pattern eliminato — Annulla");
  - le condizioni importanti (tempo fuori portata, non salvato) come stato fisso, non come messaggio.
- [ ] **Testi rimasti in italiano** nell'interfaccia inglese (lato client, non elencati sotto): "salvato",
  "salvato · locale", "salvato · cloud", "aggiunto: …", aria-label "step N vuoto" e "Togli … dalla lista",
  date formattate con `it-IT` in `fmtDate`.
- [ ] **Importa:** "Import text" disattivato finché il campo è vuoto; "or tap to choose one" → "click" su desktop.
- [x] **Cursore BPM** 40–240, allineato al campo numerico.
- [x] **Valori Swing e Humanize** mostrati accanto ai rispettivi cursori.

### Live View
- [ ] **Errore di modalità.** La griglia è identica a quella di modifica, ma un clic sullo step suona invece di
  accenderlo (serve ⌘+clic, riga ~2228); su touch il ⌘ non c'è e non si può modificare. Restano visibili Grp,
  Len., intonazione, volume e × delle righe (non è "solo griglia, Play, Rec, tempo e metronomo"). All'ingresso si
  apre una finestra di aiuto finché non si sceglie "Don't show again".
  - pad grandi (4×4 stile MPC, 2×8 su telefono orizzontale) + griglia in sola lettura con la testina;
  - oppure un interruttore visibile **Suona | Scrivi**;
  - aiuto come suggerimento non bloccante invece della finestra.

### Telefono
- [ ] **Prima schermata senza musica.** A 390×844 si vedono titolo, link, pulsanti del progetto (Redo occupa una
  riga intera), linguette su due righe: niente Play, niente griglia. Pagina lunga 4300 px.
  - trasporto fisso in basso; azioni del progetto sotto **⋯**; link del sito nel menu;
  - step 36×36 px: portarli verso 44 (indicazione Apple);
  - le modalità "Step click" scorrono in orizzontale e Decay/Filter restano nascosti: menu o due righe.

### Aiuto e primo avvio
- [ ] L'aiuto "Playing: keys and controls" è un muro di testo in fondo, aperto di default (`<details ... open>`).
  Non si scoprono da soli: clic destro = accento, shift = ghost, doppio clic sul blocco, trascinamento dei
  blocchi, numero della riga = ascolto.
  - primo avvio in 3 passi: scegli una macchina → ✦ genera un beat → premi spazio;
  - foglio delle scorciatoie richiamabile con **?**;
  - aiuto chiuso dopo la prima visita; suggerimenti nel punto in cui servono.

### Accessibilità
- [ ] Step con nome completo: "BD 1, step 5, accento" (oggi "step 5" / "step 5 vuoto", senza strumento né
  accento/ghost) e `aria-pressed`.
- [ ] Nomi per M, S (Mute/Solo della riga) e ⚙ (oggi solo lettera/simbolo); etichetta per menu suono e Grp.
- [ ] Frecce per muoversi nella griglia (un solo punto di tabulazione), invece di Tab su 64+ step e 11 comandi per riga.
- [ ] Libreria come `<dialog>` che sposta il focus al suo interno (oggi è un `div` e il focus resta sulla pagina;
  Esc funziona già).

### Schema proposto della schermata principale
```
PATTERN-MACHINE   Untitled ▾  • non salvato  ↶ ↷          Importa  Esporta  ☰
▶ PLAY  ● REC  [Pattern|Canzone]  93 BPM  TAP  Metro  1.1  Swing   ← sempre visibile
Griglia · Synth · Sequencer · Mixer · Live
TR-808 ▾   Beat 1 ▾  + ⧉ ⋯     ✦ Genera   ✦ Varia ▾             16 step ▾
BD 1 ▾  M S │■□□□ □□■□ □□□□ □□■□│ ⋯
SD 1 ▾  M S │□□□□ ■□□□ □□□□ ■□□□│ ⋯     → pannello laterale con i parametri
HH 1 ▾  M S │■□■□ ■□■□ ■□■□ ■□■□│ ⋯
```

Ordine consigliato: salvataggio automatico, bug degli step più piccoli, trasporto fisso e unico, generatore,
riga compatta.

## Corso (learn/)
Dal 30 settembre 2026 il sito ha la sezione **Learn** (`site/learn/`): lezioni brevi, in inglese, solo per chi ha
l'accesso. Ogni lezione: ascolta → copia sulla mini drum machine con verifica → suona e registra con i tasti →
missione nella drum machine vera (`/?lesson=<id>`, scheda in `learn/coach.js`, bozza separata). Elenco dei livelli,
lezioni pronte e missioni in `learn/lessons.js`; la mini drum machine è `learn/mini.js`.
- [x] Prototipo: lezione **The backbeat** (livello 2), indice del corso, link "Learn" nella barra in alto.
- [x] Livelli 1–4 (primi passi, programmare a step, dinamica, tastiera). Nella tastiera: mappa dei tasti con
  quiz, "suona a tempo" con misura in ms, eco (la macchina suona, tu ripeti), registrazione a strati, Live View
  con ⌥+tasto, griglia senza mouse (sfida con il mouse disattivato), pad MIDI.
- [x] Livelli 5–6 (groove e suono, dal pattern al brano): swing, humanize, parametri per step, poliritmi,
  kit, sezioni, fill, Sequencer e forma della canzone.
- [x] Livello 7 (stili): lezioni per genere, con esercizi su boom bap, electro, house, techno, trap, breakbeat,
  funk, reggae, dembow, afrobeat, bossa, synth-pop, post-punk, coldwave, industrial, trip-hop, indie dance e lo-fi indie.
- [x] Livello 8 (suono e produzione): Sampler, resample e chop, synth insieme alla batteria, Mixer, registrazione
  della voce ed export per MIDI, WAV, stems e DAW.
- [ ] **Palestra** di esercizi ripetibili con record personali, progetto finale e glossario.
- [ ] Avanzamento legato all'account (oggi solo nel browser, chiave `pm.learn`).
- [ ] Tour dell'interfaccia con schermate numerate, rifatte da uno script quando cambia l'interfaccia.

Emerso preparando le lezioni sulla tastiera:
- [ ] **Accento da tastiera sul Mac**: sullo step col focus Invio accende e ⇧+Invio mette il ghost, ma ⌥+Invio non
  fa niente e il menu del tasto destro si apre solo col tasto Menu (⇧F10 non lo apre): gestire ⌥+Invio nello step.
- [ ] **La registrazione scrive sempre colpi normali**: anche dai pad MIDI la velocity si sente ma non diventa
  accento o ghost (`recordHit` scrive 1). Si può fare come l'import MIDI (forte = accento, piano = ghost).
- [x] **Rec metteva un colpo a tempo sullo step prima**: `recordHit` partiva da `visible`, aggiornato solo al frame
  dopo; un colpo nei ~16 ms dopo l'inizio dello step finiva su quello prima. Ora usa la coda audio.
- [ ] La registrazione non toglie il ritardo dell'uscita audio (cuffie Bluetooth: 150–250 ms, i colpi finiscono
  sullo step dopo). La mini drum machine del corso lo toglie già (`outputLatency`).

## Interfaccia in inglese
Dal 28 settembre 2026 `index.html`, `funzioni.html`, `macchine.html` e `plugin.html` sono scritte in inglese
(niente più switch ITA/ENG: si è provato e poi tolto). Il codice sorgente (commenti, nomi di variabili) resta
in italiano. Restano in italiano, perché fuori da queste pagine:
- [ ] **Pagina di download dell'app** (`site/app.html`): da tradurre solo con una richiesta esplicita (regola in `AGENTS.md`).
- [ ] **Accesso, registrazione, password dimenticata e pagina admin**: le genera `server.py`; dopo la modifica
  serve `sudo systemctl restart patternmachine` sul server.
- [ ] **Mail** di benvenuto e di reset della password (testi in `server.py`).
- [ ] **Messaggi di errore del server** (`{"error": "accesso richiesto"}`, "gli ospiti non possono salvare"...): arrivano
  in italiano nella barra di stato.
- [ ] **App desktop**: pannelli aggiunti da `desktop/bridge/` (Logic/DAW, importa drum machine, "Logic (cartella)").
- [ ] **Plug-in per Logic**: pannello di `plugin/bridge/plugin-bridge.js` (selettore Istanza, badge Logic).

## Nome
- [ ] Nome del sito: da settembre 2026 **PatternMachine**. Alternative tenute da parte: **PatternLab**,
  **PatternBox**, **BeatBoxer**, **DrumWorks**.
- [ ] Spegnere il vecchio indirizzo `drummachine.tongatron.org` (oggi fa solo il trasloco dei dati salvati nel
  browser verso quello nuovo) quando nessuno lo usa piu': togliere l'hostname dal tunnel Cloudflare e `OLD_HOSTS`
  da `server.py`.
- [x] Immagine di anteprima dei link: rifatta col nuovo nome (`assets/og-pattern-machine.png`, solo testo con l'elenco delle macchine).

## Manutenzione
- [ ] **Remote git** per avere una copia del codice fuori dal Mac (i kit 808/909 restano fuori da git).
- [ ] Togliere dal server `assets/og-sp1200.png` (vecchia immagine di anteprima, 2,2 MB, non più usata)
  quando le anteprime vecchie già condivise non servono più.
- [ ] `SP-1200.html` (versione autonoma) non è allineata al motore nuovo: aggiornarla o toglierla.
