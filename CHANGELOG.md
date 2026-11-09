# Änderungen

## 1.4.1

- Beim Öffnen aus dem Tray erscheint das Windows-Fenster wieder an seiner vorherigen Position und in seiner bisherigen Größe. Ein maximiertes Fenster bleibt maximiert. Falls der ursprüngliche Bildschirm nicht mehr verfügbar ist, erscheint das Fenster auf einem angeschlossenen Bildschirm.
- Neuer Widget-Stil **WoW-Questlog**: Pergament, Bronzerahmen, rotes Questzeichen und der Songfortschritt als EP-Leiste. Unter **Widget → Dein Look** auswählbar.

## 1.4.0

- Eigene Ansichten für Widget, Song Requests, Verbindungen und Einstellungen. Song Requests hat Tabs für Einrichtung, Chat und Verlauf, mit sichtbarem Annahmestatus, Chatvorschau und getrenntem Speichern von Reward und Nachricht.
- Island Now öffnet unter Windows ein eigenes Fenster. Minimieren blendet es ins Tray aus. „X“ beendet die App standardmäßig; unter Einstellungen → Windows-Fenster lässt sich dafür auch der Tray wählen. Spotify-Anmeldungen öffnen weiter den Standardbrowser.
- Cover-Akzente leuchten kräftiger. Aktive Tabs, Hauptaktionen, Schalter und Statusanzeigen sind deutlicher erkennbar.

## 1.3.0

- Optionale Twitch Song Requests pro Spotify-Profil. Der Schalter ist nach dem Update aus. Bestehende Rewards können weiterhin von Streamer.bot verarbeitet werden.
- Aktiven Channel Reward mit Texteingabe auswählen oder direkt mit Name und Punktekosten erstellen. Twitch-Anmeldung per Gerätecode ohne Client-Secret.
- Suchtexte wie `Avicii Levels` und `Levels Avicii`, `Songtitel - Interpret` sowie direkte Spotify-Track-Links werden in die Warteschlange des aktiven Spotify-Geräts eingereiht. Die Wiedergabefreigabe wird separat erteilt.
- Die Chatbestätigung lässt sich mit `{titel}`, `{interpret}` und `{user}` anpassen. Der lokale Verlauf zeigt Ergebnis und Fehler jeder verarbeiteten Einlösung.
- Bei von der verbundenen Twitch-App verwalteten Rewards werden erfolgreiche Einlösungen bestätigt und eindeutig fehlgeschlagene Einlösungen erstattet. Doppelt zugestellte Ereignisse werden übersprungen.

## 1.2.3

- Der bisherige LINAMP-Look heißt jetzt „Winamp Classic“ und übernimmt die festen Proportionen des klassischen Players: 275 × 116 Pixel, dunkler Rahmen, goldene Titelzeilen, silberne Tasten und grünes Display.
- Echte Pixel-Schrift und Segment-Ziffern statt moderner Systemschriften. Titel, Interpret, Laufzeit und Fortschrittsregler zeigen die aktuellen Spotify-Daten; lange Titel laufen durch das Display.
- Kein Albumcover im klassischen Player-Fenster. Die vorhandene Cover-Farboption sowie Ein-/Ausblendungen und Titelübergänge bleiben nutzbar.
- Pegelbalken und Bedientasten bleiben dekorativ. Nicht verfügbare Audio-Bitrate und Abtastrate werden als „--“ dargestellt.
- Bestehende LINAMP-Profile und OBS-Links verwenden den neuen Look automatisch.

## 1.2.2

- Neuer LINAMP-Look nach der Retro-Player-Vorlage: blaues Gehäuse, silberne Leisten, grünes Display, laufende Zeit und dekorative Pegelbalken. Direkt neben den bisherigen Designs auswählbar, mit Cover-Farben und den vorhandenen weichen Übergängen.
- Windows prüft beim Start auf eine vorhandene, kompatible Node.js-Version ab 22.
- Fehlt Node oder ist es zu alt, wird die offizielle Node.js-LTS-Laufzeit automatisch im Island-Now-Ordner eingerichtet: ohne Administratorrechte und ohne Änderung der Windows-PATH-Einstellung.
- Ein kleines Fenster zeigt den Download-Fortschritt und erlaubt den Abbruch. SHA-256-Prüfsummen sichern ZIP und EXE vor der Verwendung ab.
- Die private Laufzeit wird bei weiteren Starts wiederverwendet und bleibt bei App-Updates erhalten. Spotify-Anmeldung, Einstellungen und OBS-Links bleiben bestehen.

## 1.2.1

- Neutrale dunkle Bedienoberfläche als Standard statt durchgehendem Grünstich.
- Auswahl „Oberfläche → Cover-Farben“: Akzente und dezente Flächentönung folgen dem Albumcover des aktiven Spotify-Profils.
- Weicher Farbwechsel, neutraler Fallback ohne Cover und lokal gespeicherte Auswahl unabhängig von den Widget-Farben.

## 1.2.0

- Neue GitHub-Update-Oberfläche mit Versionsprüfung, Release-Informationen und bestätigter Installation unter Windows.
- ZIP-Prüfsumme, Dateimanifest, Schutz vor unsicheren Dateipfaden und Sicherung der ersetzten Programmdateien.
- Neustart über die Tray-Anwendung; bestehende Anmeldung, Profile und OBS-Links bleiben im Datenordner.
- Automatische Windows-Pakete einschließlich fertiger Tray-EXE und SHA-256-Datei über GitHub Actions.
- Quellcode enthält keine persönlichen Spotify-Zugangsdaten.

## 1.1.0

- Fünf Designs: Island, Studio, Compact, Cyberpunk und Forza.
- Akzentfarben aus Albumcovern, maskierte Client-ID und konfigurierbare Animationen.
- Windows-Tray mit Menü und lokalem Start.
