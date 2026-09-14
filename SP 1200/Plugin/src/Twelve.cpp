// Twelve.cpp — Audio Unit (aufx) che applica il carattere di un campionatore
// a 12 bit / 26 kHz. Il DSP sta in TwelveDSP.h; qui c'è solo il guscio AU:
// parametri, preset e un kernel indipendente per canale.

#include <AudioUnitSDK/AUEffectBase.h>

#include "TwelveDSP.h"

#include <CoreFoundation/CoreFoundation.h>
#include <memory>

namespace {

enum : AudioUnitParameterID {
    kParam_Drive = 0,
    kParam_Clock,
    kParam_Bits,
    kParam_Alias,
    kParam_Cutoff,
    kParam_Reso,
    kParam_Noise,
    kParam_Mix,
    kParam_Output,
    kNumParams
};

// Il parametro Bits è indicizzato: l'indice 0 vale 6 bit, il 6 vale 12.
constexpr int kBitsMin = 6;
constexpr int kBitsMax = 16;
constexpr int kBitsCount = kBitsMax - kBitsMin + 1;

// I preset restano statici: GetPresets deve poter restituire puntatori che
// sopravvivono alla chiamata, e l'host non li libera.
const AUPreset kPresetList[] = {
    { 0, CFSTR("12 bit classico") },
    { 1, CFSTR("Accordato in basso") },
    { 2, CFSTR("Molto in basso") },
    { 3, CFSTR("12 bit pulito") },
    { 4, CFSTR("8 bit sfondato") },
    { 5, CFSTR("Piatti e percussioni") },
    { 6, CFSTR("Soffio del convertitore") },
};
constexpr int kNumPresets = static_cast<int>(sizeof(kPresetList) / sizeof(kPresetList[0]));

// Stessi indici di kPresetList, valori nell'ordine dell'enum dei parametri.
const float kPresetValues[kNumPresets][kNumParams] = {
    //  drive  clock    bits  alias  cutoff  reso  noise   mix    out
    {    0.0f, 26040.0f,  6.0f, 50.0f, 20000.0f, 0.0f, -96.0f, 100.0f,  0.0f },
    {    5.0f, 17500.0f,  6.0f, 65.0f, 20000.0f, 0.0f, -96.0f, 100.0f, -1.0f },
    {    6.0f, 12000.0f,  6.0f, 80.0f, 20000.0f, 0.0f, -96.0f, 100.0f, -2.0f },
    {    0.0f, 26040.0f,  6.0f, 10.0f, 20000.0f, 0.0f, -96.0f, 100.0f,  0.0f },
    {    9.0f, 14000.0f,  2.0f, 90.0f, 20000.0f, 0.0f, -96.0f, 100.0f, -3.0f },
    {    4.0f, 26040.0f,  6.0f, 60.0f,  9000.0f, 25.0f, -96.0f, 100.0f, -1.0f },
    {    2.0f, 26040.0f,  6.0f, 50.0f, 20000.0f, 0.0f, -74.0f, 100.0f, -1.0f },
};

} // namespace

// ---------------------------------------------------------------------------

class Twelve : public ausdk::AUEffectBase {
public:
    explicit Twelve(AudioComponentInstance ci);

    OSStatus GetParameterInfo(AudioUnitScope inScope, AudioUnitParameterID inID,
        AudioUnitParameterInfo& outInfo) override;
    OSStatus GetParameterValueStrings(
        AudioUnitScope inScope, AudioUnitParameterID inID, CFArrayRef* outStrings) override;

    OSStatus GetPresets(CFArrayRef* outData) const override;
    OSStatus NewFactoryPresetSet(const AUPreset& inPreset) override;

    // La coda del filtro 4 poli continua a suonare dopo la fine del segnale.
    bool SupportsTail() AUSDK_RTSAFE override { return true; }
    Float64 GetTailTime() AUSDK_RTSAFE override { return 0.05; }

    std::unique_ptr<ausdk::AUKernelBase> NewKernel() override;
};

// ---------------------------------------------------------------------------

class TwelveKernel : public ausdk::AUKernelBase {
public:
    explicit TwelveKernel(ausdk::AUEffectBase& au) : AUKernelBase(au) {}

