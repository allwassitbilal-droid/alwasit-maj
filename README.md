# alwasit-maj

Mises à jour automatiques des extensions **Autofill TLS** et **Autofill BLS** (Al Wasit).

- `version.json` : la dernière version de chaque extension (+ sha256 du ZIP).
- `tls/`, `bls/` : le ZIP de la dernière version.
- `installer-maj.cmd` : à lancer **une fois** sur chaque PC (double-clic). Il trouve les extensions dans Chrome
  et crée la tâche « AlWasit MAJ » qui, toutes les 15 minutes, installe la nouvelle version dans le même dossier.
  L'extension redémarre toute seule ; les données ne bougent pas.
- Journal sur le PC : `%LOCALAPPDATA%\AlWasitMaj\maj.log`.
- Enlever : PowerShell → `Unregister-ScheduledTask -TaskName "AlWasit MAJ" -Confirm:$false`.

- `telephone/` : la page du téléphone (À faire, Clients, Bilan). Une fois le site Netlify lié à ce dépôt, chaque changement
  sur `main` est publié tout seul (`netlify.toml` : dossier `telephone`, pas de build).

Aucune donnée de client ici : seulement le code des extensions.

- `supabase-traductions.sql` : à lancer **une fois** dans Supabase (SQL Editor) pour le tableau « traductions »
  (📝 Traductions dans les extensions et sur le téléphone).

- 🔄 Annonce Telegram de chaque mise à jour (une seule fois, par le premier PC / téléphone) :
  extensions → écrire les nouveautés de la version dans `nouveautes.json` ; téléphone → changer `VERSION` et `NOUVEAUTES` en haut de `telephone/app.js`.

- `telephone/caisse/` : l'app « Caisse » (entrées / sorties de l'agence, écrites à la main), publiée sur `…netlify.app/caisse/`.
  `supabase-caisse.sql` : à lancer **une fois** dans Supabase (SQL Editor) pour le tableau « caisse ».
  Annonce Telegram : changer `VERSION` et `NOUVEAUTES` en haut de `telephone/caisse/caisse.js`.
