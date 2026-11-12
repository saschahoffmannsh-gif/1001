# 1001 – Tausendundeins als Brettspiel

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
