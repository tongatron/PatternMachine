# Privacy — TODO interno

Nota di lavoro non destinata alla pubblicazione. Da rivedere prima della prossima revisione della privacy policy.

## Priorità alta

- [ ] Smettere di inviare la password in chiaro nell’email di benvenuto. Usare un link monouso per impostare la password.
- [ ] Confermare il nome legale completo del titolare e un indirizzo email dedicato per richieste privacy.
- [ ] Definire tempi di conservazione concreti per account, progetti, storico download, segnalazioni, log tecnici e analytics.
- [ ] Verificare retention, hosting dei dati e accordi/DPA di Umami, hosting, servizio email e Telegram.
- [ ] Implementare cancellazione account e cancellazione completa dei progetti associati, con procedura verificabile.

## Dati e minimizzazione

- [ ] Ridurre le informazioni tecniche inserite automaticamente nelle segnalazioni: oggi viene inviato anche l’user-agent completo.
- [ ] Stabilire se lo storico dei download è realmente necessario; limitarlo o anonimizzarlo se non serve.
- [ ] Documentare esplicitamente quali dati vengono salvati nel `localStorage` del browser e per quanto tempo restano lì.
- [ ] Verificare che l’analytics resti senza cookie di tracciamento e senza identificatori persistenti.

## Archiviazione e database

- [ ] Valutare il passaggio dai file JSON a SQLite come prossimo passo: transazioni, concorrenza, indici, backup e cancellazioni più affidabili.
- [ ] Passare a PostgreSQL solo se aumentano utenti, processi concorrenti o necessità di scalabilità.
- [ ] Se si resta su JSON: documentare backup cifrati, rotazione, permessi, restore testato e limiti della lock interna al singolo processo.
- [ ] Aggiungere job periodici per eliminare reset token scaduti, tombstone vecchie e dati oltre il periodo di conservazione.
- [ ] Verificare che backup e copie temporanee rispettino gli stessi permessi e tempi di conservazione dei dati originali.

## Sicurezza applicativa

- [ ] Aggiungere CSP, HSTS e `Permissions-Policy`, mantenendo compatibilità con analytics e audio web.
- [ ] Valutare sessioni revocabili lato server e una gestione esplicita del logout da tutti i dispositivi.
- [ ] Rendere persistente il rate limiting se il servizio viene eseguito con più processi o più nodi.
- [ ] Verificare periodicamente dipendenze, configurazione HTTPS e accesso minimo ai file `data/`.

## Policy e processo

- [ ] Aggiornare la policy pubblica con titolare, contatto, destinatari, trasferimenti internazionali e tempi di conservazione verificati.
- [ ] Tenere traccia della data di ogni modifica alla policy e del trattamento effettivamente attivo.
- [ ] Preparare una procedura per accesso, rettifica, cancellazione, limitazione, opposizione e portabilità.
- [ ] Far revisionare la versione definitiva da un professionista privacy prima di usarla come informativa ufficiale.
