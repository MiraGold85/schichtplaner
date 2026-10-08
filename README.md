# Schichtplaner

Handy-Web-App zum Planen von Arbeitszeiten für mehrere Arbeitgeber.

- Arbeitgeber mit eigener Farbe und optionalem Stundenlohn
- Feste Wochenzeiten (z. B. Mo + Mi 8–13 Uhr), die jede Woche automatisch im Kalender stehen – einzelne Tage lassen sich herausnehmen oder ändern
- Einzeltermine mit Notiz (z. B. Kundin, Adresse) und Schnellwahl der zuletzt genutzten Uhrzeiten
- Monatskalender mit farbigen Markierungen
- Stunden- und Verdienstübersicht pro Monat
- Private Termine (z. B. Zahnarzt), die nicht als Arbeitszeit zählen
- Termine auf andere Tage kopieren (z. B. „jede Woche, 3 Wochen lang“)
- Minijob-Grenze mit Fortschrittsbalken (Grenze in der App änderbar)
- Stundenkonto pro Arbeitgeber: Soll pro Woche oder Monat, Startdatum, Anfangsstand, Plus-/Minusstunden
- Urlaub und Krankheit mit Stunden-Gutschrift (auch über mehrere Tage)
- Gesetzliche Feiertage aller Bundesländer – feste Wochenzeiten an Feiertagen werden gutgeschrieben
- Eintragen in Google Kalender (einzeln oder als Serie) und Export als Kalenderdatei (.ics) mit Erinnerung
- Datensicherung als Datei und Wiederherstellung

Alle Daten bleiben auf dem Gerät (Browser-Speicher). Es gibt kein Konto und keinen Server.

## Auf dem Handy installieren (Android)

1. Die App-Adresse (GitHub Pages) in **Chrome** öffnen.
2. Menü **⋮** → **App installieren** (oder „Zum Startbildschirm hinzufügen“).
3. Danach startet die App über ihr Symbol im Vollbild und funktioniert auch offline.

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt:

- `index.html` – Aufbau der Seite
- `style.css` – Gestaltung (hell/dunkel)
- `app.js` – Logik und Datenspeicherung (`localStorage`)
- `sw.js` – Offline-Cache (bei Änderungen die `CACHE`-Version erhöhen)
- `manifest.webmanifest`, `icons/` – Installation als App

Lokal testen: `python3 -m http.server` im Projektordner, dann `http://localhost:8000` öffnen.
