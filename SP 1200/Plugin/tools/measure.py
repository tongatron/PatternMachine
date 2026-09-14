#!/usr/bin/env python3
"""Misura l'Audio Unit 'Twelve' facendoci passare segnali noti.

Non verifica una reimplementazione del DSP: genera WAV, li manda al plugin
installato tramite twelve-render, e analizza cosa torna. Le previsioni sono
scritte accanto ai risultati, così un numero fuori posto si vede subito.
"""

import os
import struct
import subprocess
import sys

import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.join(HERE, "..", "build", "twelve-render")
WORK = os.environ.get("TWELVE_WORK", "/tmp/twelve_measure")


def write_wav_f32(path, x, sr=SR):
    raw = np.asarray(x, dtype="<f4").tobytes()
    hdr = b"RIFF" + struct.pack("<I", 36 + len(raw)) + b"WAVE"
    hdr += b"fmt " + struct.pack("<IHHIIHH", 16, 3, 1, sr, sr * 4, 4, 32)
    hdr += b"data" + struct.pack("<I", len(raw))
    with open(path, "wb") as f:
        f.write(hdr + raw)


def read_wav_f32(path):
    with open(path, "rb") as f:
        data = f.read()
    pos, raw, bits = 12, None, None
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            bits = struct.unpack("<H", body[14:16])[0]
        elif cid == b"data":
            raw = body
        pos += 8 + size + (size & 1)
    assert bits == 32, f"atteso float a 32 bit, trovato {bits}"
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def render(name, x, **params):
    os.makedirs(WORK, exist_ok=True)
    src = os.path.join(WORK, f"{name}_in.wav")
    dst = os.path.join(WORK, f"{name}_out.wav")
    write_wav_f32(src, x)
    args = [RENDER, src, dst] + [f"{k}={v}" for k, v in params.items()]
    res = subprocess.run(args, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stdout, res.stderr)
        sys.exit(1)
    return read_wav_f32(dst)


def spectrum(x):
    """Spettro di ampiezza a finestra di Hann, scalato in unità di picco."""
    w = np.hanning(len(x))
    mag = np.abs(np.fft.rfft(x * w)) / (np.sum(w) / 2)
    freq = np.fft.rfftfreq(len(x), 1.0 / SR)
    return freq, mag


def db_at(freq, mag, target, bw=40.0):
    sel = (freq > target - bw) & (freq < target + bw)
    return 20 * np.log10(max(mag[sel].max(), 1e-13))


def db_rms(x):
    return 20 * np.log10(max(np.sqrt(np.mean(np.asarray(x) ** 2)), 1e-13))


def sine(f, amp=0.5, seconds=2.0):
    t = np.arange(int(SR * seconds)) / SR
    return amp * np.sin(2 * np.pi * f * t)


A, L = int(SR * 0.3), int(SR * 1.2)


def steady(y):
    """Ritaglia la parte a regime, via l'attacco e la coda."""
    return y[A:A + L]


def line(label, value, expected=""):
    print(f"  {label:<38} {value:>11}   {expected}")


print("=" * 84)
print("MISURE SUL PLUGIN INSTALLATO")
print("=" * 84)

# --- 1. neutralità a riposo, e crescita col Drive --------------------------
# clock al massimo = nessuna decimazione, 16 bit = quantizzazione trascurabile:
# resta solo lo stadio d'ingresso.
print("\n1. Stadio d'ingresso: 2a armonica relativa, tono 1 kHz a 0,5")
print("   (clock 48k e 16 bit isolano il waveshaper dal resto della catena)")
for drive in (0, 6, 12, 18):
    y = steady(render(f"drv{drive}", sine(1000, 0.5), clock=48000, bits=16, alias=100,
                      drive=drive))
    f, m = spectrum(y)
    fund = db_at(f, m, 1000)
    line(f"Drive {drive:>2} dB -> 2a armonica",
         f"{db_at(f, m, 2000) - fund:+.1f} dB",
         "deve essere molto basso" if drive == 0 else "deve crescere")

