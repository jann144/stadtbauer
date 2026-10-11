import { ROAD_TYPES } from '../../config/roads';
import { WORLD } from '../../config/settings';
import { ZONE_DEPTH, type ZoneId } from '../../config/zones';
import type { Vec2 } from '../../util/vec2';
import {
  bezierPoint,
  bezierTangent,
  curvatureAt,
  nearBounds,
  paramAt,
  pointAt,
  project,
  tangentAt,
  type Polyline,
} from '../roads/geometry';
import { directionFrom, nodeOf, segmentOf, shapeOf, type RoadNetwork, type RoadSegment } from '../roads/graph';

const CELL = WORLD.cellSize;
/** Kantenlänge der Fächer, in denen Zellen bzw. Straßen zum schnellen Auffinden abgelegt sind. */
const CELL_BUCKET = CELL * 2;
const ROAD_BUCKET = 64;
/** Zwei Zellen verschiedener Streifen dürfen sich höchstens so nahe kommen (Anteil der Zellgröße). */
const MIN_GAP = 0.9;
/**
 * An der Innenseite einer Kurve rücken die Zellen nach hinten zusammen. Die Spalten stehen dort so weit
 * auseinander, dass die ersten beiden Reihen noch diesen Anteil der Zellgröße Abstand haben.
 */
const INNER_FIT = 0.95;

/** Ein Stück bebaubares Land (8 × 8 m) neben einer Straße. */
export interface ZoneCell {
  x: number;
  z: number;
  /** Ausrichtung als Winkel; von der Straße weg zeigt (-sin, cos) dieses Winkels. */
  angle: number;
  /** Segment und Straßenseite, an der die Zelle hängt. */
  segment: number;
  side: 1 | -1;
  /** Position im Streifen: Spalte entlang der Straße, Reihe von der Straße weg. */
  column: number;
  row: number;
  zone: ZoneId | null;
  /** Id des Gebäudes, das die Zelle belegt. */
  building: number | null;
}

export interface ZoneGrid {
  /** Alle Zellen; die Reihen einer Spalte stehen hintereinander, beginnend mit Reihe 0. */
  cells: ZoneCell[];
  /** Erhöht sich bei jeder Änderung; daran erkennt die Darstellung, dass sie neu zeichnen muss. */
  version: number;
  buckets: Map<number, ZoneCell[]>;
  /** Je Streifen (Segment und Seite) die Spalten mit ihren Reihen. */
  strips: Map<number, ZoneCell[][]>;
}

/** Eine Straße als Hindernis: Zellmitten müssen `reach` Meter Abstand von ihrer Mittellinie halten. */
interface Obstacle {
  line: Polyline;
  reach: number;
}

export function createGrid(): ZoneGrid {
  return { cells: [], version: 0, buckets: new Map(), strips: new Map() };
}

function bucketKey(bx: number, bz: number): number {
  return (bx + 4096) * 8192 + (bz + 4096);
}

function stripKey(segment: number, side: number): number {
  return segment * 2 + (side === 1 ? 1 : 0);
}

function insert(grid: ZoneGrid, cell: ZoneCell): void {
  grid.cells.push(cell);
  const key = stripKey(cell.segment, cell.side);
  let strip = grid.strips.get(key);
  if (!strip) grid.strips.set(key, (strip = []));
  (strip[cell.column] ??= [])[cell.row] = cell;

  const bucket = bucketKey(Math.floor(cell.x / CELL_BUCKET), Math.floor(cell.z / CELL_BUCKET));
  const list = grid.buckets.get(bucket);
  if (list) list.push(cell);
  else grid.buckets.set(bucket, [cell]);
}

/** Zelle an einer bestimmten Stelle eines Streifens, falls es sie gibt. */
export function cellAt(
  grid: ZoneGrid,
  segment: number,
  side: number,
  column: number,
  row: number,
): ZoneCell | undefined {
  return grid.strips.get(stripKey(segment, side))?.[column]?.[row];
}

