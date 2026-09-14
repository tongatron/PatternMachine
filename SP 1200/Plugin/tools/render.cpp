// render.cpp — host offline minimo: fa passare un WAV attraverso l'Audio Unit
// "Twelve" già installata e scrive il risultato.
//
//   twelve-render ingresso.wav uscita.wav [nome=valore ...]
//
// Nomi dei parametri: drive clock bits alias cutoff reso noise mix output
// (bits si indica in bit veri, per esempio bits=12)
// In più: tail=secondi, quanto silenzio aggiungere in coda (default 0,5)
//
// Serve a due cose: misurare il plugin fuori dal DAW, e processare in blocco
// una cartella di campioni senza aprire Logic.

#include <AudioToolbox/AudioToolbox.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr OSType kType    = 'aufx';
constexpr OSType kSubType = 'Sp12';
constexpr OSType kManu    = 'Tnga';

// Stesso ordine dell'enum dentro il plugin.
const char* kParamNames[] = { "drive", "clock", "bits", "alias", "cutoff", "reso", "noise", "mix",
    "output" };
constexpr int kNumParams = 9;

struct Source {
    std::vector<std::vector<float>> channels;
    UInt32 pos = 0;
};

OSStatus FeedInput(void* refCon, AudioUnitRenderActionFlags* /*flags*/,
    const AudioTimeStamp* /*ts*/, UInt32 /*bus*/, UInt32 frames, AudioBufferList* io)
{
    auto* src = static_cast<Source*>(refCon);
    const UInt32 total = static_cast<UInt32>(src->channels[0].size());

    for (UInt32 c = 0; c < io->mNumberBuffers; ++c) {
        auto* dst = static_cast<float*>(io->mBuffers[c].mData);
        const auto& in = src->channels[c < src->channels.size() ? c : 0];
        for (UInt32 i = 0; i < frames; ++i) {
            const UInt32 p = src->pos + i;
            // Oltre la fine del file si alimenta silenzio, così la coda del
            // filtro può estinguersi dentro il file di uscita.
            dst[i] = (p < total) ? in[p] : 0.0f;
        }
    }
    src->pos += frames;
    return noErr;
}

bool Check(OSStatus s, const char* what)
{
    if (s == noErr) {
        return true;
    }
    std::fprintf(stderr, "errore %d in %s\n", static_cast<int>(s), what);
    return false;
}

AudioStreamBasicDescription MakeFloatFormat(double sr, UInt32 channels)
{
    AudioStreamBasicDescription f {};
    f.mSampleRate = sr;
    f.mFormatID = kAudioFormatLinearPCM;
    f.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked
                   | kAudioFormatFlagIsNonInterleaved;
    f.mBitsPerChannel = 32;
    f.mChannelsPerFrame = channels;
    f.mFramesPerPacket = 1;
    f.mBytesPerFrame = 4;
    f.mBytesPerPacket = 4;
    return f;
}

} // namespace

