# Markt & Fest Radar Berlin-Brandenburg

Mobile Karten-App für Floh-/Trödelmärkte, Ernte-/Hoffeste, Stadt-/Dorffeste, Handwerksmärkte, Weihnachtsmärkte und weitere Feste in Berlin und Brandenburg.

## Daten
Die Cloudflare Pages Function `/functions/api/events.js` lädt offizielle Open-Data-Datensätze des Landes Berlin und führt sie zusammen:
- Berliner und Brandenburger Wochen- und Trödelmärkte
- Berliner und Brandenburger Straßen- und Volksfeste
- Berliner und Brandenburger Weihnachtsmärkte

Lizenz der Datensätze: Creative Commons Attribution (CC BY). In der App ist die Quelle ausgewiesen.

## Persönliche Bewertungen
`Besucht`, `Favorit`, Bewertung 1–10, Notiz und `Nicht nochmal empfehlen` werden lokal im Browser (`localStorage`) gespeichert. Der Schlüssel basiert auf Veranstaltung/Ort statt auf dem einzelnen Datum, damit eine schlechte Bewertung auch bei einem späteren Termin desselben Markts/Fests wieder erkannt wird.

## Cloudflare Pages
Ohne Build-Schritt deployen. Root-Verzeichnis ist dieses Projektverzeichnis. Die Pages Functions werden automatisch aus `functions/` erkannt.

## Aktualisierung
Die externen Veranstaltungsdaten werden serverseitig für **24 Stunden** gecacht. Dadurch werden die Quellen höchstens einmal pro Tag neu abgerufen.

## Zusätzliche redaktionelle Quelle
Hinweise aus dem **Havelblick (SPD Oberhavel)** können als zusätzliche Quelle gekennzeichnet werden. Offizielle Open-Data-Termine bleiben davon getrennt; längere Artikeltexte werden nicht übernommen.
