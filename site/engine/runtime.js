// Runtime condiviso dell'interfaccia web.
//
// I moduli dell'app girano in contesti diversi: browser normale, PWA, preview
// offline e bridge nativo. Questo piccolo adapter tiene le differenze di
// piattaforma fuori dalla logica di dominio e rende la persistenza tollerante
// a private browsing, quota esaurita e storage disabilitato.
(function (root) {
  "use strict";

  function createStorage(factory) {
    const getStore = () => {
      try { return factory() || null; }
      catch (_error) { return null; }
    };

    return Object.freeze({
      get(key, fallback = null) {
        const store = getStore();
        if (!store) return fallback;
        try {
          const value = store.getItem(key);
          return value === null ? fallback : value;
        } catch (_error) { return fallback; }
      },

      set(key, value) {
        const store = getStore();
        if (!store) return false;
        try { store.setItem(key, String(value)); return true; }
        catch (_error) { return false; }
      },

      remove(key) {
        const store = getStore();
        if (!store) return false;
        try { store.removeItem(key); return true; }
        catch (_error) { return false; }
      },

      getJson(key, fallback = null) {
        const value = this.get(key);
        if (value === null) return fallback;
        try { return JSON.parse(value); }
        catch (_error) { return fallback; }
      },

      setJson(key, value) {
        try { return this.set(key, JSON.stringify(value)); }
        catch (_error) { return false; }
      },
    });
  }

  const storage = Object.freeze({
    local: createStorage(() => root.localStorage),
    session: createStorage(() => root.sessionStorage),
  });

  const capabilities = Object.freeze({
    audioWorklet: !!root.AudioWorkletNode,
    indexedDb: !!root.indexedDB,
    mediaRecorder: !!root.MediaRecorder,
    midi: !!root.navigator?.requestMIDIAccess,
    serviceWorker: !!root.navigator?.serviceWorker,
    compression: !!root.CompressionStream && !!root.DecompressionStream,
  });

  root.PMRuntime = Object.freeze({
    capabilities,
    storage,
    isDesktop: !!root.pmDesktop,
  });
})(typeof window !== "undefined" ? window : globalThis);
