/** Punkt oder Richtung auf dem Boden; die Höhe (y) fehlt bewusst. */
export interface Vec2 {
  x: number;
  z: number;
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.z - a.z * b.x;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Einheitsvektor in Richtung von `a`; der Nullvektor bleibt null. */
export function normalize(a: Vec2): Vec2 {
  const length = Math.hypot(a.x, a.z);
  return length > 0 ? { x: a.x / length, z: a.z / length } : { x: 0, z: 0 };
}