int main(int argc, char** argv)
{
    if (argc < 3) {
        std::fprintf(stderr,
            "uso: twelve-render ingresso.wav uscita.wav [drive=6 clock=26040 bits=12 ...]\n");
        return 2;
    }

    // ---- lettura del file d'ingresso ------------------------------------
    CFStringRef inPath = CFStringCreateWithCString(nullptr, argv[1], kCFStringEncodingUTF8);
    CFURLRef inURL = CFURLCreateWithFileSystemPath(nullptr, inPath, kCFURLPOSIXPathStyle, false);
    ExtAudioFileRef inFile = nullptr;
    if (!Check(ExtAudioFileOpenURL(inURL, &inFile), "apertura ingresso")) {
        return 1;
    }

    AudioStreamBasicDescription fileFmt {};
    UInt32 sz = sizeof(fileFmt);
    ExtAudioFileGetProperty(inFile, kExtAudioFileProperty_FileDataFormat, &sz, &fileFmt);

    const UInt32 nch = fileFmt.mChannelsPerFrame;
    const double sr = fileFmt.mSampleRate;
    AudioStreamBasicDescription client = MakeFloatFormat(sr, nch);
    ExtAudioFileSetProperty(
        inFile, kExtAudioFileProperty_ClientDataFormat, sizeof(client), &client);

    SInt64 nFrames = 0;
    sz = sizeof(nFrames);
    ExtAudioFileGetProperty(inFile, kExtAudioFileProperty_FileLengthFrames, &sz, &nFrames);

    Source src;
    src.channels.assign(nch, std::vector<float>(static_cast<size_t>(nFrames), 0.0f));
    {
        const UInt32 block = 4096;
        std::vector<std::vector<float>> tmp(nch, std::vector<float>(block));
        std::vector<AudioBuffer> bufs(nch);
        SInt64 done = 0;
        while (done < nFrames) {
            UInt32 want = static_cast<UInt32>(std::min<SInt64>(block, nFrames - done));
            AudioBufferList* abl = static_cast<AudioBufferList*>(
                std::calloc(1, sizeof(AudioBufferList) + sizeof(AudioBuffer) * (nch - 1)));
            abl->mNumberBuffers = nch;
            for (UInt32 c = 0; c < nch; ++c) {
                abl->mBuffers[c].mNumberChannels = 1;
                abl->mBuffers[c].mDataByteSize = want * 4;
                abl->mBuffers[c].mData = tmp[c].data();
            }
            UInt32 got = want;
            ExtAudioFileRead(inFile, &got, abl);
            if (got == 0) {
                std::free(abl);
                break;
            }
            for (UInt32 c = 0; c < nch; ++c) {
                std::memcpy(&src.channels[c][static_cast<size_t>(done)], tmp[c].data(), got * 4);
            }
            done += got;
            std::free(abl);
        }
        nFrames = done;
        for (auto& ch : src.channels) {
            ch.resize(static_cast<size_t>(nFrames));
        }
    }
    ExtAudioFileDispose(inFile);

    // ---- istanziazione dell'Audio Unit ----------------------------------
    AudioComponentDescription desc {};
    desc.componentType = kType;
    desc.componentSubType = kSubType;
    desc.componentManufacturer = kManu;
    AudioComponent comp = AudioComponentFindNext(nullptr, &desc);
    if (comp == nullptr) {
        std::fprintf(stderr, "Audio Unit 'Twelve' non trovata. Hai lanciato build.sh?\n");
        return 1;
    }

    AudioUnit au = nullptr;
    if (!Check(AudioComponentInstanceNew(comp, &au), "creazione istanza")) {
        return 1;
    }

    AudioUnitSetProperty(
        au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &client, sizeof(client));
    AudioUnitSetProperty(
        au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0, &client, sizeof(client));

    const UInt32 slice = 512;
    AudioUnitSetProperty(au, kAudioUnitProperty_MaximumFramesPerSlice, kAudioUnitScope_Global, 0,
        &slice, sizeof(slice));

    AURenderCallbackStruct cb {};
    cb.inputProc = FeedInput;
    cb.inputProcRefCon = &src;
    AudioUnitSetProperty(
        au, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &cb, sizeof(cb));

    if (!Check(AudioUnitInitialize(au), "inizializzazione")) {
        return 1;
    }

    // ---- parametri da riga di comando -----------------------------------
    // Mezzo secondo di default per far uscire la coda del filtro; sui one-shot
    // di batteria conviene molto meno, per non allungare i campioni.
    double tailSeconds = 0.5;

    for (int a = 3; a < argc; ++a) {
        const std::string arg = argv[a];
        const size_t eq = arg.find('=');
        if (eq == std::string::npos) {
            std::fprintf(stderr, "argomento ignorato (manca '='): %s\n", argv[a]);
            continue;
        }
        const std::string name = arg.substr(0, eq);
        float value = std::strtof(arg.c_str() + eq + 1, nullptr);

        if (name == "tail") {
            tailSeconds = value;
            continue;
        }

        int id = -1;
        for (int i = 0; i < kNumParams; ++i) {
            if (name == kParamNames[i]) {
                id = i;
                break;
            }
        }
        if (id < 0) {
            std::fprintf(stderr, "parametro sconosciuto: %s\n", name.c_str());
            continue;
        }
        // "bits" si scrive in bit veri; il plugin lo vuole come indice da 6.
        if (id == 2) {
            value -= 6.0f;
        }
        AudioUnitSetParameter(au, static_cast<AudioUnitParameterID>(id), kAudioUnitScope_Global, 0,
            value, 0);
        std::printf("  %-7s = %g\n", name.c_str(), std::strtod(arg.c_str() + eq + 1, nullptr));
    }

    // ---- file d'uscita ---------------------------------------------------
    // Float a 32 bit: non voglio che una riquantizzazione in uscita si
    // confonda con quella che il plugin applica di proposito.
    AudioStreamBasicDescription outFmt {};
    outFmt.mSampleRate = sr;
    outFmt.mFormatID = kAudioFormatLinearPCM;
    outFmt.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    outFmt.mBitsPerChannel = 32;
    outFmt.mChannelsPerFrame = nch;
    outFmt.mFramesPerPacket = 1;
    outFmt.mBytesPerFrame = 4 * nch;
    outFmt.mBytesPerPacket = 4 * nch;

    CFStringRef outPath = CFStringCreateWithCString(nullptr, argv[2], kCFStringEncodingUTF8);
    CFURLRef outURL = CFURLCreateWithFileSystemPath(nullptr, outPath, kCFURLPOSIXPathStyle, false);
    ExtAudioFileRef outFile = nullptr;
    if (!Check(ExtAudioFileCreateWithURL(outURL, kAudioFileWAVEType, &outFmt, nullptr,
                  kAudioFileFlags_EraseFile, &outFile),
            "creazione uscita")) {
        return 1;
    }
    ExtAudioFileSetProperty(
        outFile, kExtAudioFileProperty_ClientDataFormat, sizeof(client), &client);

    // ---- ciclo di rendering ---------------------------------------------
    const SInt64 tail = static_cast<SInt64>(sr * tailSeconds);
    const SInt64 totalOut = nFrames + tail;

    std::vector<std::vector<float>> outBuf(nch, std::vector<float>(slice));
    AudioBufferList* abl = static_cast<AudioBufferList*>(
        std::calloc(1, sizeof(AudioBufferList) + sizeof(AudioBuffer) * (nch - 1)));

    AudioTimeStamp ts {};
    ts.mFlags = kAudioTimeStampSampleTimeValid;

    SInt64 rendered = 0;
    while (rendered < totalOut) {
        const UInt32 frames = static_cast<UInt32>(std::min<SInt64>(slice, totalOut - rendered));
        abl->mNumberBuffers = nch;
        for (UInt32 c = 0; c < nch; ++c) {
            abl->mBuffers[c].mNumberChannels = 1;
            abl->mBuffers[c].mDataByteSize = frames * 4;
            abl->mBuffers[c].mData = outBuf[c].data();
        }
        AudioUnitRenderActionFlags flags = 0;
        ts.mSampleTime = static_cast<Float64>(rendered);
        if (!Check(AudioUnitRender(au, &flags, &ts, 0, frames, abl), "render")) {
            return 1;
        }
        if (!Check(ExtAudioFileWrite(outFile, frames, abl), "scrittura")) {
            return 1;
        }
        rendered += frames;
    }

    std::free(abl);
    ExtAudioFileDispose(outFile);
    AudioUnitUninitialize(au);
    AudioComponentInstanceDispose(au);

    std::printf("scritti %lld campioni a %.0f Hz, %u canali -> %s\n",
        static_cast<long long>(rendered), sr, nch, argv[2]);
    return 0;
}
