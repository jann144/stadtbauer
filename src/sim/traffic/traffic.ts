import { ROAD_TYPES, SIDEWALK_WIDTH, type RoadTypeId } from '../../config/roads';
import { TIME } from '../../config/settings';
import { TRAFFIC } from '../../config/traffic';
import { ZONE_TYPES } from '../../config/zones';
import type { Building } from '../buildings';
import { pointAt, tangentAt } from '../roads/geometry';
import { nodeOf, segmentOf, shapeOf, type RoadNetwork } from '../roads/graph';
import { lotAccess } from '../services/network';
import type { World } from '../world';
import { findRoute, type Leg } from './routes';

const TPS = TIME.ticksPerSecond;
/** Näher als so an Abschnittsende oder Ziel gilt ein Auto als angekommen (Meter). */
const ARRIVED = 0.3;
/** Anteil des freien Abstands zum Vordermann, den ein Auto je Schritt aufholt; ergibt sanftes Auffahren. */
const CATCH_UP = 0.35;
/** Platz, den ein Auto samt Abstand zum nächsten braucht. */
const REACH = TRAFFIC.carLength + TRAFFIC.minGap;

/** Fahrt durch einen Knoten als Bogen vom Ende eines Abschnitts zum Anfang des nächsten. */
export interface Turn {
  x0: number;
  z0: number;
  /** Kontrollpunkt des Bogens. */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  length: number;
  /** Bereits gefahrene Strecke des Bogens. */
  done: number;
  /** Kreuzung, die das Auto dabei belegt; null an einfachen Knicken. */
  node: number | null;
}

export interface Car {
  id: number;
  legs: Leg[];
  /** Nummer des Abschnitts, auf dem das Auto fährt (oder von dem es gerade abbiegt). */
  leg: number;
  /** Strecke auf dem Abschnitt in Fahrtrichtung. */
  s: number;
  /** Tempo in Metern je Sekunde. */
  speed: number;
  turn: Turn | null;
  /** Simulationsschritte am Stück ohne Bewegung. */
  waited: number;
  /** Lage jetzt und im vorigen Schritt; die Darstellung blendet dazwischen über. */
  x: number;
  z: number;
  angle: number;
  px: number;
  pz: number;
  pangle: number;
}

export interface Traffic {
  /** Die sichtbaren Autos. Sie sind nur Anschauung; gemessen wird die Belastung unabhängig von ihnen. */
  cars: Car[];
  /** Geglättete Belastung je Segment in Fahrten; siehe `congestion`. */
  flows: Map<number, number>;
  /** Herkunft (`age`) jedes gemessenen Segments; daran erben Teilstücke den Messwert, wenn eine Straße geteilt wird. */
  lineage: Map<number, number>;
  /** Welches Auto gerade welche Kreuzung befährt. An Kreuzungen fährt immer nur eines. */
  busyNodes: Map<number, number>;
  nextCarId: number;
  /** Eigener Zufallszustand, damit der Verkehr das Wachstum der Stadt nicht verändert. */
  rng: number;
  /** Erhöht sich jeden Spieltag; daran erkennt die Verkehrsansicht neue Werte. */
  version: number;
}

export function createTraffic(): Traffic {
  return { cars: [], flows: new Map(), lineage: new Map(), busyNodes: new Map(), nextCarId: 1, rng: 987654321, version: 0 };
}