# --- 2. ripiegamento governato dal controllo Aliasing ---------------------
# Tono a 16 kHz campionato a 26,04 kHz: ripiega a 26040-16000 = 10040 Hz.
# 16 kHz e non 20: vicino a Nyquist dell'host il filtro digitale ha uno zero
# che falserebbe la misura.
print("\n2. Ripiegamento: tono 16 kHz, clock 26,04 kHz -> alias previsto a 10040 Hz")
for alias in (0, 25, 50, 75, 100):
    y = steady(render(f"fold{alias}", sine(16000, 0.5), clock=26040, bits=16, alias=alias))
    f, m = spectrum(y)
    line(f"Aliasing {alias:>3}% -> livello a 10040 Hz", f"{db_at(f, m, 10040):+.1f} dB",
         "monotono crescente")

# --- 3. il clock gira davvero a 26,04 kHz ---------------------------------
# Il campiona-e-tieni a 26,04 kHz dentro un flusso a 44,1 kHz produce immagini
# a 26040±1000, che ripiegano a 44100-27040 = 17060 e 44100-25040 = 19060 Hz.
print("\n3. Frequenza reale del clock: tono 1 kHz, immagini previste a 17060 e 19060 Hz")
y = steady(render("clock", sine(1000, 0.5), clock=26040, bits=16, alias=100))
f, m = spectrum(y)
ref = db_at(f, m, 1000)
line("immagine a 17060 Hz", f"{db_at(f, m, 17060) - ref:+.1f} dB", "presente")
line("immagine a 19060 Hz", f"{db_at(f, m, 19060) - ref:+.1f} dB", "presente")
line("controllo a 15000 Hz (nessuna immagine)", f"{db_at(f, m, 15000) - ref:+.1f} dB",
     "molto piu' basso")

# --- 4. la quantizzazione è quella dichiarata -----------------------------
# Misura differenziale: senza dither l'errore di quantizzazione è correlato al
# segnale e finisce dentro le armoniche, non in un pavimento di rumore, quindi
# cercarlo "fra le righe" non funziona. Si confronta invece ogni rendering con
# uno a 16 bit: la differenza è l'errore del quantizzatore più grosso.
print("\n4. Quantizzazione: errore RMS rispetto allo stesso rendering a 16 bit")
print("   Il filtro di ricostruzione attenua anche l'errore, quindi i valori stanno")
print("   sotto il teorico: l'invariante da controllare e' la spaziatura, 24 dB ogni 4 bit.")
src = sine(1000, 0.7)
ref16 = steady(render("q16", src, clock=26040, bits=16, alias=30))
errs = {}
for bits in (12, 10, 8):
    y = steady(render(f"q{bits}", src, clock=26040, bits=bits, alias=30))
    errs[bits] = db_rms(y - ref16)
    q = 2.0 / (2 ** bits)
    line(f"{bits:>2} bit -> errore RMS", f"{errs[bits]:+.1f} dB",
         f"teorico crudo q/sqrt(12) = {20 * np.log10(q / np.sqrt(12)):+.1f} dB")
line("spaziatura 12 -> 8 bit", f"{errs[8] - errs[12]:+.1f} dB", "teorico +24,1 dB")

# --- 5. il rumore del convertitore ----------------------------------------
print("\n5. Rumore del convertitore su ingresso muto")
silence = np.zeros(int(SR * 1.8))
for noise in (-96, -72, -54):
    y = steady(render(f"n{noise}", silence, noise=noise))
    line(f"Converter Noise {noise} dB -> RMS uscita", f"{db_rms(y):+.1f} dB",
         "spento" if noise == -96 else "il quantizzatore ne mangia una parte")

# --- 6. il filtro 4 poli ---------------------------------------------------
print("\n6. Filtro 4 poli: tono 4 kHz, cutoff 1 kHz")
dry = steady(render("vcf_off", sine(4000, 0.5), clock=48000, bits=16, cutoff=20000))
wet = steady(render("vcf_on", sine(4000, 0.5), clock=48000, bits=16, cutoff=1000))
f1, m1 = spectrum(dry)
f2, m2 = spectrum(wet)
line("attenuazione 2 ottave sopra il cutoff",
     f"{db_at(f2, m2, 4000) - db_at(f1, m1, 4000):+.1f} dB", "teorico -48 dB (24 dB/ottava)")

# --- 7. Mix a 0 deve restituire il segnale intatto ------------------------
print("\n7. Mix 0% = passante esatto")
src = sine(1000, 0.5)
y = render("mix0", src, mix=0, drive=18, bits=6, clock=8000)[:len(src)]
line("differenza dall'ingresso", f"{db_rms(y - src):+.1f} dB", "deve essere nullo")

print("\n" + "=" * 84)
