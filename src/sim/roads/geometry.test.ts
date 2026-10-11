import { describe, expect, it } from 'vitest';
import {
  bezierPoint,
  curvatureAt,
  intersect,
  minRadius,
  paramAt,
  pointAt,
  project,
  samplePath,
  subControl,
  tangentAt,
} from './geometry';

const A = { x: -60, z: -30 };
const C = { x: 0, z: 60 };
const B = { x: 60, z: -30 };

describe('Straßengeometrie', () => {
  it('misst eine Gerade exakt', () => {
    const line = samplePath({ x: 0, z: 0 }, { x: 30, z: 40 });
    expect(line.length).toBeCloseTo(50, 9);
    expect(pointAt(line, 25)).toEqual({ x: 15, z: 20 });
    expect(paramAt(line, 25)).toBeCloseTo(0.5, 9);
    expect(tangentAt(line, 10).x).toBeCloseTo(0.6, 9);
  });

  it('tastet eine Kurve von Anfang bis Ende ab', () => {
    const curve = samplePath(A, B, C);
    expect(curve.points[0]).toEqual(A);
    expect(curve.points[curve.points.length - 1]).toEqual(B);
    // Länger als die Sehne, kürzer als der Weg über den Kontrollpunkt.
    expect(curve.length).toBeGreaterThan(120);
    expect(curve.length).toBeLessThan(2 * Math.hypot(60, 90));
  });

  it('findet den Kurvenparameter zu einer Strecke', () => {
    const curve = samplePath(A, B, C);
    const t = paramAt(curve, curve.length / 2);
    // Die Kurve ist symmetrisch, die halbe Strecke liegt also bei t = 0,5.
    expect(t).toBeCloseTo(0.5, 6);
    const exact = bezierPoint(A, C, B, t);
    const sampled = pointAt(curve, curve.length / 2);
    expect(sampled.x).toBeCloseTo(exact.x, 1);
    expect(sampled.z).toBeCloseTo(exact.z, 1);
  });

  it('berechnet den Kontrollpunkt eines Teilstücks', () => {
    const t0 = 0.2;
    const t1 = 0.7;
    const start = bezierPoint(A, C, B, t0);
    const end = bezierPoint(A, C, B, t1);
    const control = subControl(A, C, B, t0, t1);
    for (const s of [0.25, 0.5, 0.75]) {
      const part = bezierPoint(start, control, end, s);
      const whole = bezierPoint(A, C, B, t0 + s * (t1 - t0));
      expect(part.x).toBeCloseTo(whole.x, 9);
      expect(part.z).toBeCloseTo(whole.z, 9);
    }
  });

  it('bestimmt den kleinsten Kurvenradius', () => {
    expect(minRadius(A, C, B)).toBeCloseTo(40, 6);
    expect(minRadius({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 })).toBe(Infinity);
    // Kontrollpunkt hinter dem Ende: die Kurve läuft auf sich selbst zurück.
    expect(minRadius({ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 20, z: 0 })).toBe(0);
    // Fast zurücklaufend: die engste Stelle ist winzig und liegt zwischen den Abtastpunkten.
    expect(minRadius({ x: 0, z: 0 }, { x: 300, z: 0 }, { x: -50, z: 0.05 })).toBeLessThan(0.01);
  });

  it('gibt die Krümmung mit Vorzeichen an', () => {
    // Am Scheitel des Bogens beträgt der Radius 40 m; der Bogen biegt nach links, also negativ.
    expect(curvatureAt(A, C, B, 0.5)).toBeCloseTo(-1 / 40, 9);
    expect(curvatureAt(B, C, A, 0.5)).toBeCloseTo(1 / 40, 9);
  });

  it('projiziert einen Punkt auf die Linie', () => {
    const line = samplePath({ x: 0, z: 0 }, { x: 100, z: 0 });
    const hit = project(line, { x: 40, z: 7 });
    expect(hit.distance).toBeCloseTo(40, 9);
    expect(hit.offset).toBeCloseTo(7, 9);
    expect(project(line, { x: -20, z: 0 }).distance).toBe(0);
  });

  it('schneidet zwei Geraden', () => {
    const first = samplePath({ x: -50, z: 0 }, { x: 50, z: 0 });
    const second = samplePath({ x: 10, z: -20 }, { x: 10, z: 80 });
    const hits = intersect(first, second);
    expect(hits).toHaveLength(1);
    expect(hits[0].point.x).toBeCloseTo(10, 9);
    expect(hits[0].distanceA).toBeCloseTo(60, 9);
    expect(hits[0].distanceB).toBeCloseTo(20, 9);
  });

  it('findet beide Schnittpunkte eines Bogens mit einer Geraden', () => {
    const line = samplePath({ x: -100, z: 0 }, { x: 100, z: 0 });
    const hits = intersect(samplePath(A, B, C), line);
    expect(hits).toHaveLength(2);
    expect(hits[0].point.x).toBeCloseTo(-34.64, 0);
    expect(hits[1].point.x).toBeCloseTo(34.64, 0);
    expect(hits[0].distanceA).toBeLessThan(hits[1].distanceA);
  });

  it('meldet Berührungen an einem Abtastpunkt nur einmal', () => {
    // Kurzer Bogen mit gerader Anzahl Teilstücke: der Scheitel (0/5) ist ein Abtastpunkt.
    const curve = samplePath({ x: -10, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 10 });
    expect(curve.points).toContainEqual({ x: 0, z: 5 });
    const hits = intersect(curve, samplePath({ x: 0, z: -20 }, { x: 0, z: 20 }));
    expect(hits).toHaveLength(1);
    expect(hits[0].point.z).toBeCloseTo(5, 9);
  });

  it('findet keine Schnittpunkte bei parallelen oder entfernten Linien', () => {
    const first = samplePath({ x: 0, z: 0 }, { x: 100, z: 0 });
    expect(intersect(first, samplePath({ x: 0, z: 5 }, { x: 100, z: 5 }))).toHaveLength(0);
    expect(intersect(first, samplePath({ x: 200, z: -10 }, { x: 200, z: 10 }))).toHaveLength(0);
  });
});
