# Prüfung von Island Now 1.2.2

Stand: 20.10.2026. Laufzeit der automatisierten Prüfungen: Node.js 24 unter Linux.

**Ergebnis: 24 Tests bestanden, 0 fehlgeschlagen.**

Version 1.2.2 ergänzt die automatische lokale Node-Einrichtung unter Windows. Die Windows-Workflows prüfen alte und fehlende Systemversionen, Wiederverwendung der privaten Laufzeit, Abbruch vor dem Download sowie beschädigte ZIP- und EXE-Dateien. Zusätzlich laden sie die echte offizielle Laufzeit herunter und starten den Tray bei ausgeblendeten System-Node-Pfaden. Eine Veröffentlichung erfolgt erst nach erfolgreichem Windows-Lauf einschließlich Update und Rollback mit Erhalt von `.data` und `runtime/`.

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

Keine echte Spotify-Client-ID und keine persönliche Kontofreigabe lagen in der Testumgebung vor. Die Spotify-Anbindung wurde mit simulierten Antworten geprüft. Die konkrete OBS-Darstellung und das neue Fortschrittsfenster wurden nicht visuell auf einem Windows-Desktop geprüft. ARM64-Auswahl und Download-Hashes sind hinterlegt; ein tatsächlicher Lauf auf ARM64-Hardware ist nicht Bestandteil des x64-Windows-Workflows.

Bereits für 1.2.1 bestanden die GitHub-Prüfungen für Windows-Kompilierung, Tray-Start, Update und Rollback. Der Nutzer hat das tatsächliche Update auf seinem PC bestätigt. Die Speicherung des neuen LINAMP-Looks ist automatisiert geprüft; eine visuelle Browserprüfung der neuen Gestaltung steht noch aus. Die oben beschriebenen neuen Node-Prüfungen sind zusätzliche Freigabebedingungen für das Release 1.2.2.
