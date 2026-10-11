import { ROAD_TYPES } from '../config/roads';
import type { ServiceId } from '../config/services';
import { WORLD } from '../config/settings';
import type { ZoneId } from '../config/zones';
import type { Vec2 } from '../util/vec2';
import { nearBounds, project } from './roads/geometry';
import { shapeOf, type RoadNetwork } from './roads/graph';

const CELL = WORLD.cellSize;
/** So weit darf eine Grundstücksecke in den Gehweg ragen; nötig an der Innenseite von Kurven. */
const LOT_OVERHANG = 2.5;

/** Ein rechteckiges Grundstück an einer Straße. */
export interface Lot {
  id: number;
  /** Mitte des Grundstücks. */
  x: number;
  z: number;
  /** Ausrichtung als Winkel: (cos, sin) läuft entlang der Straße, (-sin, cos) zeigt von ihr weg. */
  angle: number;
  /** Größe in Zellen: Breite entlang der Straße, Tiefe von ihr weg. */
  width: number;
  depth: number;
  /** Punkt am Straßenrand vor dem Grundstück. */
  frontX: number;
  frontZ: number;
}

/** Ein von selbst gewachsenes Gebäude in einer Zone. */
export interface Building extends Lot {
  zone: ZoneId;
  floors: number;
  /** Einwohner (Wohnen) oder Arbeitsplätze (Gewerbe, Industrie) auf Stufe 1. */
  baseCapacity: number;
  /** Aktuelle Einwohner bzw. Arbeitsplätze; wächst mit der Stufe. */
  capacity: number;
  /** Ausbaustufe, beginnend bei 1. Zufriedene Gebäude steigen auf. */
  level: number;
  /** Zufriedenheit von 0 bis 1: wie gut Versorgung, Dienste und Steuern passen. */
  happiness: number;
  /** Zufallswert, aus dem die Darstellung Form und Farbe ableitet. */
  seed: number;
}

/** Ein vom Spieler gebauter Versorger oder Dienst. */
export interface ServiceBuilding extends Lot {
  type: ServiceId;
}

/** Liegt der Punkt auf dem Grundstück (plus `margin` Meter Rand)? */
export function onLot(lot: Lot, p: Vec2, margin = 0): boolean {
  const cos = Math.cos(lot.angle);
  const sin = Math.sin(lot.angle);
  const dx = p.x - lot.x;
  const dz = p.z - lot.z;
  const along = dx * cos + dz * sin;
  const away = -dx * sin + dz * cos;
  return Math.abs(along) <= (lot.width * CELL) / 2 + margin && Math.abs(away) <= (lot.depth * CELL) / 2 + margin;
}

/** Punkte im Zellabstand über das ganze Grundstück verteilt, einschließlich Rand. */
function lotPoints(lot: Lot): Vec2[] {
  const cos = Math.cos(lot.angle);
  const sin = Math.sin(lot.angle);
  const points: Vec2[] = [];
  for (let i = 0; i <= lot.width; i++) {
    for (let j = 0; j <= lot.depth; j++) {
      const along = (i - lot.width / 2) * CELL;
      const away = (j - lot.depth / 2) * CELL;
      points.push({ x: lot.x + along * cos - away * sin, z: lot.z + along * sin + away * cos });
    }
  }
  return points;
}

/** Ein Grundstück taugt nur, wenn keine Straße darüber führt und es an einer Straße liegt. */
export function isLotValid(net: RoadNetwork, lot: Lot): boolean {
  const front = { x: lot.frontX, z: lot.frontZ };
  const points = lotPoints(lot);
  let hasAccess = false;
  for (const segment of net.segments.values()) {
    const line = shapeOf(net, segment);
    const half = ROAD_TYPES[segment.type].width / 2;
    if (!nearBounds(line, lot, half + (lot.width + lot.depth) * CELL)) continue;
    if (project(line, front).offset <= half + 1.5) hasAccess = true;
    for (const point of points) {
      if (project(line, point).offset < half - LOT_OVERHANG) return false;
    }
  }
  return hasAccess;
}
