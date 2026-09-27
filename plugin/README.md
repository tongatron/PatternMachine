# PatternMachine come plug-in per Logic (Audio Unit, JUCE 8)

PatternMachine dentro Logic, su una traccia strumento: si apre la finestra del plug-in e c'è il sito,
si preme Play in Logic e i pattern suonano a tempo, dalla battuta giusta, senza clock MIDI da configurare.

## Come funziona

| Parte | Dove | Cosa fa |
|---|---|---|
| Interfaccia | `../site` in un WebView (WKWebView) | Il sito così com'è: griglia, blocchi, sequencer, libreria, export. Viene copiato nel bundle, quindi il plug-in funziona offline e senza il repository |
| Ponte | `bridge/plugin-bridge.js` | Come `desktop/bridge/bridge.js` per l'app, ma per il plug-in: sostituisce `trigger`, `play`, `stop`, `setStatus`, `db`, `downloadsCap` e manda ogni modifica del progetto al C++ entro 0,1 s |
| Motore | `Source/Engine.cpp` | Sequencer e campionatore in C++, dentro `processBlock`: gli step si calcolano dal PPQ di Logic, al campione, con swing, probabilità, ripetizioni, flam, intonazione/decay/filtro per step, umanizza, nudge, poliritmi, choke, canzone con fill |
| Stato | `Source/PluginProcessor.cpp` | Il progetto si salva **dentro il progetto di Logic** (e suona anche senza aprire la finestra) |

Il sync è automatico perché è Logic a chiamare il plug-in a ogni blocco audio con la posizione esatta:
- **Play/Stop/tempo/cambi di tempo** arrivano da Logic, nessuna impostazione da fare.
- **Posizione**: lo step 1 cade sulla battuta 1 di Logic. In modalità *Canzone* la canzone parte dalla battuta 1 (nel pre-roll tace) e ricomincia alla fine; in modalità *Pattern* il pattern selezionato gira sempre allineato alle battute.
- **Cicli e salti** del righello: il motore si riposiziona sullo step che cade lì.
- **Bounce** e bounce offline funzionano, perché l'audio esce dal plug-in e non dal WebView.

L'audio passa dal canale di Logic (effetti, mixer, automazione del volume), 6 dB sotto il volume del sito per lasciare margine
(con i volumi del sito il canale di Logic andava oltre 0 dBFS). Con Logic fermo, il Play della pagina fa
un'anteprima a tempo di Logic; i pad, l'anteprima dei blocchi e l'ascolto della libreria suonano sempre dal plug-in.
Le **note MIDI in ingresso** sulla traccia suonano le righe: nota 36 (C1) = riga 1, 37 = riga 2... (i pad dell'MPK).

Progetti ed export usano le stesse cartelle dell'app per Mac:
`~/Music/PatternMachine/Progetti` (Salva / Progetti salvati) e `~/Music/PatternMachine/Export`
(MIDI, WAV, MP3, pacchetto Logic; il pulsante **Export ↗** accanto al Play apre la cartella nel Finder).

## Compilarlo

Servono i Command Line Tools di Xcode (Xcode completo non serve) e `brew install cmake ninja`.

```bash
plugin/scripts/build.sh --test   # scarica JUCE 8.0.15 in plugin/.deps, prove del motore, build, installazione, auval
```

Installa in `~/Library/Audio/Plug-Ins/Components/PatternMachine.component` (AU) e `.../VST3/PatternMachine.vst3`;
la versione Standalone (per provare senza Logic) resta in `plugin/build/PatternMachine_artefacts/Release/Standalone/`.
Ogni build copia di nuovo `site/` (senza `site/download`) e `bridge/` nei bundle, anche in quelli già installati.

In Logic: nuova traccia **Strumento software** › slot Strumento › **AU Instruments › Tongatron › PatternMachine**.
Se Logic non lo vede: *Logic Pro › Impostazioni › Plug-in Manager › Reimposta e ripeti la scansione*.

### Più canali in Logic

Logic può usare più istanze stereo del plug-in anche quando il menu AU non offre Multi-Output.
Duplica la traccia PatternMachine, apri ogni istanza e usa il selettore **Istanza** accanto al badge Logic:
scegli **Tutti** per l'istanza completa oppure una singola riga (BD, SD, HH, ecc.). Ogni istanza suona solo
quella riga e resta su un canale separato del mixer; l'assegnazione viene salvata nel progetto di Logic.

## Se cambia il sito

- `scheduler()`, `trigger()`, `stepHits()`, `stepIdx()` o il formato di `mods` in `site/index.html`: vanno allineati in `Source/Engine.cpp`.
- Campi nuovi di traccia o pattern che cambiano il suono: aggiungerli a `engineState()` in `bridge/plugin-bridge.js` e a `Snapshot::fromVar`.
- Il resto del sito (grafica, libreria, export) passa da solo al prossimo `build.sh`.

## Limiti del prototipo

- Il plug-in non è firmato con un certificato Apple Developer: va bene sul proprio Mac, non per distribuirlo.
- I kit personali importati nell'app per Mac (`__kits/`) non ci sono: il plug-in suona i kit del sito.
- La testina e il contatore nella finestra si aggiornano 30 volte al secondo (l'audio invece è al campione).
- In Logic il menu AU può esporre soltanto Mono/Stereo: per i canali separati usare la modalità a istanze,
  duplicando la traccia e assegnando una riga diversa dal selettore Istanza. Il routing AU multi-output diretto
  resta sperimentale e dipende dall'host.
- Le modifiche arrivano al motore entro circa 0,1 s: un colpo scritto proprio sullo step che sta per suonare può saltare quel giro.
