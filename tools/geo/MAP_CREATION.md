# tools/geo — map asset pipeline

Turns Natural Earth shapefiles into the TopoJSON layers served from `public/geo/`.
Runs **offline, by hand, occasionally**. The output is committed. Nothing here
executes at request time.

---

## 1. Install

```bash
pnpm add -D mapshaper -w
```

Node 18+. No other dependency.

---

## 2. Download these files

From <https://www.naturalearthdata.com/downloads/> — public domain, no attribution
required (we credit it anyway). Unzip each one into `tools/geo/sources/`. A wrapping
folder per download is fine; the script looks one level deep.

> Quick unzip of everything you dropped in as `.zip`:
> ```bash
> cd tools/geo/sources
> for z in *.zip; do unzip -o -q "$z" -d "${z%.zip}"; done
> ```

### 1:110m — for the `world` preset

| File | Section |
|---|---|
| `ne_110m_land.zip` | Physical |
| `ne_110m_coastline.zip` | Physical |
| `ne_110m_rivers_lake_centerlines.zip` | Physical |
| `ne_110m_lakes.zip` | Physical |
| `ne_110m_admin_0_countries.zip` | Cultural |
| `ne_110m_admin_0_boundary_lines_land.zip` | Cultural |

### 1:50m — for the `europe` preset

| File | Section |
|---|---|
| `ne_50m_land.zip` | Physical |
| `ne_50m_coastline.zip` | Physical |
| `ne_50m_rivers_lake_centerlines.zip` | Physical |
| `ne_50m_lakes.zip` | Physical |
| `ne_50m_admin_0_countries.zip` | Cultural |
| `ne_50m_admin_0_boundary_lines_land.zip` | Cultural |

### 1:10m — for the `austria` preset

| File | Section |
|---|---|
| `ne_10m_rivers_lake_centerlines.zip` | Physical |
| `ne_10m_lakes.zip` | Physical |
| `ne_10m_admin_0_countries.zip` | Cultural |
| `ne_10m_admin_0_boundary_lines_land.zip` | Cultural |

Optional 10m extras, if Austria looks too sparse or too bare:

| File | Adds |
|---|---|
| `ne_10m_rivers_europe.zip` | Europe-only supplementary rivers, much denser |
| `ne_10m_lakes_europe.zip` | Europe-only supplementary lakes |
| `ne_10m_admin_1_states_provinces_lines.zip` | Bundesland borders (`admin1_borders` layer) |

No coastline or land layer for Austria — it is landlocked, so both would be
empty or useless inside the bbox. The script warns and skips empty layers rather
than emitting a file full of nothing.

Each download contains `.shp .shx .dbf .prj .cpg`. Keep all five together —
mapshaper reads the `.shp` and picks up its siblings automatically. Natural
Earth's `.prj` is already WGS84 / EPSG:4326, so there is **no reprojection step**
anywhere in this pipeline.

`tools/geo/sources/` (and `tools/geo/.tmp/`) are already gitignored. Only the
built output in `public/geo/` is committed.

---

## 3. Build

```bash
node tools/geo/build.mjs                 # everything
node tools/geo/build.mjs austria         # one preset (manifest is merged, not replaced)
node tools/geo/build.mjs --clean         # wipe public/geo first
```

Output:

```
public/geo/
├── manifest.json
├── world/    land.110m.a1b2c3d4.topo.json, coastline.110m.….topo.json, …
├── europe/   …
└── austria/  …
```

`manifest.json` is the only thing the app reads by name. Everything else is
content-hashed, so `Cache-Control: public, max-age=31536000, immutable` is safe
and no cache purge is ever needed.

---

## 4. Adding a preset later

Add a block to `presets.json`, download the matching scale's shapefiles, re-run.
For a country preset, use `bboxFrom` and the script derives the bbox from the
country polygon itself — no coordinates to look up by hand:

```json
"switzerland": {
  "detail": "10m",
  "bboxFrom": { "field": "NAME", "value": "Switzerland", "padDeg": 0.5 },
  "focus":    { "field": "NAME", "value": "Switzerland" },
  "simplify": "25%", "precision": 0.0005,
  "riverRank": 8, "lakeRank": 8,
  "layers": ["admin0_borders", "focus", "rivers", "lakes"]
}
```

If the country is not found, check the `.dbf` — Natural Earth carries `NAME`,
`ADMIN` and `SOVEREIGNT`, and they disagree for dependencies and disputed areas.

---

## 5. Things that will bite you

**Double borders.** Never put a MapLibre `line` layer on a polygon source.
`ne_*_admin_0_countries` draws Austria's northern border twice — once as
Austria's ring, once as Germany's. That is why `admin0_borders` uses
`ne_*_admin_0_boundary_lines_land`, a genuine line layer where every shared
border exists exactly once. Use polygon sources for `fill` only.

**The `focus` layer overlaps `admin0_borders`.** Austria's outline is present in
both. They are coincident, so it looks fine — but render `focus` *above*
`admin0_borders` at equal or greater width. Underneath, or thinner, and you get a
two-tone fringe.

**`keep-shapes` is not optional.** Without it, `-simplify 25%` deletes small
islands and lakes entirely rather than coarsening them.

**Coastline and land can disagree.** They are separate Natural Earth files
simplified independently, so at aggressive settings the stroke may not sit exactly
on the fill edge. If that shows, drop the `coastline` layer and derive it from
land instead — add a `-lines` variant of `land` to the catalogue.

**Budget.** The script prints gzipped totals per preset and warns above 300 KB.
That ceiling is per *round* on a phone, from `CLAUDE.md` §6.3. `austria` at 10m
with `riverRank: 8` is the one likely to breach it — lower the rank first, then
`simplify`.

---

## 6. Licence

Natural Earth is public domain. Credit it in the app footer as a courtesy:
*Map data: Natural Earth (naturalearthdata.com), public domain.*