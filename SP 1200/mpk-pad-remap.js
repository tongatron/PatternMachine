// Logic Pro — Scripter (MIDI FX), da inserire sulla traccia del kit "SP-1200 Kit"
// prima dello strumento (Drum Machine Designer), sullo slot MIDI FX.
//
// Presuppone la mappatura di fabbrica più comune per i pad Akai MPK Mini (mk2/mk3/Play):
//   Banco A: pad 1-8 = C1-G1  (note MIDI 36-43)
//   Banco B: pad 1-8 = C2-G2  (note MIDI 48-55)
//
// Il Banco A coincide già con i pad 1-8 del kit SP-1200 (Kick1...Closed Hat 1),
// vedi SP 1200/README.md sezione 3. Il Banco B viene trasposto di -4 semitoni
// per continuare da dove finisce il Banco A (Closed Hat 2...Cymbal, pad 9-16).
//
// Se i tuoi pad mandano note diverse da queste (verificabile con l'Event List di
// Logic), cambia i due valori qui sotto di conseguenza.

var BANK_B_LOW = 48;
var BANK_B_HIGH = 55;
var BANK_B_SHIFT = -4;

function HandleMIDI(event) {
    if (event instanceof NoteOn || event instanceof NoteOff) {
        if (event.pitch >= BANK_B_LOW && event.pitch <= BANK_B_HIGH) {
            event.pitch += BANK_B_SHIFT;
        }
    }
    event.send();
}
