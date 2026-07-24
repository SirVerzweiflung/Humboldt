#!/usr/bin/env node
/**
 * tools/geo/build.mjs
 *
 * Turns Natural Earth shapefiles into per-preset, content-hashed TopoJSON layers.
 *
 *   node tools/geo/build.mjs                 # build everything in presets.json
 *   node tools/geo/build.mjs austria europe  # build only these presets
 *   node tools/geo/build.mjs --clean         # wipe public/geo first
 *
 * Input : tools/geo/sources/ne_<detail>_<layer>/*.shp  (unzipped Natural Earth downloads)
 * Output: public/geo/<preset>/<layer>.<detail>.<hash>.topo.json
 *         public/geo/manifest.json
 *
 * The output is COMMITTED to the repo. This script never runs at request time.
 */

import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mapshaper from 'mapshaper';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(HERE, 'sources');
const TMP_DIR = path.join(HERE, '.tmp');
const OUT_DIR = path.resolve(HERE, '../../public/geo');

/** Soft budget, per preset, for the sum of all its gzipped layers. */
const GZIP_BUDGET_BYTES = 300 * 1024;

/* ------------------------------------------------------------------ *
 * Layer catalogue
 * ------------------------------------------------------------------ *
 * `src` is the Natural Earth basename with {d} standing in for the scale.
 * `type` drives whether -clean is worth running.
 * `filter` is a mapshaper JS expression, evaluated per feature. It is written
 *   defensively (`typeof x === 'undefined' || ...`) so a missing field is never
 *   a hard error — Natural Earth's attribute names drift between scales.
 * `toLines` converts polygons to their boundary lines.
 * `focusOnly` restricts the layer to the preset's focus country.
 */
const LAYERS = {
  land: {
    src: 'ne_{d}_land',
    type: 'polygon',
  },
  coastline: {
    src: 'ne_{d}_coastline',
    type: 'line',
  },
  admin0_borders: {
    // Line layer: every shared border appears EXACTLY ONCE. This is the whole
    // reason we do not stroke ne_*_admin_0_countries — that would draw Austria's
    // border once for Austria and once for Germany.
    src: 'ne_{d}_admin_0_boundary_lines_land',
    type: 'line',
  },
  admin1_borders: {
    // Bundesländer / départements / US states. 50m and 10m only.
    src: 'ne_{d}_admin_1_states_provinces_lines',
    type: 'line',
  },
  rivers: {
    src: 'ne_{d}_rivers_lake_centerlines',
    type: 'line',
    filter: 'typeof scalerank === "undefined" || scalerank <= {riverRank}',
  },
  lakes: {
    src: 'ne_{d}_lakes',
    type: 'polygon',
    filter: 'typeof scalerank === "undefined" || scalerank <= {lakeRank}',
  },
  focus: {
    // The outline of one country, as lines. Used to tint the "current" country
    // differently. NOTE: these lines are coincident with admin0_borders, so
    // render focus ON TOP with the same or greater width — never underneath at a
    // thinner width, or you get a two-tone fringe.
    src: 'ne_{d}_admin_0_countries',
    type: 'polygon',
    toLines: true,
    focusOnly: true,
  },
  focus_fill: {
    // Same country as a filled polygon (no stroke). Useful for a subtle wash.
    src: 'ne_{d}_admin_0_countries',
    type: 'polygon',
    focusOnly: true,
  },
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

/** Find the .shp inside tools/geo/source, tolerating a wrapping folder. */
async function findShapefile(basename) {
  const candidates = [
    path.join(SRC_DIR, `${basename}.shp`),
    path.join(SRC_DIR, basename, `${basename}.shp`),
  ];
  for (const c of candidates) if (existsSync(c)) return c;

  // Last resort: recursive scan, one level deep.
  let entries = [];
  try {
    entries = await readdir(SRC_DIR, { withFileTypes: true });
  } catch {
    throw new Error(`Source directory not found: ${SRC_DIR}`);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(SRC_DIR, e.name, `${basename}.shp`);
    if (existsSync(sub)) return sub;
  }
  return null;
}

/** True if the bbox covers essentially the whole globe (clipping would be a no-op
 *  and risks antimeridian artefacts). */
const isGlobal = (b) => b[0] <= -179.9 && b[2] >= 179.9;

function bboxOfGeoJSON(gj) {
  let w = 180, s = 90, e = -180, n = -90;
  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const f of gj.features ?? []) if (f.geometry) visit(f.geometry.coordinates);
  return [w, s, e, n];
}

