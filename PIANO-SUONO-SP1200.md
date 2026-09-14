# Piano — controlli di voce in stile SP-1200

Obiettivo: avvicinare il player web al comportamento della E-mu SP-1200 aggiungendo i
parametri per suono che l'hardware aveva e che oggi mancano in `site/index.html`.

## 1. Stato attuale

Il motore audio (`trigger()`) è volutamente minimo: `BufferSource → Gain → destination`.

Per traccia esistono già:

| Parametro | Dove | Note |
|---|---|---|
| Tune | `track.tune`, ±12 st | via `playbackRate`, quindi varia anche la durata — come sul nastro/hardware |
| Volume | `track.vol` | slider per riga |
| Choke group | `track.choke` | troncamento esclusivo (hi-hat) |
| Mute / Solo | `track.mute/solo` | |
| Velocity | 2 livelli nello step (normale / accento) | |
| Swing | globale | |
| 16 / 12 bit | due set di campioni pre-cotti | nessun DSP a runtime |

Manca tutto ciò che sull'originale serviva a "scolpire" il singolo suono.

## 2. Cosa aggiungere

Distinguo ciò che c'era davvero sulla macchina da ciò che è un'estensione moderna,
così le scelte restano oneste.

| # | Parametro | Autenticità | Implementazione |
|---|---|---|---|
| 1 | **Decay** 0–100 | **Autentico.** Ogni suono sull'SP-1200 ha un decay che accorcia la coda; è il controllo più usato (kick corti, hat secchi). | Rampa di gain a fine "hold" + `src.stop()` |
| 2 | **Filtro** (cutoff + resonance) | **Derivato dall'hardware.** Le 8 uscite individuali passano da VCF SSM2044 a 4 poli: è parte del suono della macchina, anche se sul pannello non è regolabile. | Due `BiquadFilterNode` lowpass in cascata = 24 dB/ott |
| 3 | **Start / truncate** 0–100 | **Autentico.** La pagina di edit ha il truncate dei punti di inizio/fine. | `src.start(time, offset)` |
| 4 | **Reverse** | **Estensione moderna.** L'SP-1200 non ha il reverse; lo aggiungo perché costa pochissimo ed è utile. | Buffer invertito in cache |

| 5 | **Output assign 1–8** | **Autentico.** Otto uscite individuali sul retro, per portare ogni suono al mixer con la sua catena. | Otto bus Web Audio + scheda Mixer |

Scartati per ora, con motivo:

- **Sampling/registrazione** — fuori scopo, il kit è fisso a 42 campioni.
- **Bitcrush 12 bit a runtime** — già coperto dal set `samples12` pre-processato e dal
  plugin AU `Twelve`; rifarlo in JS duplicherebbe lavoro già fatto meglio.

## 3. Modello dati

