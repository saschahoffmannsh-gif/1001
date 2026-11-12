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
