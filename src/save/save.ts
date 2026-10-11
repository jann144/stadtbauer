import { MILESTONES } from '../config/milestones';
import { ROAD_TYPES } from '../config/roads';
import { SERVICE_TYPES } from '../config/services';
import { ZONE_TYPES, type ZoneId } from '../config/zones';
import type { Building, ServiceBuilding } from '../sim/buildings';
import type { Economy } from '../sim/economy/budget';
import type { CityStats, Demand } from '../sim/economy/demand';
import type { RoadSegment } from '../sim/roads/graph';
import type { CityServices } from '../sim/services/services';
import { createWorld, type Sandbox, type World } from '../sim/world';
import { carryZones, gridOfZones, layoutCells } from '../sim/zoning/cells';
import { occupy } from '../sim/zoning/lots';

/** Nummer des Spielstand-Formats; erhöht sich, wenn alte Spielstände nicht mehr passen. */
export const SAVE_VERSION = 1;

/**
 * So nah muss ein gespeicherter Zonenpunkt an einer Zelle liegen, um ihr zu gehören (Meter).
 * Die Punkte sind auf Zentimeter gerundet; Nachbarzellen liegen mehrere Meter entfernt.
 */
const ZONE_MATCH = 0.5;

/** Blick der Kamera, damit das Spiel dort weitergeht, wo man aufgehört hat. */
export interface SavedCamera {
  x: number;
  z: number;
  distance: number;
  yaw: number;
  pitch: number;
}

/**
 * Ein Spielstand: der Zustand der Welt als reine Daten, die sich als JSON ablegen lassen.
 * Alles Abgeleitete fehlt und entsteht beim Laden neu: das Zellraster, die Suchstrukturen und die fahrenden Autos.
 */
export interface SaveData {
  version: number;
  /** Zeitpunkt des Speicherns als ISO-Text; nur zur Anzeige. */
  savedAt: string;
  camera: SavedCamera | null;
  tick: number;
  rng: number;
  roads: {
    nextId: number;
    nodes: { id: number; x: number; z: number }[];
    segments: RoadSegment[];
  };
  /** Je Zonenart die Mittelpunkte ihrer Zellen als x1, z1, x2, z2 …, auf Zentimeter gerundet. */
  zones: Partial<Record<ZoneId, number[]>>;
  buildings: Building[];
  services: ServiceBuilding[];
  nextBuildingId: number;
  stats: CityStats;
  demand: Demand;
  city: CityServices;
  economy: Economy;
  milestone: number;
  sandbox: Sandbox;
  traffic: { flows: [number, number][]; lineage: [number, number][]; rng: number };
}

function centimeters(meters: number): number {
  return Math.round(meters * 100) / 100;
}

/** Macht aus der Welt einen Spielstand. `savedAt` kommt von außen, weil die Simulation keine Uhrzeit kennt. */
export function toSave(world: World, savedAt: string, camera: SavedCamera | null = null): SaveData {
  const zones: SaveData['zones'] = {};
  for (const cell of world.zoning.cells) {
    if (cell.zone !== null) (zones[cell.zone] ??= []).push(centimeters(cell.x), centimeters(cell.z));
  }
  return {
    version: SAVE_VERSION,
    savedAt,
    camera,
    tick: world.tick,
    rng: world.rng,
    roads: {
      nextId: world.roads.nextId,
      nodes: [...world.roads.nodes.values()].map((node) => ({ id: node.id, x: node.x, z: node.z })),
      segments: [...world.roads.segments.values()],
    },
    zones,
    buildings: [...world.buildings.values()],
    services: [...world.services.values()],
    nextBuildingId: world.nextBuildingId,
    stats: world.stats,
    demand: world.demand,
    city: world.city,
    economy: world.economy,
    milestone: world.milestone,
    sandbox: world.sandbox,
    traffic: {
      flows: [...world.traffic.flows],
      lineage: [...world.traffic.lineage],
      rng: world.traffic.rng,
    },
  };
}

