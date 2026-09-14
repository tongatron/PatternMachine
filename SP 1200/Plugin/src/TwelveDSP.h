// TwelveDSP.h — la catena di un campionatore a 12 bit / 26 kHz.
//
// L'ordine degli stadi conta più dei singoli stadi:
//   drive analogico -> anti-alias poco ripido -> campiona-e-tieni al clock
//   -> quantizzazione senza dither -> lowpass 4 poli risonante -> uscita
//
// Le due firme che fanno il suono non sono effetti aggiunti ma conseguenze:
// il ripiegamento nasce dal filtro anti-alias volutamente dolce, e la grana
// nasce dall'assenza di dither sul quantizzatore.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace twelve {

inline double dbToLin(double db) { return std::pow(10.0, db / 20.0); }

// Azzera i denormali: gli stati dei filtri che decadono verso zero possono
// finire nel dominio denormale e costare CPU senza portare segnale.
inline double flushDenorm(double v) { return (std::fabs(v) < 1.0e-18) ? 0.0 : v; }

// ---------------------------------------------------------------------------
// Blocco della continua (HP 1 polo a 5 Hz).
// Serve perché il drive asimmetrico e il quantizzatore introducono un offset
// che altrimenti si accumula nei filtri a valle.
// ---------------------------------------------------------------------------
class DCBlock {
public:
    void setSampleRate(double sr) { mR = 1.0 - (2.0 * M_PI * 5.0 / sr); }
    void reset() { mX1 = mY1 = 0.0; }

    double process(double x) {
        const double y = x - mX1 + mR * mY1;
        mX1 = x;
        mY1 = flushDenorm(y);
        return y;
    }

private:
    double mR = 0.99929, mX1 = 0.0, mY1 = 0.0;
};

// ---------------------------------------------------------------------------
// SVF a topologia preservata (Zavalishin), uscita lowpass 2 poli.
// Fa da filtro anti-alias davanti al convertitore. Due poli sono pochi di
// proposito: è la pendenza dolce che lascia ripiegare le frequenze sopra
// Nyquist, ed è quel ripiegamento il carattere che si cerca.
// ---------------------------------------------------------------------------
class SVFLowpass {
public:
    void setSampleRate(double sr) { mSR = sr; mLastHz = -1.0; }
    void reset() { mIc1 = mIc2 = 0.0; mLastHz = -1.0; }

    void setCutoff(double hz) {
        // Ricalcola solo a variazione apprezzabile: tan() per campione è
        // spreco quando il parametro è fermo.
        if (std::fabs(hz - mLastHz) <= mLastHz * 1.0e-3) return;
        mLastHz = hz;
        const double g = std::tan(M_PI * std::clamp(hz, 20.0, mSR * 0.49) / mSR);
        const double k = 1.4142135623730951; // 1/Q con Q = 1/sqrt(2)
        mA1 = 1.0 / (1.0 + g * (g + k));
        mA2 = g * mA1;
        mA3 = g * mA2;
    }

    double process(double x) {
        const double v3 = x - mIc2;
        const double v1 = mA1 * mIc1 + mA2 * v3;
        const double v2 = mIc2 + mA2 * mIc1 + mA3 * v3;
        mIc1 = flushDenorm(2.0 * v1 - mIc1);
        mIc2 = flushDenorm(2.0 * v2 - mIc2);
        return v2;
    }

private:
    double mSR = 44100.0;
    double mA1 = 0.0, mA2 = 0.0, mA3 = 0.0;
    double mIc1 = 0.0, mIc2 = 0.0;
    double mLastHz = -1.0;
};

// ---------------------------------------------------------------------------
// Lowpass 4 poli con saturazione nell'anello di retroazione, nello spirito
// dell'SSM2044 che sulla macchina originale sta a valle del convertitore,
// una istanza per voce. Qui è l'ultimo stadio, così smussa gli scalini del
// campiona-e-tieni esattamente come fa il filtro analogico vero.
// ---------------------------------------------------------------------------
class Ladder4 {
public:
    void setSampleRate(double sr) { mSR = sr; mLastHz = -1.0; }
    void reset() {
        for (double& s : mS) s = 0.0;
        mLast = 0.0;
        mLastHz = -1.0;
    }

    void setCutoff(double hz) {
        if (std::fabs(hz - mLastHz) <= mLastHz * 1.0e-3) return;
        mLastHz = hz;
        const double g = std::tan(M_PI * std::clamp(hz, 20.0, mSR * 0.45) / mSR);
        mG = g / (1.0 + g);
    }

    // 0..1 sull'interfaccia, fino a poco sotto l'auto-oscillazione.
    void setResonance(double r01) { mK = std::clamp(r01, 0.0, 1.0) * 3.8; }

