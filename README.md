# Card Master – Kartenspiele als Brettspiel

Card Master ist die Hülle für mehrere Kartenspiele mit Steinen statt Karten. Spielbar ist zuerst **1001 (Tausendundeins)**; Rommé, Skat und Bridge sind angekündigt („bald verfügbar“).

## 1001 – Tausendundeins

Das Kartenspiel Tausendundeins mit Steinen auf einem Raster: Jeder Stich wird sichtbar als Spur gelegt (wie Rommé-Reihen), mit Reizrunde, Hochzeiten und Wertung bis 1001 – gegen den Computer.

**Spielen:** https://saschahoffmannsh-gif.github.io/1001/

## Technik
- `blender/build_assets.py` – Blender 4.2: modelliert Brett (Mulden der Punkteleiste als echte Geometrie), Steine (abgerundet, gefast) und Stecker, rendert Vergleichsbilder und exportiert GLB.
- `tools/gen_textures.py` – Holzmaserung, Raster, Punkteleiste, Stein-Aufdrucke (Albedo/Normal/Rauheit).
- `src/game/rules.js` – Regeln (Mischen mit Krypto-Zufall, Geben 3-2-3, Reizrunde, Stich, Farbzwang, Hochzeiten, Wertung).
- `src/game/ai.js` – Computer-Gegner (nur eigenes Wissen; nach leerem Stock exakte Suche durch Mitzählen).
- `src/game/tracks.js` – Spuren auf dem Raster.
- `src/render/scene.js` – Three.js (ACES, weiche Schatten, Umgebungslicht).
- `supabase/` – Tabellen `tu_*` und Edge Function `tu` im gemeinsamen Projekt.

```
npm install
npm test          # Regel-Tests + Skript-Partie
npm run dev
./deploy.sh       # bauen; PUBLISH=1 ./deploy.sh veröffentlicht auf GitHub Pages
```

Assets neu erzeugen:
```
python3 tools/gen_textures.py && cp tex/tile_*.png public/assets/tex/
blender -b -P blender/build_assets.py -- --export
blender -b -P blender/build_assets.py -- --render --closeup --view Standard
```

## Spielerzahl und Regeln (ab Version 2)

- **2 Spieler** (du gegen 1 Computer): 24 Steine (9 bis Ass), je 8 Steine (3-2-3), Stock 8 zum Nachziehen.
- **3 Spieler** (du gegen 2 Computer): 32 Steine mit allen 7 und 8 (je 0 Augen, Rang unter der 9). Je 10 Steine (3-4-3), 2 Steine Talon. Der Reizgewinner nimmt den Talon auf und drückt 2 Steine verdeckt; ihre Augen zählen für ihn. 10 Stiche zu je 3 Steinen, Bedien-/Stich-/Trumpfpflicht ab dem ersten Stich.
- **4 Spieler** (du gegen 3 Computer): 32 Steine, je 8 (3-2-3), kein Stock, 8 Stiche zu je 4 Steinen.
- **Reizen**: reihum und nacheinander, Eröffnung 40, danach nur genau +10 oder passen. Passen alle, spielt die Vorhand 40. Vorhand wandert jede Runde einen Platz weiter.
- Computer sehen nur ihre eigene Hand, gespielte Steine, Meldungen und (als Reizgewinner) ihre eigenen gedrückten Steine.


## Card Master (Hülle, Profil, Rangliste)
- Startbildschirm: Logo, Spielername, Spielauswahl (1001 und Skat spielbar; Rommé/Bridge „bald verfügbar“), danach die Spielerzahl.
- Menüteile sind echte Cycles-Renderings mit Brett-Ahorn, Steinen und Licht der Szene: `blender/build_ui.py` (+ `ui_masks.py` für Gravuren, `ui_post.py` → WebP in `public/assets/ui/`). Tasten und Tafeln werden als 9-Slice (`border-image`) gedehnt.
  ```
  blender -b -P blender/build_ui.py -- --view Standard --sun 1.6 --area 160 --world 0.22 [--only game_] [--samples 64]
  ```
- Supabase: Migration `0003_tu_card_master` – Spalte `tu_matches.game` (Standard `1001`) und Tabelle `tu_game_stats` (Zähler je Profil und Spiel). Die Edge Function `tu` nimmt nur Ergebnisse für Spiele an, die in `supabase/functions/tu/ranking.js` als wertbar markiert sind (1001 und Skat).
- **Gesamtrangliste „Card Master“:** Summe der Siege über alle Spiele. Gleichstand: weniger Niederlagen, dann wer zuletzt gespielt hat, dann Name.
- **Rangliste je Spiel:** Siege; Gleichstand: beste Punktzahl, weniger Niederlagen, zuletzt gespielt.
- Testläufe (`?autostart`, `?autoplay`) speichern nichts.

## Skat (Internationale Skatordnung)
- 3 Spieler (2 Computer) oder 4 Spieler (3 Computer, der Geber setzt aus, das Geben wandert). Serie über **12 Spiele**, jedes Spiel frisch gemischt.
- Geben 3 – Skat – 4 – 3, Reizen Mittelhand → Vorhand, dann Hinterhand → Sieger (18, 20, 22, 23, 24, 27 …, „ja“/„weg“). Skat aufnehmen und 2 drücken oder Hand. Farbspiele, Grand, Null (23/35/46/59), Spitzen, Hand, Schneider, Schwarz, Ansagen, Ouvert, Überreizen, Kontra/Re. Passen alle: Ramsch (Vereinbarung, Jungfrau ×2, Durchmarsch +120).
- **Wertung:** Turnierpunkte nach ISkO-Liste. Gewonnen: +(Spielwert + 50). Verloren: −(2 × Spielwert + 50), jeder andere am Tisch +40 (zu dritt) bzw. +30 (zu viert). Kontra ×2, Re ×4 auf den Spielwert. Ramsch: Höchster verliert seine Augen (Jungfrau doppelt).
- **Rangliste:** gewonnenes Spiel = Sieg des Alleinspielers; verlorenes = Niederlage des Alleinspielers und Sieg jedes Gegenspielers; Aussetzender und Ramsch ohne Sieg/Niederlage. „Punkte“ = aufsummierte Turnierpunkte.
- Regeln und Wertung stehen nur einmal in `supabase/functions/tu/skat.js` – genutzt von Spiel, Tests und Edge Function. Der Server spielt jede eingereichte Serie mit diesem Modul nach (Blätter, Reizen, Drücken, Ansage, Kontra, jeder Stein) und rechnet die Punkte selbst nach.
- Computer: `src/game/skatai.js` – kennt nur das eigene Blatt, den Skat (falls aufgenommen), gespielte Steine und Ansagen.
- Migration `0004_tu_skat` erweitert die Wertebereiche der Endstände (Skat kann negativ sein).
- Tests: `npm test` (Bubenfolge, Trumpf, Null-Reihenfolge, Bedienen, Reizfolge, Spielwerte, Wertung inkl. verloren/Kontra, Ramsch, ganze Serie zu dritt/zu viert, Server-Prüfung).
- Vorschau-Läufe: `node tools/skatcheck.mjs <url> <prefix> 3|4`, `node tools/skatshots.mjs <url> <prefix> 3|4 [w h]`.

## Später (Backlog)
- Shop: Siege bringen Münzen, damit lassen sich besondere Decks (Stein-Designs) kaufen.
- Rommé, Bridge als eigene Spiele.
