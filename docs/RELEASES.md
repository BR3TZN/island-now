# GitHub und Updates

Konfiguriertes Projekt: `BR3TZN/island-now`.

Die erste öffentliche Version mit integriertem Updater ist **1.2.0**. Version 1.1 war die vorherige Entwicklungs-ZIP. Nutzer der Entwicklungs-ZIP kopieren die neue Version einmal manuell in ihren bisherigen Ordner und behalten `.data`. Eine alte selbst erzeugte `Island-Now.exe` aus Version 1.1 muss beim Umstieg durch die neue EXE ersetzt oder vor dem erneuten Start entfernt werden.

## Erstes Repository und Release veröffentlichen

Der Quellcode und die GitHub-Workflows sind vorbereitet. Erst nach dem tatsächlichen Anlegen und Hochladen ist das Projekt unter GitHub erreichbar. Für die Veröffentlichung über den eigenen Windows-PC sind Git und GitHub CLI erforderlich; die Anmeldung erfolgt über `gh auth login` im Konto **BR3TZN**.

Im Projektordner:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-github.ps1
```

Das Skript legt das öffentliche Repository an, lädt den Quellcode hoch und startet den Release-Workflow. Es überschreibt keine abweichende Remote-Historie. Es benötigt keine im Projekt gespeicherten Zugangsdaten. Die Ausführungsrichtlinie wird nur für diesen Prozess gesetzt.

Alternativ nach dem Hochladen auf GitHub: **Actions → Release → Run workflow**. Der Workflow liest `package.json`, führt die Tests aus, kompiliert die Windows-Tray-Anwendung und erstellt ZIP, Dateimanifest und SHA-256-Datei. Erst nach erfolgreichem Upload wird das zunächst als Entwurf angelegte Release veröffentlicht. Ein unterbrochener Entwurf lässt sich durch erneuten Workflow-Start fortsetzen. Bereits veröffentlichte Versionen werden nicht ersetzt.

## Eine neue Version veröffentlichen

1. Änderungen im Quellcode durchführen.
2. `version` in `package.json` erhöhen, z. B. von `1.2.0` auf `1.3.0`, und `CHANGELOG.md` aktualisieren.
3. `node --test` ausführen, committen und auf `main` pushen.
4. Unter **Actions → Release → Run workflow** starten. Alternativ den passenden Tag `v1.3.0` pushen.
5. Warten, bis der Release-Workflow erfolgreich beendet ist. Danach können Nutzer nach Updates suchen.

Nur Dateien hochzuladen oder den Titel eines vorhandenen Releases zu ändern erzeugt keine neue Version. `package.json`, Release-Tag und Dateimanifest müssen übereinstimmen. Die Update-Funktion verwendet ausschließlich stabile Releases, keine Entwürfe oder Vorabversionen.

## Update auf einem Nutzer-PC

Ein vorhandenes Windows-Paket ab **1.2.0** findet neue Versionen über **Updates → Nach Updates suchen**. **Update installieren** übernimmt auch die neue automatische Node-Einrichtung ab **1.2.2**. Für einen Test die App in einen eigenen Ordner entpacken und keine zweite Instanz gleichzeitig auf demselben Port starten.

Die Oberfläche prüft beim Öffnen auf Wunsch das neueste öffentliche Release. Im Bereich **Updates** stehen installierte Version, verfügbare Version, Änderungen und **Update installieren**. Es wird ausschließlich nach Bestätigung installiert.

Unter Windows übernimmt die Tray-Anwendung den Neustart. ZIP-Hash und einzelne Dateihashes werden geprüft. Das Paket darf keine privaten Datenordner, Pfadtraversierung, Verknüpfungen oder doppelte Dateinamen enthalten. Der Installer sichert ersetzte Programmdateien unter `.updates/backups`, kopiert die neue Version und prüft den Neustart. Bei Fehlern versucht er, die bisherigen Programmdateien wiederherzustellen. `.data`, darin gespeicherte Spotify-Anmeldungen, Profile und OBS-Links sind nicht Bestandteil des Pakets und werden nicht durch Paketdateien ersetzt.

Die Bedienoberfläche und OBS-Browserquelle laden sich nach erkanntem Versionswechsel neu. Während des Neustarts kann das Widget kurz ausgeblendet sein. Windows-Tray ist für die automatische Installation erforderlich; Konsolenstart und andere Betriebssysteme können Releases prüfen und die ZIP manuell verwenden. Zum erstmaligen Nutzen der neuen Update-Funktion ist das manuelle Update von 1.1 auf 1.2 erforderlich.

## Paketformat

Das Windows-Paket benötigt keine vorherige Node-Installation. Der Tray verwendet vorhandenes Node ab Version 22 oder lädt die passende offizielle LTS-Laufzeit beim ersten Start nach. Der lokale Ordner `runtime/` wird weder in Releases gepackt noch durch Update-Dateien überschrieben. Der Node-Download ist von der GitHub-Paketprüfung getrennt und prüft fest hinterlegte ZIP- und EXE-Hashes. Beim Aktualisieren der privaten Laufzeit in `windows/NodeRuntime.cs` müssen Version und alle vier offiziellen SHA-256-Werte für x64/ARM64 gemeinsam geändert werden. Eine ältere private Laufzeit wird dann beim nächsten Start ersetzt; eine kompatible Systeminstallation bleibt bevorzugt.

GitHub erstellt `Island-Now-<version>-windows.zip` und die gleichnamige `.sha256`-Datei. Im ZIP liegen die Dateien unter `Island-Now/`. `update-manifest.json` enthält App-Kennung, Version, Plattform, Dateigrößen und SHA-256-Werte. Der GitHub-Digest des ZIPs wird bevorzugt, die SHA-256-Datei dient als kompatibler Ersatz. Die Verbindung zu GitHub erfolgt über HTTPS; GitHub-Zugangsdaten sind auf Nutzer-PCs nicht erforderlich.

Quellpaket erstellen: `node scripts/package.mjs`. Windows-Paket auf Windows erstellen: `powershell -File scripts/build-windows.ps1`, danach `node scripts/package.mjs --windows`.

## Stand der Prüfung

Automatisierte Tests prüfen Versionserkennung, ZIP-Validierung, Downloads und das sichere Vorbereiten eines Updates mit simulierten GitHub-Antworten. Die Windows-Workflows kompilieren die native Tray-Anwendung und prüfen ihren Backend-Lebenszyklus. Ab 1.2.2 testen sie zusätzlich den echten offiziellen Node-Download, Prüfsummen, Installation und einen Tray-Start mit ausgeblendeten System-Node-Pfaden. Der Release-Workflow prüft außerdem Update und Rollback einschließlich Erhalt von `.data` und `runtime/`; erst danach veröffentlicht er das Paket.
