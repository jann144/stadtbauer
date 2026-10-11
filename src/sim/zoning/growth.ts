import { WORLD } from '../../config/settings';
import { ZONE_TYPES, type ZoneId, type ZoneKind } from '../../config/zones';
import { isLotValid, type Building } from '../buildings';
import { earn, growthFactors, serviceRefund } from '../economy/budget';
import { cityStats, demandFor } from '../economy/demand';
import { nextRandom } from '../random';
import { updateServices } from '../services/services';
import { resetTraffic } from '../traffic/traffic';
import type { World } from '../world';
import { carryZones, cellAt, cellsNear, layoutCells, type ZoneCell } from './cells';
import { isLotFree, lotFromCells, occupy } from './lots';

const CELL = WORLD.cellSize;
const KINDS: ZoneKind[] = ['residential', 'commercial', 'industrial'];
/**
 * Beim Neuanlegen der Zellen übernimmt eine Zelle die Zone der alten Zelle im Umkreis dieser Meter.
 * Eine halbe Zelldiagonale: so findet auch ein verschobenes Raster überall seine Vorgängerzelle.
 */
export const CARRY_RADIUS = CELL * Math.SQRT1_2 + 0.1;
/** So viele zufällige Startzellen werden je Zonenart probiert, bevor das Wachstum aussetzt. */
const SPAWN_ATTEMPTS = 4;

function randomInt(world: World, [min, max]: [number, number]): number {
  return min + Math.floor(nextRandom(world) * (max - min + 1));
}

/**
 * Weist allen freien Zellen im Umkreis eine Zone zu (null entfernt sie). Liefert, ob sich etwas geändert hat.
 * In `undo` wird je geänderter Zelle die vorherige Zone vermerkt, damit sich ein Pinselstrich zurücknehmen lässt.
 */
export function paintZone(
  world: World,
  x: number,
  z: number,
  radius: number,
  zone: ZoneId | null,
  undo?: Map<ZoneCell, ZoneId | null>,
): boolean {
  let changed = false;
  for (const cell of cellsNear(world.zoning, { x, z }, radius)) {
    if (cell.building !== null || cell.zone === zone) continue;
    if (undo && !undo.has(cell)) undo.set(cell, cell.zone);
    cell.zone = zone;
    changed = true;
  }
  if (changed) world.zoning.version++;
  return changed;
}

/** Setzt die in `undo` vermerkten Zellen auf ihre vorherige Zone zurück. */
export function restoreZones(world: World, undo: Map<ZoneCell, ZoneId | null>): void {
  for (const [cell, zone] of undo) {
    if (cell.building === null) cell.zone = zone;
  }
  if (undo.size > 0) world.zoning.version++;
}

/**
 * Nach jeder Änderung am Straßennetz: Gebäude und Dienste ohne Straße oder unter einer Straße verschwinden
 * (Dienste mit der üblichen Erstattung), die Zellen werden neu angelegt und behalten Zone und Belegung.
 */
export function roadsChanged(world: World): void {
  for (const building of [...world.buildings.values()]) {
    if (!isLotValid(world.roads, building)) world.buildings.delete(building.id);
  }
  for (const service of [...world.services.values()]) {
    if (isLotValid(world.roads, service)) continue;
    world.services.delete(service.id);
    earn(world, serviceRefund(service.type));
    world.servicesVersion++;
  }

  const old = world.zoning;
  const grid = layoutCells(world.roads);
  carryZones(grid, old, CARRY_RADIUS);
  for (const building of world.buildings.values()) occupy(grid, building);
  for (const service of world.services.values()) occupy(grid, service);
  grid.version = old.version + 1;
  world.zoning = grid;
  world.buildingsVersion++;
  // Sofort neu zählen: sonst zeigt die Anzeige abgerissene Gebäude bis zum nächsten Wachstumsschritt mit.
  world.stats = cityStats(world.buildings.values());
  resetTraffic(world);
  updateServices(world);
  world.demand = demandFor(world.stats, growthFactors(world));
}