    double process(double x) {
        // Il termine su x compensa la perdita di basse quando la risonanza
        // sale, che altrimenti svuota il suono invece di stringerlo.
        double u = std::tanh(x * (1.0 + 0.35 * mK) - mK * mLast);
        for (double& s : mS) {
            const double v = (u - s) * mG;
            const double y = v + s;
            s = flushDenorm(y + v);
            u = y;
        }
        mLast = flushDenorm(u);
        return u;
    }

private:
    double mSR = 44100.0;
    double mG = 0.5, mK = 0.0;
    double mS[4] = { 0.0, 0.0, 0.0, 0.0 };
    double mLast = 0.0, mLastHz = -1.0;
};

// ---------------------------------------------------------------------------
// Rumore bianco xorshift32: deterministico, senza stato globale, senza
// allocazioni, quindi usabile nel thread audio.
// ---------------------------------------------------------------------------
class Noise {
public:
    void seed(uint32_t s) { mState = (s == 0u) ? 0x9E3779B9u : s; }

    double next() {
        mState ^= mState << 13;
        mState ^= mState >> 17;
        mState ^= mState << 5;
        return static_cast<double>(static_cast<int32_t>(mState)) * (1.0 / 2147483648.0);
    }

private:
    uint32_t mState = 0x9E3779B9u;
};

// ---------------------------------------------------------------------------
// Il convertitore: campiona a un clock proprio, indipendente dalla frequenza
// dell'host, e tiene il valore fino al colpo successivo.
//
// È il punto in cui si gioca il trucco storico: abbassare il clock abbassa
// Nyquist, quindi "accordare in basso per sporcare" qui si ottiene senza
// toccare l'intonazione.
// ---------------------------------------------------------------------------
class Converter {
public:
    void setSampleRate(double sr) { mSR = sr; }
    void reset() { mPhase = 0.0; mHeld = 0.0; }

    void setClock(double hz) { mInc = std::clamp(hz, 1000.0, mSR) / mSR; }
    void setBits(int bits) {
        // 2^bits livelli distribuiti sull'intervallo [-1, 1].
        mStep = 2.0 / static_cast<double>(1u << static_cast<unsigned>(std::clamp(bits, 4, 24)));
    }

    double process(double x, double noiseAmp, Noise& noise) {
        mPhase += mInc;
        if (mPhase >= 1.0) {
            mPhase -= std::floor(mPhase);
            // Il rumore entra prima del quantizzatore, come il rumore di un
            // convertitore vero: interagisce con i gradini invece di sedersi
            // sopra al risultato.
            double v = x + (noiseAmp > 0.0 ? noiseAmp * noise.next() : 0.0);
            v = std::clamp(v, -1.0, 1.0);
            // Arrotondamento secco, nessun dither: la distorsione di
            // quantizzazione resta correlata al segnale, ed è voluta.
            mHeld = std::clamp(std::round(v / mStep) * mStep, -1.0, 1.0);
        }
        return mHeld; // tenuto, non interpolato: lo scalino è il suono
    }

private:
    double mSR = 44100.0;
    double mInc = 0.5, mPhase = 0.0, mHeld = 0.0;
    double mStep = 1.0 / 2048.0; // 12 bit
};

// ---------------------------------------------------------------------------
// Interpolatore a un polo per i parametri continui, così l'automazione non
// produce scalini udibili a ogni buffer.
// ---------------------------------------------------------------------------
class Smooth {
public:
    void setSampleRate(double sr) { mA = 1.0 - std::exp(-2.0 * M_PI * 20.0 / sr); }
    void snap(double v) { mV = v; }
    double next(double target) {
        mV += mA * (target - mV);
        return mV;
    }

private:
    double mA = 0.002, mV = 0.0;
};

// ---------------------------------------------------------------------------
// Parametri, nelle unità che vede l'utente.
// ---------------------------------------------------------------------------
struct Params {
    double driveDb  = 0.0;
    double clockHz  = 26040.0; // frequenza di campionamento della macchina
    int    bits     = 12;
    double alias01  = 0.5;     // 0 = anti-alias prudente, 1 = spalancato
    double cutoffHz = 20000.0; // >= kVCFBypassHz significa filtro spento
    double reso01   = 0.0;
    double noiseDb  = -96.0;   // <= kNoiseOffDb significa rumore spento
    double mix01    = 1.0;
    double outDb    = 0.0;
};

inline constexpr double kHeadroom    = 3.0;   // headroom del waveshaper d'ingresso
inline constexpr double kVCFBypassHz = 19500.0;
inline constexpr double kNoiseOffDb  = -95.0;

// ---------------------------------------------------------------------------
// Un canale completo. La macchina originale è monofonica per voce, quindi
// un'istanza indipendente per canale è anche la scelta fedele.
// ---------------------------------------------------------------------------
class Channel {
public:
    void prepare(double sr, uint32_t noiseSeed) {
        mDcIn.setSampleRate(sr);
        mDcOut.setSampleRate(sr);
        mAA.setSampleRate(sr);
        mRecon.setSampleRate(sr);
        mVCF.setSampleRate(sr);
        mConv.setSampleRate(sr);
        mDriveSm.setSampleRate(sr);
        mOutSm.setSampleRate(sr);
        mMixSm.setSampleRate(sr);
        mCutSm.setSampleRate(sr);
        mResSm.setSampleRate(sr);
        mAASm.setSampleRate(sr);
        mNoise.seed(noiseSeed);
        reset();
    }

