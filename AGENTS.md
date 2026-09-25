# Note per agenti AI — PatternMachine

## App per macOS (Electron): non toccarla se non è l'utente a chiederlo

L'app per Mac si aggiorna **solo ogni tanto e solo su richiesta esplicita dell'utente**.
Se il lavoro in corso riguarda il sito, lascia l'app com'è, anche quando sembrerebbe utile allinearla.

Senza una richiesta esplicita **non** vanno:
- modificati i file in `desktop/` (`main.js`, `preload.js`, `bridge/`, `electron-builder.config.cjs`, `scripts/`, `package.json`, `README.md`);
- modificati la pagina di download `site/app.html` o i file in `site/download/` (zip dell'app e `app.json`);
- lanciati `desktop/scripts/release.sh`, `npm run dist` o qualsiasi nuova build dell'app;
- alzata la versione dell'app in `desktop/package.json`.

`scripts/deploy.sh` pubblica il contenuto già presente in `site/download/` insieme al sito: va bene così, ma non rigenerare lo zip prima di pubblicare.

### Se una modifica al sito tocca l'app

`desktop/bridge/bridge.js` sostituisce dall'esterno alcune funzioni globali di `site/index.html`: `trigger`, `stop`, `makeZip`, `setStatus`, `db` e `downloadsCap`. Inoltre `clockStep()` è una copia di `scheduler()`.
Se cambi una di queste parti del sito, **non correggere l'app**: a fine lavoro avvisa l'utente che l'app andrà allineata al prossimo aggiornamento.