/** Ein Wachstumsschritt: berechnet die Nachfrage und lässt je Zonenart höchstens ein Gebäude entstehen. */
export function growCity(world: World): void {
  world.stats = cityStats(world.buildings.values());
  world.demand = demandFor(world.stats, growthFactors(world));
  let built = false;
  for (const kind of KINDS) {
    if (nextRandom(world) < world.demand[kind]) built = spawnBuilding(world, kind) || built;
  }
  if (!built) return;
  world.stats = cityStats(world.buildings.values());
  world.buildingsVersion++;
  world.zoning.version++;
}

function spawnBuilding(world: World, kind: ZoneKind): boolean {
  const starts = world.zoning.cells.filter(
    (cell) => cell.row === 0 && cell.building === null && cell.zone !== null && ZONE_TYPES[cell.zone].kind === kind,
  );
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS && starts.length > 0; attempt++) {
    const start = starts[Math.floor(nextRandom(world) * starts.length)];
    const building = planBuilding(world, start);
    if (!building) continue;
    world.buildings.set(building.id, building);
    occupy(world.zoning, building);
    return true;
  }
  return false;
}

/** Sucht ab der Startzelle ein rechteckiges Grundstück und entwirft darauf ein Gebäude. */
function planBuilding(world: World, start: ZoneCell): Building | null {
  const zone = start.zone;
  if (zone === null) return null;
  const type = ZONE_TYPES[zone];
  const grid = world.zoning;
  const isOpen = (column: number, row: number): ZoneCell | null => {
    const cell = cellAt(grid, start.segment, start.side, column, row);
    return cell && cell.zone === zone && cell.building === null ? cell : null;
  };

  // Die zusammenhängende freie Reihe an der Straße, in der die Startzelle liegt.
  let first = start.column;
  while (isOpen(first - 1, 0)) first--;
  let end = start.column + 1;
  while (isOpen(end, 0)) end++;

  const [minWidth, maxWidth] = type.lotWidth;
  const wantedWidth = randomInt(world, type.lotWidth);
  const wantedDepth = randomInt(world, type.lotDepth);

  // Von links her die erste Stelle nehmen, an der ein Grundstück passt. So bleiben kaum Lücken,
  // und eine einzelne zu flach ausgewiesene Spalte blockiert nicht die ganze Reihe.
  for (let left = first; left + minWidth <= end; left++) {
    const room = end - left;
    let width = Math.min(wantedWidth, room);
    // Bliebe ein unbrauchbar schmaler Rest, nimmt das Grundstück ihn mit oder lässt Platz für ein weiteres.
    const leftover = room - width;
    if (leftover > 0 && leftover < minWidth) width = room <= maxWidth ? room : Math.max(minWidth, room - minWidth);

    for (; width >= minWidth; width--) {
      for (let depth = wantedDepth; depth >= type.lotDepth[0]; depth--) {
        const cells: ZoneCell[] = [];
        for (let column = left; column < left + width; column++) {
          for (let row = 0; row < depth; row++) {
            const cell = isOpen(column, row);
            if (cell) cells.push(cell);
          }
        }
        if (cells.length !== width * depth) continue;
        const building = designBuilding(world, zone, cells, width, depth);
        // Auch die Zellen am Rand müssen frei sein: in Kurven ragt ein Grundstück in Nachbarspalten hinein.
        if (isLotValid(world.roads, building) && isLotFree(grid, building)) {
          world.nextBuildingId++;
          return building;
        }
      }
    }
  }
  return null;
}

function designBuilding(world: World, zone: ZoneId, cells: ZoneCell[], width: number, depth: number): Building {
  const type = ZONE_TYPES[zone];
  const floors = randomInt(world, type.floors);
  const capacity = Math.max(1, Math.round(width * depth * floors * type.capacityPerCellFloor));
  return {
    id: world.nextBuildingId,
    zone,
    ...lotFromCells(cells, width),
    width,
    depth,
    floors,
    baseCapacity: capacity,
    capacity,
    level: 1,
    // Bis zur nächsten Auswertung der Dienste gilt ein neues Gebäude als zufrieden.
    happiness: 1,
    seed: Math.floor(nextRandom(world) * 0xffffffff),
  };
}
