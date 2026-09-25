// Configurazione del pacchetto .app. I kit 808/909 estratti da Logic sono contenuti Apple: entrano
// nell'app solo con PM_KIT_LOGIC=1 (per uso personale), mai nella versione da scaricare.
const withLogicKits = process.env.PM_KIT_LOGIC === "1";

module.exports = {
  appId: "org.tongatron.patternmachine",
  productName: "PatternMachine",
  directories: { output: "dist" },
  files: ["main.js", "preload.js", "bridge/**", "package.json"],
  extraResources: [{
    from: "../site", to: "site",
    // sw.js non serve (niente service worker su app://); download/ e app.html sono la pagina per scaricare l'app
    filter: ["**/*", "!sw.js", "!app.html", "!download/**", "!**/.DS_Store",
      ...(withLogicKits ? [] : ["!machines/tr808/**", "!machines/tr909/**"])],
  }],
  mac: {
    category: "public.app-category.music",
    icon: "../site/icons/icon-512.png",
    identity: null,   // niente firma Apple: la firma ad-hoc la mette scripts/release.sh
  },
};
