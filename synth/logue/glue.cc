// Colla tra un'unita' oscillatore della logue-sdk di KORG (NTS-1 mkII) e il synth del sito.
//
// Il websim di Korg compila le unita' con le Wasm Audio Worklets di Emscripten: servono thread e
// SharedArrayBuffer, quindi gli header COOP/COEP, che il sito non puo' avere (analytics, app, plug-in).
// Qui invece l'unita' diventa un modulo .wasm "standalone" senza JavaScript di contorno: poche funzioni C
// che il nostro AudioWorklet (site/engine/synth-worklet.js) chiama direttamente, un'istanza per voce.
//
// Si compila con synth/build-logue.sh insieme a header.c dell'unita' e agli shim di websim/dsp
// (tabelle d'onda del firmware, osc_api). La frequenza di lavoro resta 48 kHz come sull'hardware:
// se l'AudioContext gira a 44,1 kHz ricampiona il worklet.

#include <cstdint>
#include "osc.h"

extern const unit_header_t unit_header;

static Osc s_osc;
static float s_out[512];
static float s_in[1024];   // l'ingresso audio (stereo interleaved) non si usa: resta a zero

#define EXPORT(name) extern "C" __attribute__((export_name(name), used))

EXPORT("lu_init") void lu_init() {
  s_osc.init(nullptr);
  s_osc.reset();
  for (int i = 0; i < unit_header.num_params; ++i)
    s_osc.setParameter(i, unit_header.params[i].init);
  s_osc.resume();
}

EXPORT("lu_out") float *lu_out() { return s_out; }

// frames <= 512. Il tono arriva come w0 = f / 48000 (0.5 = Nyquist), come fa unit_render sull'hardware.
EXPORT("lu_render") void lu_render(float w0, float shape_lfo, int frames) {
  if (frames > 512) frames = 512;
  s_osc.setPitch(w0);
  s_osc.setShapeLfo(shape_lfo);
  s_osc.process(s_in, s_out, (uint32_t)frames);
}

EXPORT("lu_note_on") void lu_note_on(int note, int velo) { s_osc.noteOn((uint8_t)note, (uint8_t)velo); }
EXPORT("lu_note_off") void lu_note_off(int note) { s_osc.noteOff((uint8_t)note); }
EXPORT("lu_all_note_off") void lu_all_note_off() { s_osc.allNoteOff(); }

EXPORT("lu_set_param") void lu_set_param(int id, int value) {
  if (id < 0 || id >= unit_header.num_params) return;
  const unit_param_t &p = unit_header.params[id];
  if (value < p.min) value = p.min;
  if (value > p.max) value = p.max;
  s_osc.setParameter((uint8_t)id, value);
}

// Descrizione dell'unita' per l'interfaccia: nome, parametri (min, max, default, tipo, nome), testi.
EXPORT("lu_name") const char *lu_name() { return unit_header.name; }
EXPORT("lu_num_params") int lu_num_params() { return unit_header.num_params; }
EXPORT("lu_param_min") int lu_param_min(int i) { return unit_header.params[i].min; }
EXPORT("lu_param_max") int lu_param_max(int i) { return unit_header.params[i].max; }
EXPORT("lu_param_init") int lu_param_init(int i) { return unit_header.params[i].init; }
EXPORT("lu_param_type") int lu_param_type(int i) { return unit_header.params[i].type; }
EXPORT("lu_param_frac") int lu_param_frac(int i) { return unit_header.params[i].frac; }
EXPORT("lu_param_name") const char *lu_param_name(int i) { return unit_header.params[i].name; }
EXPORT("lu_param_str") const char *lu_param_str(int i, int value) {
  const char *s = s_osc.getParameterStrValue((uint8_t)i, value);
  return s ? s : "";
}