/** Count geometries in a TopoJSON so we can skip empty layers. */
function topoFeatureCount(topo) {
  let n = 0;
  for (const key of Object.keys(topo.objects ?? {})) {
    const o = topo.objects[key];
    if (o.type === 'GeometryCollection') n += (o.geometries ?? []).length;
    else n += 1;
  }
  return n;
}

const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

const gzipLen = (buf) =>
  gzipSync(buf, { level: zlibConstants.Z_BEST_COMPRESSION }).length;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/* ------------------------------------------------------------------ *
 * Core: build one layer of one preset
 * ------------------------------------------------------------------ */

async function buildLayer(presetName, preset, layerKey, bbox) {
  const def = LAYERS[layerKey];
  if (!def) throw new Error(`Unknown layer "${layerKey}" in preset "${presetName}"`);

  const detail = preset.detail;
  const basename = def.src.replace('{d}', detail);
  const shp = await findShapefile(basename);

  if (!shp) {
    console.warn(`  ! SKIP ${layerKey}: ${basename}.shp not found in source/`);
    return null;
  }

  const tmpOut = path.join(TMP_DIR, `${presetName}.${layerKey}.json`);
  const cmd = [`-i ${q(shp)} encoding=utf8`];

  // 1. Restrict to the focus country, if this layer is a focus layer.
  if (def.focusOnly) {
    if (!preset.focus) {
      throw new Error(`Preset "${presetName}" uses layer "${layerKey}" but has no "focus" block`);
    }
    const { field, value } = preset.focus;
    cmd.push(`-filter '${field} === ${JSON.stringify(value)}'`);
  }

  // 2. Attribute filter (river/lake scalerank).
  if (def.filter) {
    const expr = def.filter
      .replace('{riverRank}', String(preset.riverRank ?? 12))
      .replace('{lakeRank}', String(preset.lakeRank ?? 12));
    cmd.push(`-filter '${expr}'`);
  }

  // 3. Drop every attribute. The renderer needs geometry only, and names are
  //    literally the answer to the quiz question.
  cmd.push('-filter-fields');

  // 4. Clip to the preset bbox before simplifying — less work, smaller output.
  if (!isGlobal(bbox)) {
    cmd.push(`-clip bbox=${bbox.join(',')}`);
  }

  // 5. Simplify. keep-shapes stops aggressive settings from deleting small
  //    islands and lakes outright.
  cmd.push(`-simplify ${preset.simplify} visvalingam keep-shapes`);

  // 6. Polygons only: repair self-intersections introduced by simplification.
  if (def.type === 'polygon') cmd.push('-clean allow-overlaps');

  // 7. Optionally convert polygons to boundary lines.
  if (def.toLines) cmd.push('-lines');

  cmd.push(
    `-o format=topojson precision=${preset.precision ?? 0.001} ${q(tmpOut)}`
  );

  await mapshaper.runCommands(cmd.join(' '));

  const raw = await readFile(tmpOut);
  const topo = JSON.parse(raw.toString());

  if (topoFeatureCount(topo) === 0) {
    console.warn(`  ! SKIP ${layerKey}: empty after clip/filter (nothing in this bbox)`);
    return null;
  }

  // Re-serialise compactly and content-hash.
  const body = Buffer.from(JSON.stringify(topo));
  const h = hash8(body);
  const filename = `${layerKey}.${detail}.${h}.topo.json`;
  const outPath = path.join(OUT_DIR, presetName, filename);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, body);

  const gz = gzipLen(body);
  console.log(
    `  ok ${layerKey.padEnd(16)} ${kb(body.length).padStart(10)} raw  ${kb(gz).padStart(10)} gzip`
  );

  return {
    layer: layerKey,
    url: `/geo/${presetName}/${filename}`,
    bytes: body.length,
    gzipBytes: gz,
  };
}

