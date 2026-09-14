# SP 1200 — Kit di campioni

42 one-shot di batteria elettronica, preparati per l'import in Logic Pro.

Ultimo aggiornamento: 12 settembre 2026

---

## 1. Stato attuale dei file

| Proprietà | Valore |
|---|---|
| Numero file | 42 |
| Formato | WAV PCM, 44.100 Hz, 16 bit, **mono** |
| Durata | da 0,07 s (Kick 1) a 3,06 s (Crash 1) |
| Ampiezza | tutti normalizzati a fondo scala (picco = 32767) |
| Occupazione | 1,4 MB |
| Posizione | sottocartella `Samples/` |
| Nomenclatura | `Termine [n] SP-1200.wav` |

```
SP 1200/
├── README.md
├── Samples/          ← i 42 .wav
└── Plugin/           ← l'Audio Unit, vedi sezione 6
    ├── build.sh
    ├── Info.plist
    ├── src/          Twelve.cpp, TwelveDSP.h
    ├── tools/        measure.py, render.cpp, bake-samples.sh
    └── vendor/       AudioUnitSDK di Apple
```

Backup degli originali stereo: `../SP 1200 (originali stereo)/`

Il progetto Logic e il patch salvato usano **copie proprie** dei campioni (42 nella cartella
Media del progetto, altrettante dentro il patch): questa cartella può essere spostata o
rinominata senza rompere nulla.

---

## 2. Operazioni effettuate

1. **Rinomina** — i nomi originali abbreviati (`SP CLHH1.wav`, `SP OPHH1.wav`, `SP PER3.wav`, `SP VIBRA.wav`…) sono stati sciolti nei termini standard da drum machine: Closed Hat, Open Hat, Perc, Vibraslap, Rimshot, Timbale, Tambourine, Finger Snap, Cymbal.

2. **Conversione in mono** — l'analisi ha mostrato che tutti e 42 i file erano *dual-mono perfetti*: canali L e R bit-identici. La conversione ha quindi semplicemente scartato un canale duplicato, senza alcuna perdita. RAM e dimensione dimezzate.

3. **Numerazione, poi rimossa** — durante la costruzione del kit i file hanno portato un
   prefisso `01`–`42`, che serviva a far coincidere l'ordine alfabetico (= ordine di
   assegnazione ai pad in Logic) con il layout voluto. A kit costruito il prefisso è stato
   tolto: i nomi ora sono `Termine [n] SP-1200.wav`. Vedi l'avvertenza in fondo alla sezione 3.

4. **Analisi tecnica** — vedi sezione 4.

---

## 3. Mappa dei pad

Pensata per i banchi da 16 della Drum Machine Designer.

### Banco A — kit core (pad 1–16, note C1–D#2)

| Pad | Nota | File | | Pad | Nota | File |
|---|---|---|---|---|---|---|
| 1 | C1 | Kick 1 | | 9 | G#1 | Closed Hat 2 |
| 2 | C#1 | Kick 2 | | 10 | A1 | Open Hat 1 |
| 3 | D1 | Snare 1 | | 11 | A#1 | Tom 1 |
| 4 | D#1 | Snare 2 | | 12 | B1 | Tom 2 |
| 5 | E1 | Snare 3 | | 13 | C2 | Crash 1 |
| 6 | F1 | Rimshot | | 14 | C#2 | Ride 1 |
| 7 | F#1 | Finger Snap | | 15 | D2 | China |
| 8 | G1 | Closed Hat 1 | | 16 | D#2 | Cymbal |

### Banco B — percussioni (pad 17–32)
Cowbell 1-4 · Conga 1-4 · Timbale 1-2 · Agogo 1 · Tambourine · Cabasa 1-2 · Triangle · Vibraslap

### Banco C — restanti (pad 33–42)
Clave 1-2 · Guiro 1-2 · Perc 1-6

