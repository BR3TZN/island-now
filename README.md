# Island Now

Lokales Spotify-Widget für OBS. Anmeldung im Browser mit OAuth 2.0 und PKCE, automatische Token-Erneuerung, Albumcover, Titel, Interpret, Fortschritt und transparente Browserquelle. Keine Abhängigkeit von Songify oder Textdateien. Unter Windows läuft Island Now im eigenen Fenster mit Tray-Symbol und integrierten GitHub-Updates. Die Anwendung zeigt Metadaten an und gibt keinen Ton aus.

## In fünf Schritten starten

1. ZIP **vollständig entpacken**, zum Beispiel nach `E:\STREAM\Bot\Island-Now`. Keine Dateien der früheren Songify-Lösung übernehmen.
2. Unter Windows wird eine vorhandene Node.js-Version ab 22 automatisch erkannt. Fehlt eine passende Version, richtet der Start sie selbst ein; dafür ist einmalig Internet erforderlich. Auf Mac/Linux [Node.js](https://nodejs.org/en/download) ab Version 22 installieren. Keine npm-Installation und keine zusätzlichen Pakete erforderlich.
3. **Island-Now.exe** aus dem Windows-Release doppelklicken. Bei einem Quellpaket zuerst **START-WINDOWS.cmd** ausführen; es lädt das WebView2 SDK von Microsoft und erstellt die App mit dem Windows-.NET-Compiler. Die App öffnet ihr eigenes Fenster und erscheint rechts unten im Infobereich. Über das Tray-Menü ist die Oberfläche auch im Browser unter **http://127.0.0.1:17653** erreichbar. Für weitere Starts direkt die erzeugte EXE verwenden.
4. Unter **Verbindungen** die Spotify-App wie unten beschrieben konfigurieren, die **Client-ID** eintragen und auf **Mit Spotify verbinden** klicken. Die Anmeldung erfolgt auf der Spotify-Seite.
5. Einen Titel in Spotify abspielen. Unter **Widget → In OBS verwenden** auf **URL kopieren** drücken, in OBS eine **Browserquelle** hinzufügen und die URL einfügen. **Breite 800, Höhe 400**. „Lokale Datei“ bleibt aus. Ein bestehendes benutzerdefiniertes CSS, das einen Hintergrund setzt, entfernen; die Quelle ist bereits transparent.

## Windows-Tray und Aktualisierung

Ab Version 1.2.2 prüft der Windows-Start zuerst die Laufzeit. Ohne passende Systeminstallation lädt ein kleines Fortschrittsfenster die offizielle Node.js-LTS-Version für x64 oder ARM64 von `nodejs.org`. ZIP und EXE werden mit fest hinterlegten SHA-256-Werten geprüft. Nur `node.exe` und die Lizenz werden unter `runtime/` im entpackten Island-Now-Ordner abgelegt. Es sind keine Administratorrechte nötig; Windows-PATH wird nicht verändert. Der Ordner muss beschreibbar sein. Nach der einmaligen Einrichtung startet die App wie gewohnt im Tray. Bei Abbruch oder Downloadfehler einfach erneut starten; eine vorhandene Laufzeit wird erst nach erfolgreicher Prüfung ersetzt.

Im Windows-Release liegen `Island-Now.exe` und die benötigten WebView2-Bibliotheken bei. Beim Start öffnet sich ein eigenes Fenster. **Minimieren** blendet es in den Infobereich aus. **X** beendet die Anwendung samt Widget und Song Requests. Unter **Einstellungen → Windows-Fenster → Beim Klick auf „X“** kannst du stattdessen **Im Infobereich weiterlaufen** wählen. Ein Doppelklick auf das Tray-Symbol oder ein erneuter Start holt das Fenster an seine bisherige Position und Größe zurück. Ist der frühere Bildschirm nicht verfügbar, erscheint es auf einem angeschlossenen Bildschirm. **Beenden** im Tray-Menü beendet die Anwendung immer.

Das Fenster verwendet die [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/), die zu Windows 11 gehört. Falls sie fehlt, bietet das Fenster einen Download-Link und den Start im Browser an. **Im Browser öffnen** im Tray-Menü bleibt verfügbar. Spotify und Twitch werden weiterhin im Standardbrowser autorisiert.

Für den manuellen Umstieg von Version 1.0 oder 1.1: die bisherige Instanz beenden. Neue Dateien in denselben Ordner entpacken bzw. kopieren und ersetzen. **Den bestehenden `.data`-Ordner behalten.** Darin liegen deine Anmeldung, Profile, Einstellungen und OBS-Links. Anschließend `START-WINDOWS.cmd` starten und das Fenster neu öffnen. In OBS einmalig die Browserquellen-Höhe auf **400 px** setzen. Eine selbst erzeugte `Island-Now.exe` aus der alten Quellversion muss durch die neue Release-EXE ersetzt oder vor dem erneuten Quellpaket-Start entfernt werden.

Das Protokoll liegt unter `.data/tray.log`. Die Konsolenvariante `START-KONSOLE.cmd` bleibt zur Diagnose verfügbar und benötigt Node im Windows-PATH. Der Mac-/Linux-Start verwendet weiterhin ein Terminal. Die private Windows-Laufzeit in `runtime/` bleibt bei App-Updates erhalten und gehört nicht ins weitergegebene ZIP.

## Integrierte Updates ab Version 1.2

Unter **Einstellungen → Updates** prüft die Oberfläche auf Wunsch beim Öffnen das neueste stabile Release im konfigurierten GitHub-Projekt `BR3TZN/island-now`. Nach einer Bestätigung werden das Paket und seine Prüfsummen geprüft. Unter Windows startet die Anwendung nach einem Update im Tray neu. Per Doppelklick auf das Tray-Symbol öffnest du das Fenster wieder. Anmeldung und Einstellungen bleiben in `.data`. OBS lädt das Widget nach einem Versionswechsel neu. Während des Neustarts kann es kurz ausgeblendet sein.

Der GitHub-Release-Workflow und ein Windows-Publizierungsskript sind vorbereitet. Erst nach der Veröffentlichung ist das Projekt online erreichbar. Die vorherige Entwicklungs-ZIP 1.1 benötigt einmalig ein manuelles Update auf 1.2. [Veröffentlichung und spätere Releases](docs/RELEASES.md).

## Spotify-App einrichten

Das [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) öffnen und eine vorhandene eigene App verwenden oder eine neue erstellen. Ein möglicher App-Name ist „Island Now“. Als Website kann die eigene Website dienen, zum Beispiel `https://www.danielkroiss.com`, oder die lokale Adresse, sofern das Dashboard sie akzeptiert. Bei der API-Auswahl **Web API** wählen.

Unter Settings diese Redirect-URI hinzufügen und speichern:

```text
http://127.0.0.1:17653/auth/callback
```

Die URI muss exakt passen: `127.0.0.1`, HTTP, Port 17653, `/auth/callback` und kein zusätzlicher Slash. `localhost` ist für Spotify-Redirects nicht zulässig. Die Oberfläche zeigt immer die zur laufenden Anwendung passende URI und hat einen Kopierknopf.

Die **Client-ID** aus dem Dashboard eintragen. Sie hat 32 Hex-Zeichen. **Client-Secret und Spotify-Passwort werden hier nicht benötigt.** Anschließend die Anmeldung im selben Browser abschließen. Erlaubt wird ausschließlich das Lesen des aktuell abgespielten Inhalts (`user-read-currently-playing`).

## Anzeige

- **Island, Studio, Compact, Cyberpunk, Forza, Winamp Classic und WoW-Questlog:** sieben über die Oberfläche auswählbare Layouts. Cyberpunk verwendet kantige HUD-Flächen mit Gelb, Cyan und Magenta. Forza basiert auf deinem früheren `forza.css`: Cover oben, graue Textbalken, gelber Titel und weißer Interpret. Die empfohlene OBS-Höhe von 400 px verhindert Abschneiden des vertikalen Forza-Layouts.
- **WoW-Questlog:** Pergament, dunkler Bronzerahmen, rotes Questzeichen und ein gerahmtes Albumcover. Der Songfortschritt erscheint als EP-Leiste. Mit Cover-Akzent übernehmen Leiste und Coverrahmen die Albumfarbe; der Text bleibt auf hellem Pergament.
- **Winamp Classic:** ersetzt den LINAMP-Look durch das klassische Player-Fenster im Seitenverhältnis 275 × 116. Pixel-Schrift, Segment-Uhr, goldene Titelzeilen und silberne Tasten orientieren sich an der Vorlage. Der Player zeigt Titel, Interpret und Zeit ohne Albumcover; Cover-Farben und Übergänge bleiben verfügbar. Pegelbalken und Tasten sind dekorativ. Nicht verfügbare Audioangaben bleiben „--“. Vorhandene LINAMP-Einstellungen und OBS-Links bleiben gültig.

  ![Winamp Classic](docs/winamp-classic.svg)
- **Bei Songwechsel:** bei neuem Titel, beim Start der Browserquelle und beim Fortsetzen nach einer Pause für die gewählte Dauer eingeblendet; Standard 15 Sekunden.
- **Dauerhaft:** solange Wiedergabedaten vorliegen. „Bei Pause ausblenden“ lässt sich separat schalten.
- **Akzentfarbe, Breite, Cover, Fortschritt und Zeit:** direkt einstellbar. Einstellungen werden automatisch gespeichert und von OBS übernommen.
- **Demo / Live:** Demo funktioniert ohne Spotify. Die Gestaltungsvorschau bleibt sichtbar. „Einblendung testen“ demonstriert die gewählte Anzeigedauer; bei Live wird auch das echte OBS-Widget erneut eingeblendet.
- **Akzentfarbe aus Cover:** einschaltbare lokale Farbauswertung des aktuellen Covers. Der Akzent übernimmt den Farbton des Albums mit mehr Sättigung. Bei Island, Studio und Compact passt sich auch die Tönung der Karte an. Dunkle Farben werden für die Lesbarkeit aufgehellt. Ohne auswertbares Cover gilt die manuelle Farbe als Fallback. Das Cover selbst bleibt unverändert. Die Funktion arbeitet auch bei ausgeblendeter Cover-Anzeige.
- **Bewegung des gesamten Widgets:** Dropdown mit Fade, von links/rechts/oben/unten, sanfter Skalierung oder direktem Ein-/Ausblenden.
- **Titel- und Coverwechsel:** eigenes Dropdown für Überblenden, seitliches Überblenden oder direktes Umschalten. Die Übergangsdauer ist zwischen 0,15 und 1,5 Sekunden einstellbar; Standard 0,65 Sekunden. Albumcover werden vor dem Wechsel geladen und mit zwei Ebenen überblendet. Schnelle Titelwechsel verwerfen überholte Übergänge.
- **Client-ID:** standardmäßig als Passwortfeld verdeckt, auch während der Eingabe. „Anzeigen“ blendet sie gezielt ein. Nach 15 Sekunden, beim Verlassen der Verbindungsansicht, bei Fensterwechsel, verstecktem Browser-Tab oder Profilwechsel wird sie automatisch wieder verborgen.
- **Lange Titel:** automatische Laufschrift, die durch die regelmäßigen Spotify-Abfragen nicht neu gestartet wird. Podcasts zeigen Episodentitel und Podcastname.
- **Kein aktiver Titel / Werbung / Fehler:** das OBS-Widget bleibt transparent. Fehlermeldungen erscheinen ausschließlich in der Bedienoberfläche.

Spotify kann auf deinem Gaming-PC, Handy oder einem anderen Gerät laufen. Das Widget fragt den aktuellen Titel des angemeldeten **Kontos** ab. Island Now muss auf dem **OBS-PC** laufen, damit die lokale Browserquelle erreichbar ist. Minimiere das Windows-Fenster, damit die Anwendung im Tray weiterläuft.

## Song Requests über Twitch

Der Bereich **Song Requests** ist pro Spotify-Profil standardmäßig ausgeschaltet. Der Schalter und der Status bleiben in allen Tabs sichtbar. Unter **Einrichtung** verbindest du die Konten und legst den Reward fest. **Chat** enthält die Vorlage und ihre Vorschau, **Verlauf** die letzten Songwünsche. Bei ausgeschalteter Funktion bleibt der Twitch-Reward unverändert und kann weiter über Streamer.bot verarbeitet werden. Denselben Reward nur in einer Anwendung als Trigger aktivieren.

1. In der [Twitch Developer Console](https://dev.twitch.tv/console/apps) eine Anwendung vom Typ **Public** erstellen. Falls eine Redirect-URL erforderlich ist, `http://localhost:17653` eintragen; die Anmeldung selbst verwendet einen Gerätecode. Die Twitch-Client-ID in Island Now eintragen und den Code mit dem Kanal bestätigen, dessen Rewards verwendet werden sollen. Kanalpunkte müssen für den Kanal verfügbar sein. Ein Client-Secret wird nicht benötigt.
2. **Warteschlange freigeben** und die zusätzliche Spotify-Berechtigung bestätigen. Spotify Premium ist für das Einreihen erforderlich. Auf dem verbundenen Spotify-Konto die Wiedergabe auf dem gewünschten Gerät starten.
3. Einen aktiven **Channel Reward** mit erforderlicher Texteingabe auswählen oder unter **Neuen Channel Reward erstellen** Name und Kosten festlegen. Anschließend **Song Requests annehmen** einschalten.

Zuschauer geben beim Einlösen einen Suchtext wie `Avicii Levels` oder `Levels Avicii` ein. Auch `Songtitel - Interpret` und direkte Spotify-Track-Links (`https://open.spotify.com/track/…`, auch `spotify:track:…`) funktionieren. Die Suche bevorzugt einen exakten Titel und Interpreten. Die Wiedergabe läuft weiter; der Wunsch wird in Spotifys Warteschlange eingereiht.

Unter **Chat** lässt sich die Bestätigung unabhängig vom Reward speichern. Sie wird erst nach erfolgreichem Einreihen vom verbundenen Twitch-Konto gesendet. Der Text unterstützt `{titel}`, `{interpret}` und `{user}`. In einem aktiven Twitch Shared Chat erscheint die Nachricht auch in den verbundenen Chats.

Nur bei Rewards, die die verbundene Twitch-App verwalten darf, kann Island Now Einlösungen automatisch bestätigen und bei eindeutiger Ablehnung Punkte zurückgeben. Bei anderen Rewards wird der Einlösungsstatus nicht verändert. Wenn Spotify das Einreihen nicht bestätigt, zeigt der lokale Verlauf **Bitte prüfen**; Island Now reiht die Einlösung nicht automatisch erneut ein. Während Island Now beendet oder von Twitch getrennt ist, werden keine Einlösungen nachträglich eingereiht.

## Andere Personen und mehrere Konten

Jede Person kann dieses saubere ZIP auf ihrem eigenen PC starten, ihre eigene Client-ID eintragen und sich im Browser mit ihrem eigenen Spotify-Konto anmelden. Die Anwendung ist dafür vorbereitet; es muss kein Code geändert werden.

Alternativ kannst du deine Spotify-App für wenige freigeschaltete Konten verwenden: zusätzliche Spotify-Nutzer vor der Anmeldung unter **User Management / Users and Access** der App hinzufügen. In Island Now erzeugt das **+** neben dem Profilnamen weitere lokale Profile. Jedes Profil hat eigene Tokens, Einstellungen und eine eigene OBS-URL.

**Spotify-Vorgaben, Stand 16.10.2026:** Neue Development-Mode-Apps erlauben bis zu **fünf autorisierte Nutzer**. Der **App-Inhaber benötigt Premium**. Bestehende Kontingente können Bestandsschutz haben. Eine unbegrenzt nutzbare zentrale Anmeldung mit einer einzigen App erfordert eine entsprechende Freigabe von Spotify. Dieses ZIP umgeht diese Beschränkungen nicht.

Die vorliegende Version läuft lokal. Sie ist kein zentral gehosteter Mehrnutzer-Dienst und benötigt keine Portfreigabe. Die Browser-Anmeldung und getrennten Profile sind vollständig implementiert.

## Anmeldung und Daten

Zugangstokens werden rechtzeitig automatisch erneuert. Widerrufene oder abgelaufene Refresh-Tokens erfordern eine erneute Browser-Anmeldung. Spotify nennt für Dashboard-Apps derzeit eine Refresh-Token-Laufzeit von sechs Monaten; Erneuern des Zugangstokens verlängert diese nicht.

Anmeldedaten und Einstellungen liegen verschlüsselt im Ordner `.data`. Der Schlüssel liegt daneben; das schützt vor versehentlichem Klartext-Weitergeben, nicht vor Zugriff durch ein kompromittiertes Windows-Konto. **Den persönlichen `.data`-Ordner nicht mit anderen teilen.** Zum Weitergeben das ursprüngliche ZIP verwenden. Das Verzeichnis muss beschreibbar bleiben. Ein Backup oder Umzug muss den kompletten `.data`-Ordner samt Schlüssel umfassen.

„Verbindung trennen“ entfernt die lokalen Spotify-Tokens. Zum Widerrufen der Freigabe zusätzlich die App unter [Spotify Apps](https://www.spotify.com/account/apps/) entfernen. „Overlay-Link erneuern“ macht den bisherigen lokalen Widget-Link ungültig.

## Fehlerbehebung

| Problem | Ursache / Lösung |
| --- | --- |
| `INVALID_CLIENT` oder Redirect-Fehler | Client-ID und Redirect-URI exakt prüfen, im Dashboard speichern und Anmeldung neu starten. Kein `localhost`. |
| Login erfolgreich, trotzdem kein Titel / 403 | Zusätzlichen Nutzer in der App freischalten. Premium und App-Status des App-Inhabers prüfen. Richtigen Spotify-Account verwenden. |
| Overlay erscheint nur kurz | Standard ist „Bei Songwechsel“, 15 Sekunden. Für dauerhafte Anzeige „Dauerhaft“ wählen. |
| OBS bleibt transparent | Erst in der Oberfläche „Live“ prüfen. Spotify abspielen, Profil und URL prüfen, Tray-Symbol prüfen. Bei Pause und gestoppter Musik kann Transparenz beabsichtigt sein. |
| Cover fehlt bei lokalen Dateien | Spotify liefert für lokale Dateien nicht immer Cover und vollständige Metadaten. Ein Ersatzsymbol erscheint. |
| Oberfläche nach Neustart meldet Sitzung abgelaufen | Browserseite neu laden. Die Spotify-Anmeldung selbst bleibt gespeichert. |
| Port 17653 belegt | Bereits laufende Instanz unter der lokalen URL öffnen oder die andere Anwendung schließen. Nicht mehrfach starten. |
| Nach Standby kein aktueller Titel | Automatische Wiederverbindung abwarten; bei widerrufener Freigabe erneut verbinden. Nach Wiederaufnahme der Wiedergabe ggf. ein paar Sekunden auf Spotify warten. |
| Spotify begrenzt Anfragen / 429 | Die Anwendung respektiert `Retry-After` automatisch. Keine Refresh-Schleife starten. |
| Browser statt Oberfläche zeigt Quelltext / leere Seite | Über `START-WINDOWS.cmd` bzw. `Island-Now.exe` starten und die HTTP-Adresse öffnen, nicht `index.html` direkt. |
| Tray-Symbol nicht sofort sichtbar | Im Windows-Infobereich den Pfeil für ausgeblendete Symbole öffnen. Von dort lässt sich das Symbol dauerhaft in die sichtbare Leiste ziehen. |
| Tray-Erstellung schlägt fehl | ZIP vollständig in einen beschreibbaren Ordner entpacken. Windows 11 enthält .NET Framework 4.8.1. Der Start sucht den vorhandenen `csc.exe` im Framework-Ordner. Falls er auf dem PC fehlt, zeigt der Start eine Fehlermeldung; `START-KONSOLE.cmd` dient zur Diagnose. |

## Technischer Aufbau

Node.js ab 22, ausschließlich Node-Standardbibliothek, kein Build und keine npm-Abhängigkeiten. Server standardmäßig nur auf `127.0.0.1`. OAuth mit SHA-256-PKCE, einmaligem State, Browser-Bindung und zehn Minuten gültigem Anmeldeversuch. Keine Tokens im OBS-Link oder Browser-Storage. Gemeinsamer Abfrage-Cache, deduplizierte Token-Erneuerung, begrenzte Wiederholungen, Spotify-429-Backoff, Behandlung von 204/401/403 und verschlüsselte, atomare Speicherung. Cover und Metadaten werden aus Spotify übernommen und zu Spotify verlinkt.

```text
server.mjs         Lokaler HTTP-Server und OAuth-Callback
lib/               Spotify-Anbindung, Datenmodell und verschlüsselte Speicherung
public/            Bedienoberfläche und transparentes OBS-Widget
test/              Automatisierte Prüfungen mit simulierten Spotify- und Twitch-Antworten
windows/           Windows-Fenster, Tray-Anwendung, Node-Start und Update-Installer
```

Start im Terminal: `node server.mjs --open`. Tests: `npm test` oder `node --test`. Ein anderer Port kann über `ISLAND_PORT` gesetzt werden; dann die neue Redirect-URI im Dashboard registrieren und die neue URL in OBS verwenden. `ISLAND_DATA_DIR` erlaubt einen anderen lokalen Datenordner.

Die Windows-App verwendet Windows Forms, .NET Framework und WebView2. `scripts/build-windows.ps1` lädt das WebView2 SDK mit Prüfsummenprüfung und baut die EXE. Die GitHub-Prüfungen starten die Anwendung, testen das Fenster und prüfen den Start mit privater Node-Laufzeit.

Die automatisierten Tests simulieren Spotify und Twitch. Eine echte Anmeldung kann erst nach Eintragen gültiger Client-IDs und persönlicher Freigabe der Konten geprüft werden.

## Offizielle Quellen

- [Spotify: Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify: Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
- [Spotify: Quota modes und Nutzerfreigaben](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify: Änderungen im Development Mode 2026](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify: Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)
- [Spotify: Currently playing](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
- [Spotify: Add Item to Playback Queue](https://developer.spotify.com/documentation/web-api/reference/add-to-queue)
- [Twitch: Device Code Grant Flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow)
- [Twitch: EventSub über WebSocket](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [Twitch: Get Custom Reward](https://dev.twitch.tv/docs/api/reference/#get-custom-reward)
- [Twitch: Send Chat Message](https://dev.twitch.tv/docs/api/reference/#send-chat-message)
- [Spotify: Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
- [Spotify: Design & Branding](https://developer.spotify.com/documentation/design)
- [Microsoft: .NET Framework unter Windows](https://learn.microsoft.com/de-de/dotnet/framework/install/on-windows-and-server)
- [Microsoft: WebView2 Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Microsoft: NotifyIcon](https://learn.microsoft.com/de-de/dotnet/api/system.windows.forms.notifyicon)
- [Microsoft: C#-Compileroptionen](https://learn.microsoft.com/dotnet/csharp/language-reference/compiler-options/)

Unabhängiges Projekt; keine offizielle Spotify-Anwendung. Keine Audiowiedergabe oder Übertragung von Musik enthalten.

## Farben der Bedienoberfläche

Unter **Einstellungen → Oberfläche** zwischen **Neutral dunkel** und **Cover-Farben** wählen. Cover-Farben folgen dem aktuellen Titel des aktiven Spotify-Profils und wechseln weich. Ohne Cover bleibt die Oberfläche neutral. Vor der Anmeldung lässt sich der Effekt anhand des Demo-Covers ansehen. Die Auswahl wird im Fenster bzw. Browser gespeichert und ist unabhängig von der Akzentfarbe des OBS-Widgets.