    void Reset() override {
        mChannel.reset();
        mSampleRate = 0.0; // forza il riallineamento alla prossima chiamata
    }

    void Process(const Float32* src, Float32* dst, UInt32 frames,
        bool& ioSilence) AUSDK_RTSAFE override;

private:
    twelve::Channel mChannel;
    double mSampleRate = 0.0;
};

void TwelveKernel::Process(
    const Float32* src, Float32* dst, UInt32 frames, bool& ioSilence) AUSDK_RTSAFE
{
    const double sr = GetSampleRate();
    if (sr != mSampleRate) {
        mSampleRate = sr;
        // Seme diverso per canale, altrimenti il rumore sarebbe identico a
        // sinistra e a destra e si sentirebbe al centro invece che in aria.
        mChannel.prepare(sr, 0x9E3779B9u + GetChannelNum() * 2654435761u);
    }

    twelve::Params p;
    p.driveDb  = GetParameter(kParam_Drive);
    p.clockHz  = GetParameter(kParam_Clock);
    p.bits     = kBitsMin + static_cast<int>(std::lround(GetParameter(kParam_Bits)));
    p.alias01  = GetParameter(kParam_Alias) * 0.01;
    p.cutoffHz = GetParameter(kParam_Cutoff);
    p.reso01   = GetParameter(kParam_Reso) * 0.01;
    p.noiseDb  = GetParameter(kParam_Noise);
    p.mix01    = GetParameter(kParam_Mix) * 0.01;
    p.outDb    = GetParameter(kParam_Output);

    mChannel.process(src, dst, frames, p);

    // Col rumore acceso il plugin produce segnale anche a ingresso muto:
    // dichiararlo, o l'host taglia la catena a valle.
    if (p.noiseDb > twelve::kNoiseOffDb) {
        ioSilence = false;
    }
}

// ---------------------------------------------------------------------------

Twelve::Twelve(AudioComponentInstance ci) : AUEffectBase(ci, true)
{
    CreateElements();
    Globals()->UseIndexedParameters(kNumParams);

    // I valori di partenza coincidono col primo preset, che è la macchina
    // com'era: 26,04 kHz e 12 bit.
    for (AudioUnitParameterID i = 0; i < kNumParams; ++i) {
        SetParameter(i, kAudioUnitScope_Global, 0, kPresetValues[0][i], 0);
    }
    SetAFactoryPresetAsCurrent(kPresetList[0]);
}

std::unique_ptr<ausdk::AUKernelBase> Twelve::NewKernel()
{
    return std::make_unique<TwelveKernel>(*this);
}

