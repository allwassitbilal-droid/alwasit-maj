# alwasit-maj

Mises à jour automatiques des extensions **Autofill TLS** et **Autofill BLS** (Al Wasit).

- `version.json` : la dernière version de chaque extension (+ sha256 du ZIP).
- `tls/`, `bls/` : le ZIP de la dernière version.
- `installer-maj.cmd` : à lancer **une fois** sur chaque PC (double-clic). Il trouve les extensions dans Chrome
  et crée la tâche « AlWasit MAJ » qui, toutes les 15 minutes, installe la nouvelle version dans le même dossier.
  L'extension redémarre toute seule ; les données ne bougent pas.
- Journal sur le PC : `%LOCALAPPDATA%\AlWasitMaj\maj.log`.
- Enlever : PowerShell → `Unregister-ScheduledTask -TaskName "AlWasit MAJ" -Confirm:$false`.

Aucune donnée de client ici : seulement le code des extensions.