`makeTrack()` guadagna cinque campi, tutti con default = "neutro" (nessun cambiamento
di suono rispetto a oggi, così i progetti salvati restano identici all'ascolto):

```js
decay:   100,    // 100 = campione intero
cutoff:  100,    // 100 = filtro spento (20 kHz)
reso:    0,      // Q minimo
start:   0,      // nessun offset
reverse: false
```

Mappature:

- cutoff `0…100` → `200 · 100^(v/100)` Hz, cioè 200 Hz → 20 kHz logaritmico;
  sopra 19 kHz il filtro non viene proprio inserito nella catena (zero costo).
- resonance `0…100` → `Q 0.7 … 12`, applicata solo al primo dei due stadi per non
  far esplodere il guadagno in risonanza.
- decay: curva quadratica (`hold = durata · d²`) per avere risoluzione fine sui
  valori corti, dove serve.

`serialize()` / `deserialize()` vanno estesi con i nuovi campi, con fallback ai default
per i progetti già salvati.

## 4. UI

La riga traccia è già affollata (pad, nome, sample, M, S, Grp, Tune, Vol, ×): aggiungere
cinque controlli inline la farebbe sbordare — esattamente il bug appena corretto.

Soluzione: un pulsante **⚙** per riga che apre un pannello parametri sotto l'intestazione,
chiuso di default. Lo stato aperto/chiuso vive solo nella UI, non nel progetto.

## 5. Limiti noti

- I parametri agiscono **solo sulla riproduzione nel browser**: l'export MIDI resta
  note + velocity, quindi in Logic il suono dipende dal kit, non da questi controlli.
- Il filtro è un'approssimazione a biquad in cascata, non un modello dell'SSM2044
  (niente saturazione in retroazione).

## 6. Verifica

1. Progetto esistente salvato → ricaricato: suono invariato (default neutri).
2. Decay basso su kick → coda troncata, nessun click.
3. Cutoff basso + resonance alta → suono scuro e risonante, nessuna saturazione digitale.
4. Reverse + start → il campione parte dal punto giusto del buffer invertito.
5. Choke group ancora funzionante con filtro inserito nella catena.
6. Layout: riga traccia e pannello dentro il contenitore a 1100 px e a larghezza mobile.

## 7. Esito

Implementato tutto il punto 2. Misure fatte rendendo `trigger()` in un
`OfflineAudioContext` (kick, campione da 74 ms):

| Test | Risultato |
|---|---|
| Decay 20 | RMS d'attacco 0,395 → 0,205: la coda viene troncata |
| Filtro a ~630 Hz | indice di brillantezza 0,032 → 0,019 (−41 %) |
| Reverse | inversione esatta campione per campione, attacco 0,395 → 0,208 |
| Start 50 % | attacco 0,395 → 0,129: il transiente iniziale viene saltato |
| Choke + filtro | nessuna eccezione, audio prodotto |
| Round-trip salva/carica | i cinque parametri sopravvivono |
| Progetto senza i campi nuovi | torna ai default neutri |
| Layout a 1280 px e 375 px | nessuna sbordatura, nessuno scroll orizzontale |

Un bug trovato dal test offline: `src.stop()` veniva chiamato **prima** di
`src.start()`, cosa vietata dalla Web Audio API — con qualunque decay < 100 ogni
colpo avrebbe lanciato `InvalidStateError`. Corretto spostando lo stop dopo lo start.

## 8. Uscite individuali — esito

Ogni uscita è una striscia di canale: livello, pan, low shelf (120 Hz), high shelf
(4 kHz), compressore. `out 0` resta il mix diretto, invariato rispetto a prima.
L'assegnazione si fa dal pannello ⚙ della riga, la scheda **Mixer** mostra le otto strisce.

| Test | Risultato |
|---|---|
| Uscita neutra vs mix diretto | 0,00 dB — assegnare un'uscita non cambia il volume |
| Out 8 vs Out 1 | 0,00 dB — bus identici |
| Livello 50 % | rapporto 0,500 esatto |
| Pan tutto a sinistra / destra | un canale al pieno, l'altro a zero |
| Low shelf +12 dB su kick | +5,33 dB |
| High shelf ±12 dB su hi-hat | −10,13 / +11,56 dB |
| Comp all'1 % | +0,20 dB (nessun gradino all'accensione) |
| Salva/ricarica | uscita per traccia e impostazioni dei bus conservate |
| Progetto senza mixer | default neutri |
| Layout 1280 px / 375 px | otto strisce in riga; a mobile scorre il mixer, non la pagina |

Tre problemi emersi solo dalle misure, tutti corretti:

1. **Il compressore non è trasparente** nemmeno a rapporto 1:1 e knee 0: toglie circa
   10 dB. Da spento va tenuto proprio fuori dalla catena, e quando è acceso serve un
   recupero fisso (×3,162) per non avere un gradino di livello all'accensione.
2. **`DynamicsCompressorNode` esce sempre a 2 canali**, anche impostandone
   `channelCount = 1`: essendo collegato al panner ne portava l'ingresso a stereo, e il
   panner passava dalla legge mono a quella stereo. Risolto con un `GainNode` a
   `channelCount = 1` esplicito prima del panner.
3. **La legge di pan al centro costa −3 dB** rispetto al percorso diretto mono→stereo:
   compensato con `Math.SQRT2` sul livello del bus, così l'assegnazione è a volume invariato.
