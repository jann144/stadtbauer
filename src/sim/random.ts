import type { World } from './world';

/** Zufallswert in [0, 1); der Zustand liegt in der Welt, damit Spielstände gleich weiterlaufen. */
export function nextRandom(world: World): number {
  world.rng = (world.rng + 0x6d2b79f5) >>> 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
