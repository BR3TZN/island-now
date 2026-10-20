# Prüfung von Island Now 1.2.3

Stand: 21.10.2026. Laufzeit der automatisierten Prüfungen: Node.js 24 unter Linux.

**Ergebnis: 24 Tests bestanden, 0 fehlgeschlagen.**

Version 1.2.3 ersetzt den LINAMP-Look durch Winamp Classic. Die Gestaltung wird aus dem tatsächlichen Canvas-Zeichencode in 275 × 116 Pixeln und skaliert ausgegeben und visuell mit der Vorlage verglichen. Zusätzliche Zustände: lange Titel, Pause, ausgeblendete Zeit/Fortschrittsleiste, Cover-Akzentfarben und reduzierte Bewegung. Schrift und Ziffern benötigen keine installierten Systemschriften. Statische Routen und DOM-Verweise umfassen das neue Renderer-Modul.

Die Windows-Freigabe enthält weiterhin Kompilierung, offiziellen Node-Download, privaten Tray-Start sowie Update und Rollback mit Erhalt von `.data` und `runtime/`.

Geprüft mit simulierten Spotify-Antworten:

1. Vollständiger PKCE-Ablauf einschließlich Code-Verifier, SHA-256-Challenge, Browser-Bindung, einmaligem State und erneutem Laden der verschlüsselten Anmeldung.
2. Abweisung fremder Schreibanfragen und ungültiger Host-Header; keine Freigabe per CORS.
3. Nur lesende OBS-Ausgabe, keine Spotify-Zugangsdaten in JSON oder Widget-Link, gespeicherte Einstellungen und Erneuerung des Widget-Links.
4. Deduplizierte Token-Erneuerung bei parallelen Anfragen, Token-Rotation und Erhalt des bisherigen Refresh-Tokens, wenn Spotify keinen neuen liefert.
5. Einmalige Erneuerung nach HTTP 401 und Ende der Sitzung bei widerrufenem Refresh-Token.
6. Beachtung von HTTP 429 und `Retry-After` über mehrere Profile derselben Client-ID hinweg.
7. Transparente Ausgabe bei HTTP 204, Werbung und nicht unterstützten Wiedergabetypen; verständlicher Hinweis bei HTTP 403.
8. Trennen einer Verbindung während einer laufenden Erneuerung: verspätete Antworten dürfen die Anmeldung nicht wiederherstellen.
9. Podcast-Metadaten und Abweisung unzulässiger Cover- und Spotify-URLs.
10. Einblendung bei Songwechsel, Ausblenden bei Pause, Fortsetzen, manuelle Einblendung, veraltete Daten und fortlaufende Zeitberechnung.
11. Erreichbarkeit aller statischen Dateien und Abgleich der Bedienelemente mit den JavaScript-Verweisen. Kein dynamisches Einfügen von Titelinformationen als HTML.

Zusätzlich bestanden: JavaScript-Syntaxprüfung, Syntaxprüfung des Bash-Starts und tatsächlicher Start als eigenständiger Node-Prozess mit frischem Datenordner und geändertem Port.

12. Speicherung aller sechs Designs, automatischer Cover-Farben und gültiger Animationseinstellungen, inklusive Wiederherstellung und Eingabegrenzen.
13. Ermittlung einer dominanten Cover-Farbe, Kontrastanpassung und Fallback.
14. Gleichursprüngliche Auslieferung des aktuellen Covers ohne freie Proxy-URLs, gemeinsame Zwischenspeicherung und ungültige alte Links.
15. Abweisung unzulässiger Bildadressen, ungeeigneter MIME-Typen und übergroßer Bildantworten.
16. Gezieltes Beenden des Tray-Backends per Shutdown-Befehl und beim Schließen der Starter-Verbindung.

17. Versionsvergleich ohne Downgrades, Vorabversionen oder ungültige Angaben.
18. ZIP-Paketprüfung mit Dateimanifest und Versionsabgleich.
19. Schutz vor Pfadtraversierung, privaten Datenpfaden, Gerätenamen, Dateinamenskollisionen und beschädigten Archiven.
20. Vorbereitung eines Updates, ohne laufende Programmdateien oder private Daten zu verändern.
21. Abbruch bei falscher Download-Prüfsumme.
22. Abweisung fremder Download-Adressen, Entwürfe und fehlender Prüfsummen.
23. Verständlicher Zustand bei fehlendem Release bzw. ungeeignetem Startmodus.
24. Schutz der Update-Endpunkte durch Origin- und CSRF-Prüfung.

## Grenzen der Prüfung

Keine echte Spotify-Client-ID und keine persönliche Kontofreigabe lagen in der Testumgebung vor. Die Spotify-Anbindung wurde mit simulierten Antworten geprüft. Die konkrete OBS-Darstellung und das Node-Fortschrittsfenster wurden nicht visuell auf einem Windows-Desktop geprüft. Die visuelle Prüfung des Skins verwendet dessen tatsächlichen Canvas-Renderer außerhalb von OBS. ARM64-Auswahl und Download-Hashes sind hinterlegt; ein tatsächlicher Lauf auf ARM64-Hardware ist nicht Bestandteil des x64-Windows-Workflows.

Bereits für 1.2.1 bestanden die GitHub-Prüfungen für Windows-Kompilierung, Tray-Start, Update und Rollback. Der Nutzer hat das tatsächliche Update auf seinem PC bestätigt. Die Speicherung der sechs Designs ist automatisiert geprüft. Die genannten Windows-Prüfungen sind Freigabebedingungen des Release-Workflows.
