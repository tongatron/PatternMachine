# PatternTXT 1.0

PatternTXT è un formato testuale minimale per descrivere pattern di batteria/step-sequencer e convertirli in MIDI.

## Obiettivi

- leggibile e scrivibile a mano;
- facile da generare con script o AI;
- indipendente da Logic Pro;
- importabile in Logic tramite MIDI;
- stabile e versionabile.

## Intestazione

```txt
PATTERNTXT 1.0
TEMPO 120
TIME 4/4
RESOLUTION 1/16
```

Campi:

- `PATTERNTXT 1.0` — versione del formato.
- `TEMPO` — BPM interi o decimali.
- `TIME` — metrica, per esempio `4/4`, `3/4`, `6/8`.
- `RESOLUTION` — valore di uno step: `1/4`, `1/8`, `1/16`, `1/32`.

## Mappa MIDI

```txt
MAP
BD=36
SN=38
HH=42
OH=46
CRASH=49
ENDMAP
```

Il numero è la nota MIDI (0–127).

Default consigliati, compatibili con General MIDI:

- BD / Kick = 36
- SN / Snare = 38
- HH / Closed Hi-Hat = 42
- OH / Open Hi-Hat = 46
- CRASH = 49
- RIDE = 51
- CLAP = 39
- RIM = 37

## Pattern e battute

```txt
PATTERN Verse

BAR 1
HH    X - X - | X - X - | X - X - | X - X -
SN    - - - - | X - - - | - - - - | X - - -
BD    X - - X | - - X - | X - - X | - X - -
```

Un file può contenere più blocchi `PATTERN`.

Ogni `BAR` contiene una o più righe di strumenti.

Il simbolo `|` e gli spazi sono ignorati.

Sono quindi equivalenti:

```txt
HH X - X - | X - X - | X - X - | X - X -
HH X-X-X-X-X-X-X-X-
```

## Simboli degli step

- `-` = nessun evento
- `x` = colpo debole, velocity 70
- `X` = colpo normale, velocity 100
- `>` = accento, velocity 127

PatternTXT 1.0 non definisce flam, ratchet, probability o microtiming. Queste funzioni possono essere aggiunte in versioni successive.

## Regole

1. Ogni riga strumento deve usare un nome presente in `MAP`.
2. Tutte le righe della stessa battuta devono avere lo stesso numero di step.
3. Il numero di step atteso per battuta deriva da `TIME` e `RESOLUTION`.
4. In `4/4` con `RESOLUTION 1/16`, una battuta contiene 16 step.
5. I commenti iniziano con `#`.
6. I nomi di pattern possono contenere spazi.
7. I nomi degli strumenti non possono contenere spazi.

## Durata delle note MIDI

Il convertitore di riferimento genera note brevi, pari al 50% della durata dello step.
Per batteria e Drum Machine Designer questo evita sovrapposizioni indesiderate.

## Esempio completo

```txt
PATTERNTXT 1.0
TEMPO 120
TIME 4/4
RESOLUTION 1/16

MAP
BD=36
SN=38
HH=42
CRASH=49
ENDMAP

PATTERN Big Black A

BAR 1
HH     X - X - | X - X - | X - X - | X - X -
SN     - - - - | X - - - | - - - - | X - - -
BD     X - - X | - - X - | X - - X | - X - -
CRASH  X - - - | - - - - | - - - - | - - - -

BAR 2
HH     X - X - | X - X - | X - X - | X - X -
SN     - - - - | X - - - | - - - - | X - - -
BD     X - X - | - X - X | X - - X | - - X -
CRASH  - - - - | - - - - | - - - - | - - - -
```

## Estensione file consigliata

- `.ptxt`
- `.pattern.txt`

Entrambe sono semplici file di testo UTF-8.
