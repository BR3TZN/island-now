# Änderungen

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