> **Nota:** questo layout **non** segue lo standard General MIDI. È compatto e comodo da suonare,
> ma loop MIDI di terze parti e il Drummer di Logic si aspettano GM (kick C1, rullante D1,
> hi-hat chiuso F#1, aperto A#1). Se servono, la numerazione va rifatta in versione GM
> lasciando alcuni pad vuoti.

> **Se un giorno reimporti questi file in un nuovo kit:** senza il prefisso numerico
> l'ordine alfabetico non coincide più con l'ordine dei pad — si ripartirebbe da Agogo,
> Cabasa, Cabasa, China… Il kit già costruito non ne risente (vedi sezione 5), ma per una
> reimportazione da zero il prefisso `01`–`42` andrebbe rimesso.

---

## 4. Analisi tecnica: questi campioni sono passati da una SP-1200?

**Risposta breve: no.** I file sono etichettati SP-1200, ma non portano la firma
dei convertitori di quella macchina.

### Cosa si sarebbe dovuto trovare

La E-mu SP-1200 campiona a **26,04 kHz con quantizzazione a 12 bit**. Da questo derivano
due firme non aggirabili:

- **Nyquist a 13,02 kHz.** Nessun contenuto può esistere sopra questa frequenza. Non è
  una questione di filtri più o meno ripidi: è un limite fisico del campionamento.
- **Risoluzione a 12 bit.** Il gradino di quantizzazione minimo è 16 volte più grosso
  che a 16 bit.

### Cosa si trova davvero

| Misura | Risultato | Atteso da SP-1200 |
|---|---|---|
| Energia 13,5–20 kHz (mediana, rel. 0,2–10 kHz) | **−25,4 dB** | assente (−∞) |
| File con contenuto reale sopra 13,5 kHz | **39 / 42** | 0 / 42 |
| Salto spettrale a 13,02 kHz | **nessuno** | muro netto |
| Energia 20–22 kHz | −64,9 dB | — |
| 4 bit meno significativi | **usati in 42/42** | a zero se 12 bit impacchettato |
| Gradino di quantizzazione minimo | **1** (piena risoluzione 16 bit) | 16 |

Su hi-hat e cabasa lo spettro *cresce* attraversando i 13 kHz — Closed Hat 1 passa da
−17,5 dB a 13,0 kHz a −10,0 dB a 15 kHz.

### Ipotesi alternativa esclusa

Un DAC a 26,04 kHz con filtro di ricostruzione debole genera **immagini** speculari della
banda base, che potrebbero simulare contenuto sopra i 13 kHz. È stata esclusa per due motivi:

1. Non c'è alcun notch o discontinuità a 13,02 kHz, dove banda base e immagine si
   incontrerebbero (verificato su 6 file ad alto contenuto armonico).
2. Le immagini metterebbero energia forte a 20–22 kHz (specchio dei 4–6 kHz, banda
   ricca nei piatti). Lì invece si misurano −64,9 dB: è il crollo tipico di un filtro
   anti-alias a 44,1 kHz applicato a materiale che arriva genuinamente a ~20 kHz.

### Conseguenza pratica

Il carattere "12 bit / 26 kHz" **non è già cotto dentro questi file**. Se lo si vuole,
va aggiunto — e lo si può fare senza raddoppiare alcun effetto preesistente. Vedi sezione 5.

---

## 5. Il kit in Logic Pro — già costruito

Il kit è stato creato e salvato. Non serve rifare l'import.

- **Patch:** `SP-1200 Kit`, in **Library → User Patches**
- **Percorso:** `~/Music/Audio Music Apps/Patches/Instrument/SP-1200 Kit.patch`
- **Campioni:** Logic ne ha fatto una **copia propria** in
  `~/Music/Audio Music Apps/Patches/Instrument/Samples/`, con i vecchi nomi numerati.
  Il patch è quindi autonomo e non dipende da questa cartella — ma per lo stesso motivo
  **quelle copie non vanno rinominate**, o il patch perde i riferimenti.

Il kit è stato costruito con **Track → Convert Regions to New Sampler Track…**
(Create Zones From: Regions · Instrument: Drum Machine Designer · Create '1Shot' Zones attivo),
non trascinando i file nell'area tracce — quel trascinamento crea tracce audio, non uno strumento.

### Per ricostruirlo da zero

1. Rimetti il prefisso `01`–`42` (vedi sezione 3).
2. Trascina i 42 `.wav` di `Samples/` nell'area tracce: Logic crea 42 tracce audio.
3. Selezionale tutte con **Cmd+A**, poi **Track → Convert Regions to New Sampler Track…**
4. Elimina le 42 tracce audio rimaste.

### Rifiniture consigliate

- **Hi-hat — FATTO.** Il gruppo esclusivo esiste e si chiama **Exclusive Group** (Off, 1–8).
  Non sta nei Pad Controls né nei Kit Controls, ma nel **menu ingranaggio del singolo pad**,
  quello che compare in basso a destra passando il cursore sopra un pad.
  Closed Hat 1 (G1), Closed Hat 2 (G#1) e Open Hat 1 (A1) sono tutti in **Exclusive Group 1**:
  il chiuso tronca l'aperto.

- **Icone dei pad — parziale.** Nello stesso menu per-pad c'è **Assign Track Icon…**, con un
  selettore diviso per categoria (Drums, Percussion, …). Assegnata l'icona grancassa al pad 1;
  gli altri 41 hanno ancora l'icona generica a forma d'onda. È lavoro manuale per singolo pad:
  i pad della DMD non si selezionano in gruppo.

- **Nomi dei pad.** Restano `01 Kick 1 SP-1200 1` (prefisso dal vecchio nome file + indice
  aggiunto da Logic). Il comando **"Update Kit Name for Kit Piece"** *non* li ripulisce:
  aggiunge una riga con il nome del kit. Per nomi puliti servirebbe rinominare ogni pad a mano.

- **Cosa non funziona come sembra:** "Reorder Pads by GM Drum Names" riordina solo la
  disposizione visiva della griglia per ruolo, non le assegnazioni delle note. Per tornare
  alla griglia leggibile: "Reorder Pads Chromatically".

> **Da fare:** il patch `SP-1200 Kit` è stato salvato *prima* di impostare gli Exclusive Group.
> Va risalvato (Library → Save…, sovrascrivendo) perché il mute group degli hi-hat sopravviva
> al richiamo del patch in un altro progetto.
- **Carattere SP-1200:** su ogni pad, la Quick Sampler ospita un inserto **Bitcrusher**.
  Downsampling verso ~26 kHz e Resolution a 12 bit avvicinano molto la grana originale,
  senza plugin di terze parti. Per una resa più vicina c'è ora un plugin dedicato:
  vedi sezione 6.

---

## 6. Il plugin `Twelve` — emulazione del percorso del convertitore

Conseguenza diretta della sezione 4: il carattere a 12 bit non è nei file, quindi va
aggiunto. Questo lo aggiunge.

**Sul formato.** Logic Pro non carica VST, carica **Audio Unit**: un "VST per Logic" non
esiste come formato. Questo è un AU di tipo effetto (`aufx`), quindi si inserisce sui pad
del kit, sull'uscita dello strumento o su qualsiasi altra traccia.

**Sul nome.** Si chiama `Twelve`, non "SP-1200": quello è un marchio E-mu e usarlo come
nome di prodotto è una seccatura evitabile. Cosa emula è scritto nella descrizione.

### Dove sta e come si ricompila

| | |
|---|---|
| Sorgenti | `Plugin/` |
| Installato in | `~/Library/Audio/Plug-Ins/Components/Twelve.component` |
| Ricompilare | `cd Plugin && ./build.sh` (compila, firma, installa, valida) |
| Binario | universale, arm64 + x86_64 |
| Dipendenze | solo i Command Line Tools |

Niente Xcode, niente CMake, niente JUCE. L'unica dipendenza esterna è l'**AudioUnitSDK
ufficiale Apple** (`github.com/apple/AudioUnitSDK`), 688 KB di soli sorgenti C++ già
presenti in `Plugin/vendor/`. Richiede C++23, perché l'SDK usa `std::expected`.

### In Logic

**Audio FX → Audio Units → Tonga → Twelve.** Se Logic era aperto va riavviato: la lista
dei plugin si legge all'avvio.

Stato della verifica: passa `auval -v aufx Sp12 Tnga` ("AU VALIDATION SUCCEEDED") e compare
nell'enumerazione completa degli AU effetto come `Tonga: Twelve`, che è esattamente ciò che
legge la scansione di un host. Non è stato aperto dentro Logic.

> Nota: su questo sistema `auval -a` è rotto — non elenca *nessun* plugin e stampa solo
> `Unload failed: 5`. Non è un sintomo di questo plugin.

### La catena

L'ordine degli stadi conta più dei singoli stadi:

| | Stadio | Cosa fa |
|---|---|---|
| 1 | Drive | stadio d'ingresso, clip morbido asimmetrico con headroom |
| 2 | Anti-alias | 2 poli **volutamente poco ripidi**, cutoff ancorato al clock |
| 3 | Convertitore | campiona-e-tieni al clock, poi quantizzazione **senza dither** |
| 4 | Ricostruzione | 2 poli a Nyquist del clock, fisso |
| 5 | Filter | 4 poli risonante con saturazione in retroazione (spento per default) |
| 6 | Uscita | blocco della continua, livello, Mix |

Il punto di tutto: **le due firme non sono effetti aggiunti, sono conseguenze.** Il
ripiegamento nasce dalla pendenza dolce del filtro anti-alias, non da un generatore di
alias. La grana nasce dall'assenza di dither, che lascia l'errore di quantizzazione
correlato al segnale. Lo stadio 4 è il motivo per cui la macchina suona scura: sulla
SP-1200 sono gli SSM2044 dietro ogni DAC, a cutoff fisso.

### I nove parametri

| Parametro | Corsa | Default | Cosa fa |
|---|---|---|---|
| Drive | 0…24 dB | 0 | spinge lo stadio d'ingresso. A 0 è trasparente |
| Sample Clock | 4…48 kHz | 26040 | la frequenza del convertitore |
| Resolution | 6…16 bit | 12 | la quantizzazione |
| Aliasing | 0…100 % | 50 | quanto ripiegamento lascia passare l'anti-alias |
| Filter | 200 Hz…20 kHz | 20 kHz | lowpass 4 poli; a 20 kHz è **spento** |
| Resonance | 0…100 % | 0 | risonanza del 4 poli |
| Converter Noise | −96…−36 dB | −96 | soffio del convertitore; a −96 è **spento** |
| Mix | 0…100 % | 100 | a 0 il segnale passa intatto |
| Output | −24…+12 dB | 0 | livello d'uscita |

**Sample Clock è il controllo interessante.** Abbassarlo abbassa Nyquist, quindi riproduce
il trucco storico "accorda in basso per sporcare, poi riporta su" — ma senza toccare
l'intonazione, che è il motivo per cui vale la pena averlo come parametro separato.

### Preset

`12 bit classico` · `Accordato in basso` · `Molto in basso` · `12 bit pulito` ·
`8 bit sfondato` · `Piatti e percussioni` · `Soffio del convertitore`

### Verifica

Misurato facendo passare segnali noti attraverso il plugin **installato** (non una
reimplementazione): `Plugin/tools/measure.py` rilancia tutto.

| Misura | Risultato | Previsione |
|---|---|---|
| Drive 0 dB, 2ª armonica rel. | **−113,8 dB** | trasparente a riposo |
| Drive 6 / 12 / 18 dB | −29,3 / −21,7 / −19,6 dB | crescente |
| Aliasing 0→75 %, alias di un tono a 16 kHz | −35,1 → −12,0 dB | monotono |
| Immagini del clock a 17060 Hz | −39,7 dB, controllo a −52,2 | clock = 26,04 kHz |
| Errore di quantizzazione, 12 / 10 / 8 bit | −77,8 / −66,0 / −53,9 dB | spaziatura 24 dB ogni 4 bit |
| → spaziatura misurata 12→8 bit | **+23,8 dB** | +24,1 dB teorici |
| Filtro, 2 ottave sopra il cutoff | −50,6 dB | −48 dB (24 dB/ottava) |
| Mix 0 % | −162,8 dB di differenza | passante esatto |

Il test sulla quantizzazione è differenziale, per un motivo che vale la pena annotare: senza
dither l'errore **non** forma un pavimento di rumore, finisce dentro le armoniche. Cercarlo
"fra le righe" dello spettro dà zero. Si confronta invece ogni rendering con uno a 16 bit.

Effetto sulla banda alta, energia 13,5–20 kHz relativa a 0,2–10 kHz — la stessa misura
della sezione 4:

| Strumento | originale | 26,04 kHz | 17 kHz |
|---|---|---|---|
| Closed Hat 1 | +1,3 dB | **−8,9 dB** | −29,0 dB |
| Snare 1 | −25,9 dB | −28,0 dB | −41,8 dB |
| Kick 1 | −27,7 dB | −28,7 dB | −36,2 dB |

Cassa e rullante cambiano poco perché lassù non avevano contenuto: è il risultato corretto.

### Come usarlo sul kit

- **Un solo inserto per tutto il kit:** sull'uscita della traccia dello strumento DMD.
  Il modo più economico.
- **Per singolo pad:** come inserto dentro la Quick Sampler del pad, se serve trattare
  l'hi-hat diversamente dalla cassa.
- **Cotto nei campioni:** `cd Plugin && ./tools/bake-samples.sh` processa i 42 file di
  `Samples/` e scrive in `Samples 12 bit/` senza toccare gli originali. Accetta gli stessi
  parametri (`./tools/bake-samples.sh drive=4 clock=17000`). Vantaggio: il kit non porta
  42 inserti da calcolare. Svantaggio: non è più modificabile.

Rispetto al **Bitcrusher** citato in sezione 5: il Bitcrusher fa downsampling e riduzione di
bit, ma non ha il filtro anti-alias dolce che genera il ripiegamento, né il filtro di
ricostruzione, né il 4 poli.

### Limiti noti

- **Nessuna interfaccia propria.** Logic disegna i suoi cursori dai parametri. Funziona ed è
  leggibile, ma è spartano. Aggiungerne una richiede una vista Cocoa e molto più lavoro.
- **Nessun oversampling.** A Drive alto la saturazione genera un ripiegamento proprio, non
  voluto. Su un plugin lo-fi è in tema, ma è una scorciatoia, non una scelta.
- **Il clock è limitato alla frequenza dell'host:** a 44,1 kHz non si può superare 44100.
- **Il rumore sotto l'LSB** viene in parte mangiato dal quantizzatore, quindi l'etichetta in
  dB è indicativa entro un paio di dB (misurato: −72 → −70,7; −54 → −54,8).
- **È l'emulazione del percorso del convertitore, non della macchina.** Non ci sono il
  sequencer né il suo swing, e il 4 poli è una topologia a scala nello spirito dell'SSM2044,
  non un modello circuitale.

### Strumenti in `Plugin/tools/`

| File | Cosa fa |
|---|---|
| `measure.py` | rilancia le sette misure di verifica (richiede `numpy`) |
| `render.cpp` | host offline: `twelve-render in.wav out.wav drive=4 clock=17000` |
| `bake-samples.sh` | processa l'intera cartella `Samples/` |

---

## 7. Ripristino

Per tornare ai file stereo originali con i nomi di partenza
(`SP KICK1.wav`, `RX5 CRASH 1.wav`, …), usa la cartella `../SP 1200 (originali stereo)/`.

Un'annotazione su quel backup: il file oggi chiamato `Crash 1 SP-1200.wav` si chiamava
in origine `RX5 CRASH 1.wav` — unico del lotto a non avere il prefisso `SP`, e attribuito
quindi a una Yamaha RX5.
