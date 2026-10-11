import { cross, distance, dot, lerp, normalize, sub, type Vec2 } from '../../util/vec2';

/** Abstand der Abtastpunkte auf Kurven in Metern. */
const SAMPLE_STEP = 4;
const EPSILON = 1e-9;

/** Abgetastete Mittellinie eines Straßenstücks. Die Punkte liegen gleichmäßig im Kurvenparameter. */
export interface Polyline {
  points: Vec2[];
  /** Zurückgelegte Strecke bis zu jedem Punkt; beginnt bei 0. */
  lengths: number[];
  length: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Nächster Punkt einer Linie zu einem gegebenen Punkt. */
export interface Projection {
  /** Strecke entlang der Linie bis zum nächsten Punkt. */
  distance: number;
  point: Vec2;
  /** Abstand des gegebenen Punkts von der Linie. */
  offset: number;
}

export interface Crossing {
  point: Vec2;
  /** Strecke entlang der ersten und der zweiten Linie bis zum Schnittpunkt. */
  distanceA: number;
  distanceB: number;
}

export function bezierPoint(a: Vec2, control: Vec2, b: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    z: u * u * a.z + 2 * u * t * control.z + t * t * b.z,
  };
}

/** Fahrtrichtung einer quadratischen Bézier-Kurve beim Parameter t als Einheitsvektor. */
export function bezierTangent(a: Vec2, control: Vec2, b: Vec2, t: number): Vec2 {
  return normalize({
    x: (1 - t) * (control.x - a.x) + t * (b.x - control.x),
    z: (1 - t) * (control.z - a.z) + t * (b.z - control.z),
  });
}

/** Kontrollpunkt des Teilstücks einer quadratischen Bézier-Kurve zwischen den Parametern t0 und t1. */
export function subControl(a: Vec2, control: Vec2, b: Vec2, t0: number, t1: number): Vec2 {
  const wa = (1 - t0) * (1 - t1);
  const wc = t0 * (1 - t1) + t1 * (1 - t0);
  const wb = t0 * t1;
  return {
    x: wa * a.x + wc * control.x + wb * b.x,
    z: wa * a.z + wc * control.z + wb * b.z,
  };
}

/** Kleinster Krümmungsradius einer quadratischen Bézier-Kurve; 0, wenn sie auf sich selbst zurückläuft. */
export function minRadius(a: Vec2, control: Vec2, b: Vec2): number {
  const inward = sub(control, a);
  const outward = sub(b, control);
  const bend = Math.abs(cross(inward, outward));
  if (bend < EPSILON) return dot(inward, outward) < 0 ? 0 : Infinity;

  // Die Ableitung B'(t) = 2 · (inward + t · change) ist linear in t. Am Punkt mit der kleinsten
  // Geschwindigkeit ist die Kurve am engsten; dort gilt Radius = |B'|³ / |B' × B''| = |B'|³ / (4 · bend).
  const change = sub(outward, inward);
  const t = Math.min(1, Math.max(0, -dot(inward, change) / dot(change, change)));
  const speed = 2 * Math.hypot(inward.x + t * change.x, inward.z + t * change.z);
  return speed ** 3 / (4 * bend);
}

/**
 * Krümmung einer quadratischen Bézier-Kurve beim Parameter t (Kehrwert des Radius).
 * Positiv, wenn die Kurve nach rechts biegt, also zur Seite (-Richtung.z, Richtung.x).
 */
export function curvatureAt(a: Vec2, control: Vec2, b: Vec2, t: number): number {
  const inward = sub(control, a);
  const outward = sub(b, control);
  const speed = 2 * Math.hypot(inward.x + t * (outward.x - inward.x), inward.z + t * (outward.z - inward.z));
  return speed > EPSILON ? (4 * cross(inward, outward)) / speed ** 3 : 0;
}

/** Tastet eine Gerade oder (mit Kontrollpunkt) eine quadratische Bézier-Kurve ab. */
export function samplePath(a: Vec2, b: Vec2, control?: Vec2): Polyline {
  if (!control) return toPolyline([{ x: a.x, z: a.z }, { x: b.x, z: b.z }]);
  const rough = distance(a, control) + distance(control, b);
  const count = Math.min(96, Math.max(8, Math.ceil(rough / SAMPLE_STEP)));
  const points: Vec2[] = [];
  for (let i = 0; i <= count; i++) points.push(bezierPoint(a, control, b, i / count));
  return toPolyline(points);
}