OSStatus Twelve::GetParameterInfo(
    AudioUnitScope inScope, AudioUnitParameterID inID, AudioUnitParameterInfo& outInfo)
{
    if (inScope != kAudioUnitScope_Global) {
        return kAudioUnitErr_InvalidScope;
    }

    outInfo.flags = kAudioUnitParameterFlag_IsReadable | kAudioUnitParameterFlag_IsWritable;

    switch (inID) {
    case kParam_Drive:
        AUBase::FillInParameterName(outInfo, CFSTR("Drive"), false);
        outInfo.unit = kAudioUnitParameterUnit_Decibels;
        outInfo.minValue = 0.0f;
        outInfo.maxValue = 24.0f;
        outInfo.defaultValue = 0.0f;
        break;

    case kParam_Clock:
        AUBase::FillInParameterName(outInfo, CFSTR("Sample Clock"), false);
        outInfo.unit = kAudioUnitParameterUnit_Hertz;
        outInfo.minValue = 4000.0f;
        outInfo.maxValue = 48000.0f;
        outInfo.defaultValue = 26040.0f;
        outInfo.flags |= kAudioUnitParameterFlag_DisplayLogarithmic;
        break;

    case kParam_Bits:
        AUBase::FillInParameterName(outInfo, CFSTR("Resolution"), false);
        outInfo.unit = kAudioUnitParameterUnit_Indexed;
        outInfo.minValue = 0.0f;
        outInfo.maxValue = static_cast<float>(kBitsCount - 1);
        outInfo.defaultValue = 6.0f; // 12 bit
        break;

    case kParam_Alias:
        AUBase::FillInParameterName(outInfo, CFSTR("Aliasing"), false);
        outInfo.unit = kAudioUnitParameterUnit_Percent;
        outInfo.minValue = 0.0f;
        outInfo.maxValue = 100.0f;
        outInfo.defaultValue = 50.0f;
        break;

    case kParam_Cutoff:
        AUBase::FillInParameterName(outInfo, CFSTR("Filter"), false);
        outInfo.unit = kAudioUnitParameterUnit_Hertz;
        outInfo.minValue = 200.0f;
        outInfo.maxValue = 20000.0f;
        outInfo.defaultValue = 20000.0f; // spalancato = filtro spento
        outInfo.flags |= kAudioUnitParameterFlag_DisplayLogarithmic;
        break;

    case kParam_Reso:
        AUBase::FillInParameterName(outInfo, CFSTR("Resonance"), false);
        outInfo.unit = kAudioUnitParameterUnit_Percent;
        outInfo.minValue = 0.0f;
        outInfo.maxValue = 100.0f;
        outInfo.defaultValue = 0.0f;
        break;

    case kParam_Noise:
        AUBase::FillInParameterName(outInfo, CFSTR("Converter Noise"), false);
        outInfo.unit = kAudioUnitParameterUnit_Decibels;
        outInfo.minValue = -96.0f; // al minimo è spento
        outInfo.maxValue = -36.0f;
        outInfo.defaultValue = -96.0f;
        break;

    case kParam_Mix:
        AUBase::FillInParameterName(outInfo, CFSTR("Mix"), false);
        outInfo.unit = kAudioUnitParameterUnit_Percent;
        outInfo.minValue = 0.0f;
        outInfo.maxValue = 100.0f;
        outInfo.defaultValue = 100.0f;
        break;

    case kParam_Output:
        AUBase::FillInParameterName(outInfo, CFSTR("Output"), false);
        outInfo.unit = kAudioUnitParameterUnit_Decibels;
        outInfo.minValue = -24.0f;
        outInfo.maxValue = 12.0f;
        outInfo.defaultValue = 0.0f;
        break;

    default:
        return kAudioUnitErr_InvalidParameter;
    }

    return noErr;
}

OSStatus Twelve::GetParameterValueStrings(
    AudioUnitScope inScope, AudioUnitParameterID inID, CFArrayRef* outStrings)
{
    if (inScope == kAudioUnitScope_Global && inID == kParam_Bits) {
        if (outStrings == nullptr) {
            return noErr; // l'host sta solo chiedendo se esistono
        }
        CFMutableArrayRef names =
            CFArrayCreateMutable(nullptr, kBitsCount, &kCFTypeArrayCallBacks);
        for (int i = 0; i < kBitsCount; ++i) {
            CFStringRef s = CFStringCreateWithFormat(
                nullptr, nullptr, CFSTR("%d bit"), kBitsMin + i);
            CFArrayAppendValue(names, s);
            CFRelease(s);
        }
        *outStrings = names;
        return noErr;
    }

    return AUEffectBase::GetParameterValueStrings(inScope, inID, outStrings);
}

OSStatus Twelve::GetPresets(CFArrayRef* outData) const
{
    if (outData == nullptr) {
        return noErr; // l'host sta solo chiedendo se ci sono preset
    }

    // Array senza callback di retain: gli AUPreset sono statici e l'host li
    // legge senza prenderne possesso.
    CFMutableArrayRef presets = CFArrayCreateMutable(nullptr, kNumPresets, nullptr);
    for (int i = 0; i < kNumPresets; ++i) {
        CFArrayAppendValue(presets, &kPresetList[i]);
    }
    *outData = presets;
    return noErr;
}

OSStatus Twelve::NewFactoryPresetSet(const AUPreset& inPreset)
{
    const SInt32 n = inPreset.presetNumber;
    if (n < 0 || n >= kNumPresets) {
        return kAudioUnitErr_InvalidPropertyValue;
    }

    for (AudioUnitParameterID i = 0; i < kNumParams; ++i) {
        SetParameter(i, kAudioUnitScope_Global, 0, kPresetValues[n][i], 0);
    }
    SetAFactoryPresetAsCurrent(kPresetList[n]);
    return noErr;
}

// Genera TwelveFactory, il nome che Info.plist indica come factoryFunction.
AUSDK_COMPONENT_ENTRY(ausdk::AUBaseFactory, Twelve)
