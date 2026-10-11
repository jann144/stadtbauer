# Stadtbauer

Eigener 3D-Städtebauer im Stil von Cities: Skylines 2 für Browser und iPad (Safari, Touch). Der Nutzer spricht Deutsch und will das Spiel frei anpassen können.

## Befehle

Node.js liegt unter `C:\Program Files\nodejs`. Fehlt es im PATH einer Shell: `export PATH="/c/Program Files/nodejs:$PATH"`.

- `npm run dev` startet den Entwicklungsserver (Port 5173)
- `npm test` führt die Vitest-Tests aus
- `npm run typecheck` prüft die Typen
- `npm run build` baut nach `dist/` (inklusive Service Worker)
- `node scripts/make-icons.mjs` erzeugt die App-Symbole neu

## Regeln

- Oberfläche, Kommentare und Testnamen auf Deutsch, Bezeichner im Code auf Englisch.
- `src/sim/` ist reine Simulation: kein Three.js, kein DOM, fester Takt, Zustand als einfache Daten. Jede Regel dort bekommt einen Test.
- Werkzeuge in `src/input/` kennen nur Bodenpunkte; die Darstellung ihres Zustands macht `main.ts`.
- Was der Spieler tut, läuft über `src/sim/actions.ts` (dort gelten Geld, Freischaltungen und die erneute Prüfung, ob der Platz noch frei ist); Werkzeuge greifen nie direkt ins Straßennetz. Zwischen Planen und Bestätigen läuft das Spiel weiter, ein gespeicherter Plan kann also veraltet sein. Geld bewegt sich nur über `earn`/`spend` in `src/sim/economy/budget.ts`.
- Alles, was der Nutzer anpassen könnte (Zahlen, Typen, Regeln), gehört kommentiert nach `src/config/`.
- Bedienung immer für Maus und Touch: Maus baut sofort, Touch erst nach Bestätigung. Schaltflächen mindestens 44 px.
- Viele gleiche Objekte (Bäume, Gebäude, Fahrzeuge) als `InstancedMesh`, damit es auf dem iPad flüssig bleibt.
- Bodenkoordinaten sind `{x, z}` in Metern, y ist die Höhe. Eine Zonenzelle misst 8 m.

## Stand

Der Gesamtplan mit acht Meilensteinen liegt in `~/.claude/plans/lass-uns-das-spiel-keen-flask.md`.

- Fertig und getestet: alle acht Meilensteine (0 bis 7), von der Einrichtung bis Speichern und Feinschliff.
- Die Veröffentlichung auf GitHub Pages ist vorbereitet (`.github/workflows/deploy.yml`, Service Worker, Symbole), aber noch nicht erfolgt: Es fehlen GitHub-Konto und Repository des Nutzers, und es gibt noch keinen Commit (Git kennt noch keinen Namen und keine E-Mail-Adresse). Im Repository muss unter Settings > Pages als Quelle „GitHub Actions“ gewählt werden. Vor dem ersten Push in ein öffentliches Repository noch einmal nachfragen.
- Vereinfachungen in Meilenstein 5: Abwasser gehört zu Wasser; statt Bodenwert gibt es nur die Zufriedenheit je Gebäude.
- Verkehr (Meilenstein 6): Die Belastung der Straßen wird je Simulationsschritt aus einer gewürfelten Fahrt gemessen (`countTrip`), unabhängig von den sichtbaren Autos; diese sind nur Anschauung. Keine Ampeln, kein Spurwechsel: an Kreuzungen fährt immer ein Auto. Bei jeder Änderung am Straßennetz enden alle sichtbaren Fahrten (`resetTraffic`), die Messwerte bleiben über `age` erhalten.
- Spielstand (Meilenstein 7): `src/save/save.ts` wandelt die Welt in reine Daten und zurück (ohne DOM, getestet), `src/save/storage.ts` legt sie im `localStorage` ab und gibt sie als Datei heraus. Gespeichert wird alle `SAVE.intervalSeconds` Sekunden und wenn die Seite in den Hintergrund geht. Neue Stadt und Laden aus einer Datei schreiben den Speicher und laden die Seite neu; die Welt wird nie im laufenden Spiel ausgetauscht.
  - Kommt ein Feld in `World` dazu, muss es in `toSave` und `fromSave`; der Test „läuft nach dem Laden genau so weiter“ deckt Vergessenes auf. Ändert sich die Bedeutung alter Felder, `SAVE_VERSION` erhöhen.
  - Nicht gespeichert und beim Laden neu aufgebaut: das Zellraster (`layoutCells`, Zonen über ihre Punkte, Belegung über `occupy`), die Autos und alle Zwischenspeicher.
- Sandbox (`world.sandbox`): „unendlich Geld“ macht `earn`/`spend` wirkungslos (der Kontostand steht), „alles freischalten“ wirkt nur auf die `is…Unlocked`-Funktionen. Was die Einwohner erwarten, hängt an `isServiceReached`, also weiter an den Meilensteinen.
- Straßen werden je Kachel von 250 m zu einem Mesh zusammengefasst (`src/render/roads.ts`); beim Bauen entsteht nur die betroffene Kachel neu.
- Bekannte Lücken: Nicht bezahlter Unterhalt (`MonthReport.unpaid`) hat keine Folgen für die Dienste. Die Balance über ein langes Spiel ist nicht durchgespielt. Auf einem echten iPad ist das Spiel noch nie gelaufen, nur in der Tablet-Ansicht des Browsers.

Im Entwicklungsmodus gibt es in der Browser-Konsole `game` (Welt, Kamera, Werkzeuge); `game.step(n)` rechnet n Simulationsschritte sofort, `game.save()` speichert sofort.