function random(traffic: Traffic): number {
  traffic.rng = (traffic.rng + 0x6d2b79f5) >>> 0;
  let t = traffic.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- Auslastung ---

/**
 * Auslastung eines Segments: 0 = leer, 1 = voll, darüber Stau.
 * Gezählt werden die Fahrten je Spieltag gegen das, was die Fahrspuren vertragen.
 */
export function congestion(world: World, segmentId: number): number {
  const segment = world.roads.segments.get(segmentId);
  if (!segment) return 0;
  const perDay = (world.traffic.flows.get(segmentId) ?? 0) * (1 - TRAFFIC.memory);
  return perDay / (ROAD_TYPES[segment.type].lanes * TRAFFIC.capacityPerLane);
}

/** Anteil des Tempolimits, der bei einer Auslastung noch gefahren wird: frei 1, voll die Hälfte, im Stau wenig. */
export function speedShare(ratio: number): number {
  return Math.max(TRAFFIC.slowestShare, 1 / (1 + ratio ** 3));
}

/** Tempo auf einem Segment bei seiner jetzigen Auslastung, in Metern je Sekunde. */
function speedOn(world: World, segmentId: number): number {
  return ROAD_TYPES[segmentOf(world.roads, segmentId).type].speed * speedShare(congestion(world, segmentId));
}

// --- Fahrspuren und Lage ---

function lanesPerDirection(type: RoadTypeId): number {
  return Math.max(1, Math.floor(ROAD_TYPES[type].lanes / 2));
}

/** Fahrspur eines Autos auf einem Segment; verteilt die Autos gleichmäßig, ohne dass sie die Spur wechseln. */
function laneOf(car: Car, type: RoadTypeId): number {
  return car.id % lanesPerDirection(type);
}

/** Abstand der Spurmitte von der Straßenmitte; Spur 0 liegt innen. Gefahren wird rechts. */
function laneOffset(type: RoadTypeId, lane: number): number {
  const half = ROAD_TYPES[type].width / 2 - SIDEWALK_WIDTH;
  return (half / lanesPerDirection(type)) * (lane + 0.5);
}

function laneKey(net: RoadNetwork, car: Car, leg: Leg): string {
  return `${leg.segment}|${leg.forward ? 1 : 0}|${laneOf(car, segmentOf(net, leg.segment).type)}`;
}

/** Ort und Fahrtrichtung eines Autos an der Stelle `s` eines Abschnitts. */
function poseOnLeg(net: RoadNetwork, car: Car, leg: Leg, s: number): { x: number; z: number; dx: number; dz: number } {
  const segment = segmentOf(net, leg.segment);
  const line = shapeOf(net, segment);
  const along = leg.forward ? s : line.length - s;
  const p = pointAt(line, along);
  const t = tangentAt(line, along);
  const dx = leg.forward ? t.x : -t.x;
  const dz = leg.forward ? t.z : -t.z;
  const offset = laneOffset(segment.type, laneOf(car, segment.type));
  // (-dz, dx) zeigt in Fahrtrichtung nach rechts.
  return { x: p.x - dz * offset, z: p.z + dx * offset, dx, dz };
}

/** Ob ein Knoten eine Kreuzung ist (drei oder mehr Arme). Nur dort wird gewartet und einzeln gefahren. */
function isJunction(net: RoadNetwork, nodeId: number): boolean {
  return nodeOf(net, nodeId).segments.length >= 3;
}

/** Halbmesser der Fläche um einen Knoten, die im Bogen durchfahren wird. */
export function junctionRadius(net: RoadNetwork, nodeId: number): number {
  const arms = nodeOf(net, nodeId).segments;
  if (arms.length < 2) return 0;
  if (arms.length === 2) return 3;
  let widest = 0;
  for (const id of arms) widest = Math.max(widest, ROAD_TYPES[segmentOf(net, id).type].width / 2 - SIDEWALK_WIDTH + 1);
  return widest;
}

function exitNode(net: RoadNetwork, leg: Leg): number {
  const segment = segmentOf(net, leg.segment);
  return leg.forward ? segment.to : segment.from;
}

/** Kürzt die Abschnitte um die Knotenflächen: dort fahren die Autos im Bogen statt auf der Spur. */
function trimLegs(net: RoadNetwork, legs: Leg[]): void {
  legs.forEach((leg, index) => {
    const segment = segmentOf(net, leg.segment);
    const length = shapeOf(net, segment).length;
    const room = length / 2 - 0.25;
    if (index > 0) {
      const entry = leg.forward ? segment.from : segment.to;
      leg.start = Math.max(leg.start, Math.min(junctionRadius(net, entry), room));
    }
    if (index < legs.length - 1) {
      leg.end = Math.min(leg.end, length - Math.min(junctionRadius(net, exitNode(net, leg)), room));
    }
    // Start oder Ziel liegen in der Knotenfläche: der Abschnitt schrumpft auf einen Punkt.
    if (leg.end < leg.start) {
      if (index === 0) leg.start = leg.end;
      else leg.end = leg.start;
    }
  });
}

// --- Fahrten ---

interface Places {
  version: number;
  homes: Building[];
  jobs: Building[];
}
const placesCache = new WeakMap<World, Places>();

/** Wohnhäuser und Arbeitsstätten, zwischen denen gefahren wird; neu bestimmt, wenn sich die Gebäude ändern. */
function placesOf(world: World): Places {
  let places = placesCache.get(world);
  if (!places || places.version !== world.buildingsVersion) {
    places = { version: world.buildingsVersion, homes: [], jobs: [] };
    for (const building of world.buildings.values()) {
      (ZONE_TYPES[building.zone].kind === 'residential' ? places.homes : places.jobs).push(building);
    }
    placesCache.set(world, places);
  }
  return places;
}

/** Wählt zufällig ein Gebäude; große Gebäude entsprechend öfter. */
function pick(buildings: Building[], traffic: Traffic): Building {
  let total = 0;
  for (const building of buildings) total += building.capacity;
  let left = random(traffic) * total;
  for (const building of buildings) {
    left -= building.capacity;
    if (left < 0) return building;
  }
  return buildings[buildings.length - 1];
}

/**
 * Würfelt eine Fahrt zwischen einem Wohnhaus und einer Arbeitsstätte und sucht ihren Weg.
 * Null, wenn es eines von beiden nicht gibt oder keine Straße sie verbindet.
 */
function sampleTrip(world: World): Leg[] | null {
  const traffic = world.traffic;
  const { homes, jobs } = placesOf(world);
  if (homes.length === 0 || jobs.length === 0) return null;
  let from = pick(homes, traffic);
  let to = pick(jobs, traffic);
  // Die Hälfte der Fahrten geht nach Hause.
  if (random(traffic) < 0.5) [from, to] = [to, from];
  const start = lotAccess(world, from);
  const goal = lotAccess(world, to);
  if (!start || !goal) return null;
  const net = world.roads;
  return findRoute(net, start, goal, (segment) => shapeOf(net, segment).length / speedOn(world, segment.id));
}

/**
 * Zählt eine gewürfelte Fahrt als Belastung ihrer Straßen. Jeder Simulationsschritt würfelt eine Fahrt,
 * die für alle Fahrten dieses Schritts steht; über den Tag ergibt das die Fahrten der ganzen Stadt.
 * Die sichtbaren Autos spielen dabei keine Rolle.
 */
function countTrip(world: World, legs: Leg[]): void {
  const { flows, lineage } = world.traffic;
  const share = (world.stats.residents * TRAFFIC.tripsPerResident) / TIME.ticksPerDay;
  const counted = new Set<number>();
  for (const leg of legs) {
    if (counted.has(leg.segment)) continue;
    counted.add(leg.segment);
    flows.set(leg.segment, (flows.get(leg.segment) ?? 0) + share);
    lineage.set(leg.segment, segmentOf(world.roads, leg.segment).age);
  }
}

/** Schickt für eine gewürfelte Fahrt ein sichtbares Auto los, wenn an seinem Startplatz Raum ist. */
function spawnCar(world: World, legs: Leg[], lanes: Map<string, Car[]>, turners: Map<string, Car[]>): void {
  const traffic = world.traffic;
  const net = world.roads;
  trimLegs(net, legs);
  const car: Car = {
    id: traffic.nextCarId,
    legs,
    leg: 0,
    s: legs[0].start,
    speed: 0,
    turn: null,
    waited: 0,
    x: 0,
    z: 0,
    angle: 0,
    px: 0,
    pz: 0,
    pangle: 0,
  };
  // Nur losfahren, wenn auf der Spur an dieser Stelle Platz ist und gerade niemand in sie einbiegt.
  const key = laneKey(net, car, legs[0]);
  if (turners.has(key) || (lanes.get(key) ?? []).some((other) => Math.abs(other.s - car.s) < REACH)) return;

  traffic.nextCarId++;
  place(net, car);
  car.px = car.x;
  car.pz = car.z;
  car.pangle = car.angle;
  traffic.cars.push(car);
  const lane = lanes.get(key);
  if (lane) lane.push(car);
  else lanes.set(key, [car]);
}

// --- Fahren ---

/** Setzt Ort und Blickrichtung des Autos aus seinem Abschnitt oder Bogen. */
function place(net: RoadNetwork, car: Car): void {
  const turn = car.turn;
  if (!turn) {
    const pose = poseOnLeg(net, car, car.legs[car.leg], car.s);
    car.x = pose.x;
    car.z = pose.z;
    car.angle = Math.atan2(pose.dz, pose.dx);
    return;
  }
  const t = Math.min(1, turn.done / turn.length);
  const u = 1 - t;
  car.x = u * u * turn.x0 + 2 * u * t * turn.x1 + t * t * turn.x2;
  car.z = u * u * turn.z0 + 2 * u * t * turn.z1 + t * t * turn.z2;
  car.angle = Math.atan2(u * (turn.z1 - turn.z0) + t * (turn.z2 - turn.z1), u * (turn.x1 - turn.x0) + t * (turn.x2 - turn.x1));
}

/** Bogen vom Ende des jetzigen Abschnitts zum Anfang des nächsten. */
function makeTurn(net: RoadNetwork, car: Car, node: number | null): Turn {
  const here = car.legs[car.leg];
  const next = car.legs[car.leg + 1];
  const a = poseOnLeg(net, car, here, here.end);
  const b = poseOnLeg(net, car, next, next.start);
  // Kontrollpunkt: wo sich die beiden Fahrtrichtungen schneiden; bei fast gerader Fahrt die Mitte.
  let x1 = (a.x + b.x) / 2;
  let z1 = (a.z + b.z) / 2;
  const cross = a.dx * b.dz - a.dz * b.dx;
  if (Math.abs(cross) > 0.05) {
    const along = ((b.x - a.x) * b.dz - (b.z - a.z) * b.dx) / cross;
    if (along > 0 && along < 40) {
      x1 = a.x + a.dx * along;
      z1 = a.z + a.dz * along;
    }
  }
  const length = Math.max(0.5, Math.hypot(x1 - a.x, z1 - a.z) + Math.hypot(b.x - x1, b.z - z1));
  return { x0: a.x, z0: a.z, x1, z1, x2: b.x, z2: b.z, length, done: 0, node };
}

/** Entfernt ein Auto aus dem Verkehr und gibt eine von ihm belegte Kreuzung frei. */
function remove(traffic: Traffic, car: Car): void {
  if (car.turn?.node != null && traffic.busyNodes.get(car.turn.node) === car.id) traffic.busyNodes.delete(car.turn.node);
  traffic.cars.splice(traffic.cars.indexOf(car), 1);
}

/** Ein Simulationsschritt des Verkehrs: eine Fahrt zählen, bei Bedarf ein Auto starten, alle Autos bewegen. */
export function stepTraffic(world: World): void {
  const traffic = world.traffic;
  const net = world.roads;
  const trip = sampleTrip(world);
  if (trip) countTrip(world, trip);

  // Autos je Fahrspur und Autos, die gerade in eine Spur einbiegen. Stand vom Beginn des Schritts.
  const lanes = new Map<string, Car[]>();
  const turners = new Map<string, Car[]>();
  const add = (map: Map<string, Car[]>, key: string, car: Car): void => {
    const list = map.get(key);
    if (list) list.push(car);
    else map.set(key, [car]);
  };
  for (const car of traffic.cars) {
    if (car.turn) add(turners, laneKey(net, car, car.legs[car.leg + 1]), car);
    else add(lanes, laneKey(net, car, car.legs[car.leg]), car);
  }

  const wanted = Math.min(TRAFFIC.maxCars, Math.floor(world.stats.residents * TRAFFIC.carsPerResident));
  if (trip && traffic.cars.length < wanted) spawnCar(world, trip, lanes, turners);

  // Je Spur das vorderste Auto zuerst; so kennt jedes seinen Vordermann.
  const leaders = new Map<Car, Car>();
  for (const lane of lanes.values()) {
    lane.sort((a, b) => b.s - a.s);
    for (let i = 1; i < lane.length; i++) leaders.set(lane[i], lane[i - 1]);
  }
  /** Ist am Anfang einer Spur Platz für ein weiteres Auto? */
  const hasRoom = (key: string, at: number): boolean => !(lanes.get(key) ?? []).some((other) => other.s < at + REACH);
  /** Strecke vom Anfang einer Spur bis zum hintersten Auto auf ihr. */
  const firstOn = (key: string, start: number): number => {
    const lane = lanes.get(key);
    return lane && lane.length > 0 ? lane[lane.length - 1].s - start : Infinity;
  };

  for (const car of [...traffic.cars]) {
    car.px = car.x;
    car.pz = car.z;
    car.pangle = car.angle;

    if (car.turn) {
      const turn = car.turn;
      const next = car.legs[car.leg + 1];
      let speed: number;
      if (turn.node !== null) {
        // Die Kreuzung gehört diesem Auto allein; es fährt zügig hindurch.
        speed = Math.min(TRAFFIC.turnSpeed, Math.max(2, car.speed + TRAFFIC.acceleration));
      } else {
        // Am einfachen Knick dem Vordermann folgen, als gäbe es den Knoten nicht.
        const key = laneKey(net, car, next);
        let ahead = turn.length - turn.done + firstOn(key, next.start);
        for (const other of turners.get(key) ?? []) {
          if (other !== car && other.turn && other.turn.done > turn.done) ahead = Math.min(ahead, other.turn.done - turn.done);
        }
        speed = Math.min(speedOn(world, next.segment), car.speed + TRAFFIC.acceleration, Math.max(0, ahead - REACH) * CATCH_UP * TPS);
      }
      car.speed = speed;
      turn.done += speed / TPS;
      if (turn.done >= turn.length) {
        if (turn.node !== null) traffic.busyNodes.delete(turn.node);
        car.turn = null;
        car.leg++;
        car.s = next.start;
      }
      car.waited = speed > 0.05 ? 0 : car.waited + 1;
      if (car.waited > TRAFFIC.stuckTicks) remove(traffic, car);
      else place(net, car);
      continue;
    }

    const leg = car.legs[car.leg];
    const isLast = car.leg === car.legs.length - 1;
    const remaining = leg.end - car.s;
    const node = exitNode(net, leg);
    const crossing = !isLast && isJunction(net, node);
    const next = isLast ? null : car.legs[car.leg + 1];
    const nextKey = next ? laneKey(net, car, next) : '';
    // Platz hinter dem Knoten: an Kreuzungen muss der Anfang der Spur frei sein, an Knicken zählt der Abstand
    // zum nächsten Auto über den Knoten hinweg.
    let beyond = Infinity;
    if (next && !crossing) {
      const arc = shapeOf(net, segmentOf(net, leg.segment)).length - leg.end + next.start;
      beyond = arc + firstOn(nextKey, next.start);
      for (const other of turners.get(nextKey) ?? []) beyond = Math.min(beyond, other.turn?.done ?? Infinity);
    }

    if (remaining <= ARRIVED) {
      if (isLast) {
        remove(traffic, car);
        continue;
      }
      const free = crossing
        ? !traffic.busyNodes.has(node) && !turners.has(nextKey) && hasRoom(nextKey, next!.start)
        : beyond >= REACH;
      if (free) {
        if (crossing) traffic.busyNodes.set(node, car.id);
        car.turn = makeTurn(net, car, crossing ? node : null);
        add(turners, nextKey, car);
        car.waited = 0;
      } else {
        car.speed = 0;
        if (++car.waited > TRAFFIC.stuckTicks) remove(traffic, car);
      }
      continue;
    }

    let speed = Math.min(speedOn(world, leg.segment), car.speed + TRAFFIC.acceleration);
    const leader = leaders.get(car);
    if (leader) speed = Math.min(speed, Math.max(0, leader.s - car.s - REACH) * CATCH_UP * TPS);
    if (isLast) {
      // Am Ziel ausrollen.
      speed = Math.min(speed, Math.max(remaining * CATCH_UP * TPS, 1));
    } else if (crossing) {
      // Vor der Kreuzung abbremsen; ist sie belegt, sanft bis an die Haltelinie.
      const blocked = traffic.busyNodes.has(node) || turners.has(nextKey) || !hasRoom(nextKey, next!.start);
      speed = Math.min(speed, Math.max(remaining * CATCH_UP * TPS, blocked ? 0.6 : TRAFFIC.turnSpeed));
    } else {
      speed = Math.min(speed, Math.max(0, remaining + beyond - REACH) * CATCH_UP * TPS);
    }
    car.speed = speed;
    car.s = Math.min(leg.end, car.s + speed / TPS);
    car.waited = speed > 0.05 ? 0 : car.waited + 1;
    if (car.waited > TRAFFIC.stuckTicks) {
      remove(traffic, car);
      continue;
    }
    place(net, car);
  }
}

/** Einmal je Spieltag verblasst die gemessene Belastung; so folgt sie Änderungen der Stadt über einige Tage. */
export function endTrafficDay(world: World): void {
  const { flows, lineage } = world.traffic;
  for (const [segment, flow] of flows) {
    const faded = flow * TRAFFIC.memory;
    if (faded < 0.01) {
      flows.delete(segment);
      lineage.delete(segment);
    } else {
      flows.set(segment, faded);
    }
  }
  world.traffic.version++;
}

/**
 * Nach einer Änderung am Straßennetz enden alle sichtbaren Fahrten. Die Messwerte bleiben: wird eine Straße
 * geteilt oder mit einer anderen zusammengelegt, erben die neuen Stücke den Wert des Stücks gleicher Herkunft.
 */
export function resetTraffic(world: World): void {
  const { flows, lineage } = world.traffic;
  const net = world.roads;
  world.traffic.cars = [];
  world.traffic.busyNodes.clear();

  const orphans = new Map<number, number>();
  for (const [id, flow] of flows) {
    if (net.segments.has(id)) continue;
    const age = lineage.get(id);
    if (age !== undefined) orphans.set(age, Math.max(orphans.get(age) ?? 0, flow));
    flows.delete(id);
    lineage.delete(id);
  }
  for (const segment of net.segments.values()) {
    const inherited = orphans.get(segment.age);
    if (inherited === undefined || flows.has(segment.id)) continue;
    flows.set(segment.id, inherited);
    lineage.set(segment.id, segment.age);
  }
  world.traffic.version++;
}