/** Alle Zellen, deren Mitte höchstens `radius` Meter vom Punkt entfernt liegt. */
export function cellsNear(grid: ZoneGrid, p: Vec2, radius: number): ZoneCell[] {
  const found: ZoneCell[] = [];
  const x0 = Math.floor((p.x - radius) / CELL_BUCKET);
  const x1 = Math.floor((p.x + radius) / CELL_BUCKET);
  const z0 = Math.floor((p.z - radius) / CELL_BUCKET);
  const z1 = Math.floor((p.z + radius) / CELL_BUCKET);
  for (let bx = x0; bx <= x1; bx++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (const cell of grid.buckets.get(bucketKey(bx, bz)) ?? []) {
        if (Math.hypot(cell.x - p.x, cell.z - p.z) <= radius) found.push(cell);
      }
    }
  }
  return found;
}

/**
 * Raster, das nur aus einzelnen Punkten mit Zone besteht; dient als Quelle für `carryZones`,
 * etwa beim Laden eines Spielstands.
 */
export function gridOfZones(points: readonly { x: number; z: number; zone: ZoneId }[]): ZoneGrid {
  const grid = createGrid();
  points.forEach((point, index) => {
    insert(grid, { x: point.x, z: point.z, angle: 0, segment: -1, side: 1, column: index, row: 0, zone: point.zone, building: null });
  });
  return grid;
}

/**
 * Überträgt die Zonen eines früheren Rasters auf ein neues: jede Zelle übernimmt die Zone der nächstgelegenen
 * alten Zelle im Umkreis `radius`, auch wenn diese keine Zone hat. So wachsen Zonen nicht von selbst.
 */
export function carryZones(grid: ZoneGrid, old: ZoneGrid, radius: number): void {
  for (const cell of grid.cells) {
    let nearest = Infinity;
    for (const before of cellsNear(old, cell, radius)) {
      const gap = Math.hypot(before.x - cell.x, before.z - cell.z);
      if (gap < nearest) {
        nearest = gap;
        cell.zone = before.zone;
      }
    }
  }
}

/** Legt die Zellen entlang aller Straßen neu an. Wo sich Zellen überlappen würden, gewinnt die ältere Straße. */
export function layoutCells(net: RoadNetwork): ZoneGrid {
  const grid = createGrid();
  const roads = indexRoads(net);
  const oldestFirst = [...net.segments.values()].sort((a, b) => a.age - b.age || a.id - b.id);
  for (const segment of oldestFirst) {
    addStrip(net, roads, grid, segment, 1);
    addStrip(net, roads, grid, segment, -1);
  }
  return grid;
}

/** Sortiert die Straßen in grobe Fächer, damit je Zelle nur die Straßen in der Nähe geprüft werden. */
function indexRoads(net: RoadNetwork): Map<number, Obstacle[]> {
  const index = new Map<number, Obstacle[]>();
  for (const segment of net.segments.values()) {
    const line = shapeOf(net, segment);
    const reach = ROAD_TYPES[segment.type].width / 2 + CELL / 2 - 0.5;
    const obstacle = { line, reach };
    const x1 = Math.floor((line.maxX + reach) / ROAD_BUCKET);
    const z1 = Math.floor((line.maxZ + reach) / ROAD_BUCKET);
    for (let bx = Math.floor((line.minX - reach) / ROAD_BUCKET); bx <= x1; bx++) {
      for (let bz = Math.floor((line.minZ - reach) / ROAD_BUCKET); bz <= z1; bz++) {
        const key = bucketKey(bx, bz);
        const list = index.get(key);
        if (list) list.push(obstacle);
        else index.set(key, [obstacle]);
      }
    }
  }
  return index;
}

