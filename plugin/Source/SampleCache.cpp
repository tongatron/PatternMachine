#include "SampleCache.h"

SampleCache::SampleCache (juce::File root) : siteRoot (std::move (root))
{
    formats.registerBasicFormats();
}

juce::File SampleCache::resolve (const juce::String& relativePath) const
{
    auto rel = juce::URL::removeEscapeChars (relativePath).trimCharactersAtStart ("/");
    if (rel.isEmpty() || rel.contains ("..")) return {};
    auto f = siteRoot.getChildFile (rel);
    return f.isAChildOf (siteRoot) ? f : juce::File();
}

const SampleData* SampleCache::get (const juce::String& relativePath)
{
    if (auto it = cache.find (relativePath); it != cache.end())
        return it->second.get();

    std::unique_ptr<SampleData> data;
    auto file = resolve (relativePath);
    if (file.existsAsFile())
    {
        if (std::unique_ptr<juce::AudioFormatReader> reader { formats.createReaderFor (file) })
        {
            auto len = (int) juce::jmin<juce::int64> (reader->lengthInSamples, 30 * (juce::int64) reader->sampleRate);
            auto chans = (int) juce::jlimit (1u, 2u, reader->numChannels);
            data = std::make_unique<SampleData>();
            data->sampleRate = reader->sampleRate;
            data->fwd.setSize (chans, juce::jmax (1, len));
            data->fwd.clear();
            reader->read (&data->fwd, 0, len, 0, true, chans > 1);
            data->rev.makeCopyOf (data->fwd);
            data->rev.reverse (0, data->rev.getNumSamples());
        }
    }
    // Anche un file mancante resta in cache (come nullptr): non si riprova a ogni modifica.
    auto* raw = data.get();
    cache.emplace (relativePath, std::move (data));
    return raw;
}