/* ------------------------------------------------------------------ *
 * Core: resolve a preset's bbox
 * ------------------------------------------------------------------ */

async function resolveBbox(presetName, preset) {
  if (preset.bbox) return preset.bbox;
  if (!preset.bboxFrom) {
    throw new Error(`Preset "${presetName}" has neither bbox nor bboxFrom`);
  }

  const { field, value, padDeg = 0.5 } = preset.bboxFrom;
  const basename = `ne_${preset.detail}_admin_0_countries`;
  const shp = await findShapefile(basename);
  if (!shp) throw new Error(`bboxFrom needs ${basename}.shp, which is missing`);

  const tmp = path.join(TMP_DIR, `${presetName}.bbox.json`);
  // NOTE: do NOT -filter-fields here. Dropping every attribute makes mapshaper
  // emit a GeometryCollection (no `features` key) instead of a FeatureCollection,
  // which would make the `gj.features` read below fail even on a valid match. We
  // only need the geometry for the bbox and throw the tmp file away regardless.
  await mapshaper.runCommands(
    `-i ${q(shp)} encoding=utf8 -filter '${field} === ${JSON.stringify(value)}' ` +
      `-o format=geojson ${q(tmp)}`
  );

  const gj = JSON.parse((await readFile(tmp)).toString());
  if (!gj.features?.length) {
    throw new Error(
      `No feature with ${field} = "${value}" in ${basename}. ` +
        `Natural Earth uses NAME / ADMIN / SOVEREIGNT — check the .dbf.`
    );
  }

  const [w, s, e, n] = bboxOfGeoJSON(gj);
  const bbox = [
    +(w - padDeg).toFixed(4),
    +(s - padDeg).toFixed(4),
    +(e + padDeg).toFixed(4),
    +(n + padDeg).toFixed(4),
  ];
  console.log(`  bbox derived from ${field}="${value}": [${bbox.join(', ')}]`);
  return bbox;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const args = process.argv.slice(2);
  const doClean = args.includes('--clean');
  const only = args.filter((a) => !a.startsWith('--'));

  const presets = JSON.parse(
    (await readFile(path.join(HERE, 'presets.json'))).toString()
  );
  delete presets.$comment;

  if (doClean && existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true });
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const names = only.length ? only : Object.keys(presets);
  const manifest = { generatedAt: new Date().toISOString(), presets: {} };

  for (const name of names) {
    const preset = presets[name];
    if (!preset) throw new Error(`No such preset: ${name}`);

    console.log(`\n${name}  (${preset.detail}, simplify ${preset.simplify})`);
    const bbox = await resolveBbox(name, preset);

    const layers = {};
    let totalGz = 0;

    for (const layerKey of preset.layers) {
      const res = await buildLayer(name, preset, layerKey, bbox);
      if (!res) continue;
      layers[layerKey] = { url: res.url, bytes: res.bytes, gzipBytes: res.gzipBytes };
      totalGz += res.gzipBytes;
    }

    manifest.presets[name] = { detail: preset.detail, bbox, layers };

    const verdict = totalGz > GZIP_BUDGET_BYTES ? 'OVER BUDGET' : 'ok';
    console.log(`  total ${kb(totalGz)} gzip  — ${verdict}`);
    if (totalGz > GZIP_BUDGET_BYTES) {
      console.warn(
        `  ! Simplify harder, drop riverRank/lakeRank, or tighten the bbox for "${name}".`
      );
    }
  }

  // Merge with any presets built in a previous run so partial builds don't
  // destroy the manifest.
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (existsSync(manifestPath) && only.length) {
    const prev = JSON.parse((await readFile(manifestPath)).toString());
    manifest.presets = { ...prev.presets, ...manifest.presets };
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  await rm(TMP_DIR, { recursive: true, force: true });
  console.log(`\nWrote ${manifestPath}`);
}

main().catch((err) => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