/** Wirft einen verständlichen Fehler, wenn die Daten kein brauchbarer Spielstand sind. */
function check(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(`Kein gültiger Spielstand: ${what}.`);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Ob `key` ein Eintrag der Tabelle ist, etwa ein bekannter Straßentyp. */
function known(table: object, key: unknown): boolean {
  return typeof key === 'string' && Object.hasOwn(table, key);
}

/**
 * Baut aus einem Spielstand die Welt wieder auf. Die Daten können aus einer Datei stammen, also wird geprüft,
 * was sonst zu Abstürzen führte: die Version, die Verweise im Straßennetz und unbekannte Typen.
 */
export function fromSave(input: unknown): World {
  check(input !== null && typeof input === 'object', 'keine Daten');
  // Über JSON kopieren: die Welt soll keine Objekte mit dem Spielstand teilen.
  const data = JSON.parse(JSON.stringify(input)) as SaveData;
  check(isNumber(data.version), 'die Version fehlt');
  check(data.version === SAVE_VERSION, `Version ${data.version} wird nicht unterstützt`);
  check(isNumber(data.tick) && isNumber(data.rng) && isNumber(data.nextBuildingId), 'der Zeitpunkt fehlt');
  check(data.roads && Array.isArray(data.roads.nodes) && Array.isArray(data.roads.segments), 'die Straßen fehlen');
  check(Array.isArray(data.buildings) && Array.isArray(data.services), 'die Gebäude fehlen');
  check(data.economy && isNumber(data.economy.money), 'die Kasse fehlt');

  const world = createWorld();
  world.tick = data.tick;
  world.rng = data.rng;

  const net = world.roads;
  net.nextId = data.roads.nextId;
  for (const node of data.roads.nodes) {
    check(isNumber(node.id) && isNumber(node.x) && isNumber(node.z), 'ein Straßenknoten ist beschädigt');
    net.nodes.set(node.id, { id: node.id, x: node.x, z: node.z, segments: [] });
  }
  for (const segment of data.roads.segments) {
    const from = net.nodes.get(segment.from);
    const to = net.nodes.get(segment.to);
    check(from && to, `Straße ${segment.id} verweist auf fehlende Knoten`);
    check(known(ROAD_TYPES, segment.type), `unbekannter Straßentyp „${String(segment.type)}“`);
    net.segments.set(segment.id, segment);
    from.segments.push(segment.id);
    to.segments.push(segment.id);
  }

  for (const building of data.buildings) {
    check(known(ZONE_TYPES, building.zone), `unbekannte Zone „${String(building.zone)}“`);
    world.buildings.set(building.id, building);
  }
  for (const service of data.services) {
    check(known(SERVICE_TYPES, service.type), `unbekannter Dienst „${String(service.type)}“`);
    world.services.set(service.id, service);
  }
  world.nextBuildingId = data.nextBuildingId;

  // Das Zellraster entsteht aus den Straßen neu; die Zonen kommen von den gespeicherten Punkten zurück.
  const points: { x: number; z: number; zone: ZoneId }[] = [];
  for (const [zone, list] of Object.entries(data.zones ?? {})) {
    if (!known(ZONE_TYPES, zone) || !Array.isArray(list)) continue;
    for (let i = 0; i + 1 < list.length; i += 2) points.push({ x: list[i], z: list[i + 1], zone: zone as ZoneId });
  }
  const grid = layoutCells(net);
  carryZones(grid, gridOfZones(points), ZONE_MATCH);
  for (const building of world.buildings.values()) occupy(grid, building);
  for (const service of world.services.values()) occupy(grid, service);
  grid.version = 1;
  world.zoning = grid;
  world.buildingsVersion = 1;
  world.servicesVersion = 1;

  // Auf den Vorgaben einer neuen Welt aufbauen: so fehlt nichts, wenn ein älterer Stand ein Feld noch nicht kannte.
  world.stats = { ...world.stats, ...data.stats };
  world.demand = { ...world.demand, ...data.demand };
  world.city = { ...world.city, ...data.city };
  world.economy = { ...world.economy, ...data.economy };
  world.milestone = Math.min(MILESTONES.length - 1, Math.max(0, Math.floor(Number(data.milestone) || 0)));
  world.sandbox = { infiniteMoney: Boolean(data.sandbox?.infiniteMoney), unlockAll: Boolean(data.sandbox?.unlockAll) };
  world.traffic.flows = new Map(data.traffic?.flows ?? []);
  world.traffic.lineage = new Map(data.traffic?.lineage ?? []);
  world.traffic.rng = data.traffic?.rng ?? world.traffic.rng;
  return world;
}

/** Der gespeicherte Blick der Kamera, oder null, wenn er fehlt oder unbrauchbar ist. */
export function cameraOf(input: unknown): SavedCamera | null {
  const camera = (input as { camera?: Partial<SavedCamera> | null } | null)?.camera;
  if (!camera || typeof camera !== 'object') return null;
  const { x, z, distance, yaw, pitch } = camera;
  if (!isNumber(x) || !isNumber(z) || !isNumber(distance) || !isNumber(yaw) || !isNumber(pitch)) return null;
  return { x, z, distance, yaw, pitch };
}