function toPolyline(points: Vec2[]): Polyline {
  const lengths = [0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) lengths.push(lengths[i - 1] + distance(points[i - 1], p));
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { points, lengths, length: lengths[lengths.length - 1], minX, maxX, minZ, maxZ };
}

/** Teilstück der Linie, in dem die Strecke `dist` liegt, und der Anteil innerhalb dieses Stücks. */
function locate(line: Polyline, dist: number): { index: number; fraction: number } {
  const last = line.points.length - 2;
  if (dist <= 0) return { index: 0, fraction: 0 };
  if (dist >= line.length) return { index: last, fraction: 1 };
  let low = 0;
  let high = last;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (line.lengths[mid + 1] < dist) low = mid + 1;
    else high = mid;
  }
  const span = line.lengths[low + 1] - line.lengths[low];
  return { index: low, fraction: span > 0 ? (dist - line.lengths[low]) / span : 0 };
}

/** Grobe Vorprüfung: liegt der Punkt höchstens `margin` außerhalb des umschließenden Rechtecks? */
export function nearBounds(line: Polyline, point: Vec2, margin: number): boolean {
  return (
    point.x >= line.minX - margin &&
    point.x <= line.maxX + margin &&
    point.z >= line.minZ - margin &&
    point.z <= line.maxZ + margin
  );
}

export function pointAt(line: Polyline, dist: number): Vec2 {
  const { index, fraction } = locate(line, dist);
  return lerp(line.points[index], line.points[index + 1], fraction);
}

/** Fahrtrichtung der Linie an der Stelle `dist` als Einheitsvektor. */
export function tangentAt(line: Polyline, dist: number): Vec2 {
  const { index } = locate(line, dist);
  return normalize(sub(line.points[index + 1], line.points[index]));
}

/** Kurvenparameter (0..1), der zur Strecke `dist` gehört. */
export function paramAt(line: Polyline, dist: number): number {
  const { index, fraction } = locate(line, dist);
  return (index + fraction) / (line.points.length - 1);
}

export function project(line: Polyline, p: Vec2): Projection {
  let best: Projection = { distance: 0, point: line.points[0], offset: Infinity };
  for (let i = 0; i + 1 < line.points.length; i++) {
    const a = line.points[i];
    const ab = sub(line.points[i + 1], a);
    const lengthSq = dot(ab, ab);
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / lengthSq)) : 0;
    const point = { x: a.x + ab.x * t, z: a.z + ab.z * t };
    const offset = distance(p, point);
    if (offset < best.offset) {
      best = { distance: line.lengths[i] + t * Math.sqrt(lengthSq), point, offset };
    }
  }
  return best;
}

/** Schnittpunkte zweier Linien, sortiert nach der Strecke entlang der ersten. */
export function intersect(a: Polyline, b: Polyline): Crossing[] {
  const crossings: Crossing[] = [];
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) return crossings;

  for (let i = 0; i + 1 < a.points.length; i++) {
    const p = a.points[i];
    const r = sub(a.points[i + 1], p);
    for (let j = 0; j + 1 < b.points.length; j++) {
      const q = b.points[j];
      const s = sub(b.points[j + 1], q);
      const denominator = cross(r, s);
      if (Math.abs(denominator) < EPSILON) continue;
      const offset = sub(q, p);
      const t = cross(offset, s) / denominator;
      const u = cross(offset, r) / denominator;
      if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) continue;

      const along = Math.min(1, Math.max(0, t));
      const distanceA = a.lengths[i] + along * Math.hypot(r.x, r.z);
      // Ein Treffer genau auf einem Abtastpunkt taucht in beiden angrenzenden Teilstücken auf.
      if (crossings.some((c) => Math.abs(c.distanceA - distanceA) < 0.05)) continue;
      crossings.push({
        point: { x: p.x + r.x * along, z: p.z + r.z * along },
        distanceA,
        distanceB: b.lengths[j] + Math.min(1, Math.max(0, u)) * Math.hypot(s.x, s.z),
      });
    }
  }
  return crossings.sort((first, second) => first.distanceA - second.distanceA);
}