    void reset() {
        mDcIn.reset();
        mDcOut.reset();
        mAA.reset();
        mRecon.reset();
        mVCF.reset();
        mConv.reset();
        mPrimed = false;
    }

    void process(const float* in, float* out, uint32_t n, const Params& p) {
        const double clock  = std::clamp(p.clockHz, 4000.0, 48000.0);
        // Il cutoff dell'anti-alias è ancorato al clock del convertitore: a 0
        // sta ben sotto Nyquist (suono scuro, poco ripiegamento), a 1 lo
        // scavalca. La corsa è scelta perché il controllo lavori su tutto
        // l'arco e non si esaurisca a metà.
        const double aaTarget = clock * (0.28 + 0.62 * std::clamp(p.alias01, 0.0, 1.0));
        const double driveG = dbToLin(p.driveDb);
        const double outG   = dbToLin(p.outDb);
        const double mix    = std::clamp(p.mix01, 0.0, 1.0);
        const bool   vcfOn  = p.cutoffHz < kVCFBypassHz;
        // Il filtro di ricostruzione sta a Nyquist del convertitore, che è il
        // suo punto di progetto naturale: non è un controllo, è una parte fissa
        // della macchina.
        const double reconFc = clock * 0.5;
        // sqrt(3) converte l'ampiezza di un uniforme nel suo valore RMS, così
        // il numero in dB sull'interfaccia è il livello che si misura davvero.
        const double noiseA =
            (p.noiseDb <= kNoiseOffDb) ? 0.0 : dbToLin(p.noiseDb) * 1.7320508075688772;

        mConv.setClock(clock);
        mConv.setBits(p.bits);

        // Alla prima chiamata i parametri partono già a valore, così non si
        // sente una rampa d'ingresso quando il plugin viene inserito.
        if (!mPrimed) {
            mDriveSm.snap(driveG);
            mOutSm.snap(outG);
            mMixSm.snap(mix);
            mCutSm.snap(p.cutoffHz);
            mResSm.snap(p.reso01);
            mAASm.snap(aaTarget);
            mPrimed = true;
        }

        for (uint32_t i = 0; i < n; ++i) {
            const double dry = static_cast<double>(in[i]);

            // 1. stadio d'ingresso: clip morbido asimmetrico.
            //    L'headroom tiene il segnale nella parte lineare di tanh a
            //    guadagno unitario, così a Drive 0 dB lo stadio non colora;
            //    l'asimmetria, che produce le armoniche pari udibili come
            //    "calore", compare solo man mano che si spinge.
            const double g  = mDriveSm.next(driveG);
            const double xd = dry * g;
            const double asym = 0.15 * (1.0 - 1.0 / std::max(g, 1.0e-9));
            const double u = (xd + asym * xd * xd) * (1.0 / kHeadroom);
            //    Compensazione a metà: il drive scalda ma non diventa solo volume.
            double x = std::tanh(u) * kHeadroom / std::sqrt(std::max(g, 1.0e-9));
            x = mDcIn.process(x);

            // 2. anti-alias dolce
            mAA.setCutoff(mAASm.next(aaTarget));
            x = mAA.process(x);

            // 3. campiona-e-tieni al clock + quantizzazione
            double y = mConv.process(x, noiseA, mNoise);

            // 3b. filtro di ricostruzione a valle del convertitore. Sulla
            //     macchina vera è l'SSM2044 dietro ogni DAC, a cutoff fisso:
            //     attenua le immagini del campiona-e-tieni, ed è una delle
            //     ragioni per cui il suono risulta scuro.
            mRecon.setCutoff(reconFc);
            y = mRecon.process(y);

            // 4. lowpass 4 poli analogico in coda
            if (vcfOn) {
                mVCF.setCutoff(mCutSm.next(p.cutoffHz));
                mVCF.setResonance(mResSm.next(p.reso01));
                y = mVCF.process(y);
            } else {
                mCutSm.snap(p.cutoffHz);
                mResSm.snap(p.reso01);
            }

            y = mDcOut.process(y) * mOutSm.next(outG);

            const double m = mMixSm.next(mix);
            out[i] = static_cast<float>(dry * (1.0 - m) + y * m);
        }
    }

private:
    DCBlock    mDcIn, mDcOut;
    SVFLowpass mAA, mRecon;
    Converter  mConv;
    Ladder4    mVCF;
    Noise      mNoise;
    Smooth     mDriveSm, mOutSm, mMixSm, mCutSm, mResSm, mAASm;
    bool       mPrimed = false;
};

} // namespace twelve
