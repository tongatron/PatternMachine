// Configurazione del pacchetto desktop. Progetto personale: ogni build include tutti i suoni del sito,
// compresi i kit delle macchine in site/machines.

module.exports = {
  appId: "org.tongatron.patternmachine",
  productName: "PatternMachine",
  npmRebuild: false,
  directories: { output: "dist" },
  files: ["main.js", "preload.js", "bridge/**", "package.json"],
  extraResources: [{
    from: "../site", to: "site",
    // sw.js non serve (niente service worker su app://); download/ e app.html sono la pagina per scaricare l'app
    filter: ["**/*", "!sw.js", "!app.html", "!download/**", "!**/.DS_Store"],
  }],
  mac: {
    category: "public.app-category.music",
    icon: "../site/icons/icon-512.png",
    identity: null,   // niente firma Apple: la firma ad-hoc la mette scripts/release.sh
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "../site/icons/icon-512.png",
  },
  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }],
    category: "AudioVideo",
    icon: "../site/icons",
  },
};