function addStrip(
  net: RoadNetwork,
  roads: Map<number, Obstacle[]>,
  grid: ZoneGrid,
  segment: RoadSegment,
  side: 1 | -1,
): void {
  const line = shapeOf(net, segment);
  const half = ROAD_TYPES[segment.type].width / 2;
  const a = nodeOf(net, segment.from);
  const b = nodeOf(net, segment.to);
  const start = junctionGap(net, segment, segment.from, tangentAt(line, 0), side);
  const end = line.length - junctionGap(net, segment, segment.to, tangentAt(line, line.length), side);

  // Erst die Spalten abstecken: gerade Straßen alle 8 m, an der Innenseite von Kurven weiter auseinander.
  const columns: { index: number; at: number; step: number; bend: number }[] = [];
  let cursor = start;
  let index = 0;
  while (cursor + CELL <= end + 1e-6) {
    // Stärkste Krümmung zu dieser Seite hin im Bereich der Spalte (die Krümmung ändert sich entlang der Kurve).
    let bend = 0;
    if (segment.control) {
      bend = -Infinity;
      for (const ahead of [0, CELL, CELL * 2]) {
        bend = Math.max(bend, curvatureAt(a, segment.control, b, paramAt(line, cursor + ahead)) * side);
      }
    }
    // Anteil des Spaltenabstands, der in der zweiten Reihe noch übrig ist (innen < 1, außen > 1).
    const fit = 1 - bend * (half + CELL * 1.5);
    if (fit < 0.25) {
      // Kurve zu eng: hier hat innen keine Zelle Platz. Die übersprungene Nummer trennt die Nachbarspalten.
      cursor += CELL;
      index++;
      continue;
    }
    const step = CELL * Math.max(1, INNER_FIT / fit);
    if (cursor + step > end + 1e-6) break;
    columns.push({ index: index++, at: cursor + step / 2, step, bend });
    cursor += step;
  }
  // Den Rest der Länge gleichmäßig auf beide Enden verteilen.
  const shift = (end - cursor) / 2;

  for (const column of columns) {
    // Auf Kurven die genaue Richtung nehmen; die abgetastete Linie knickt an ihren Stützpunkten.
    const param = paramAt(line, column.at + shift);
    const p = segment.control ? bezierPoint(a, segment.control, b, param) : pointAt(line, column.at + shift);
    const t = segment.control
      ? bezierTangent(a, segment.control, b, param)
      : tangentAt(line, column.at + shift);
    const angle = Math.atan2(t.z * side, t.x * side);
    for (let row = 0; row < ZONE_DEPTH; row++) {
      const reach = half + CELL / 2 + row * CELL;
      // Weiter hinten rücken die Zellen innen zu dicht zusammen; dort endet die Spalte.
      if (row >= 2 && column.step * (1 - column.bend * reach) < CELL * MIN_GAP) break;
      const x = p.x - t.z * side * reach;
      const z = p.z + t.x * side * reach;
      // Hinter einer blockierten Zelle gibt es keinen Zugang zur Straße mehr.
      if (!isFree(roads, grid, x, z, segment.id, side)) break;
      insert(grid, {
        x,
        z,
        angle,
        segment: segment.id,
        side,
        column: column.index,
        row,
        zone: null,
        building: null,
      });
    }
  }
}

/**
 * Wo am Knoten eine andere Straße zu dieser Seite hin abgeht, beginnen die Zellen erst hinter ihr,
 * damit sie bündig an der Ecke liegen. `forward` ist die Fahrtrichtung des Segments am Knoten.
 */
function junctionGap(net: RoadNetwork, segment: RoadSegment, nodeId: number, forward: Vec2, side: 1 | -1): number {
  let gap = 0;
  for (const id of nodeOf(net, nodeId).segments) {
    if (id === segment.id) continue;
    const other = segmentOf(net, id);
    const away = directionFrom(net, other, nodeId);
    const towardSide = (-forward.z * away.x + forward.x * away.z) * side;
    if (towardSide > 0.2) gap = Math.max(gap, ROAD_TYPES[other.type].width / 2);
  }
  return gap;
}

function isFree(
  roads: Map<number, Obstacle[]>,
  grid: ZoneGrid,
  x: number,
  z: number,
  segment: number,
  side: number,
): boolean {
  const limit = WORLD.size / 2 - CELL / 2;
  if (Math.abs(x) > limit || Math.abs(z) > limit) return false;

  const p = { x, z };
  for (const road of roads.get(bucketKey(Math.floor(x / ROAD_BUCKET), Math.floor(z / ROAD_BUCKET))) ?? []) {
    if (nearBounds(road.line, p, road.reach) && project(road.line, p).offset < road.reach) return false;
  }

  // Zellen des eigenen Streifens halten ihren Abstand schon über die Spaltenweite; hier zählen nur fremde.
  const radius = CELL * MIN_GAP;
  const x0 = Math.floor((x - radius) / CELL_BUCKET);
  const x1 = Math.floor((x + radius) / CELL_BUCKET);
  const z0 = Math.floor((z - radius) / CELL_BUCKET);
  const z1 = Math.floor((z + radius) / CELL_BUCKET);
  for (let bx = x0; bx <= x1; bx++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (const cell of grid.buckets.get(bucketKey(bx, bz)) ?? []) {
        if (cell.segment === segment && cell.side === side) continue;
        if (Math.hypot(cell.x - x, cell.z - z) < radius) return false;
      }
    }
  }
  return true;
}
