import { BufferGeometry, Float32BufferAttribute, type Color } from 'three';
import { pointAt, type Polyline } from '../sim/roads/geometry';
import { normalize, sub, type Vec2 } from '../util/vec2';

/** Sammelt flache Bänder und Scheiben auf dem Boden zu einer einzigen Geometrie mit Eckpunktfarben. */
export class RibbonBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  /**
   * Band entlang der Linie zwischen den Strecken `from` und `to`.
   * `offset` verschiebt es seitlich (positiv = rechts in Fahrtrichtung).
   */
  strip(
    line: Polyline,
    from: number,
    to: number,
    halfWidth: number,
    y: number,
    color: Color,
    offset = 0,
  ): this {
    if (to - from < 0.01) return this;
    const stops = [from];
    for (const length of line.lengths) {
      if (length > from + 0.01 && length < to - 0.01) stops.push(length);
    }
    stops.push(to);

    const base = this.positions.length / 3;
    for (const stop of stops) {
      const p = pointAt(line, stop);
      const t = smoothDirection(line, stop);
      // (-t.z, t.x) zeigt nach rechts; mit dieser Reihenfolge zeigen die Dreiecke nach oben.
      const outer = offset + halfWidth;
      const inner = offset - halfWidth;
      this.positions.push(p.x - t.z * outer, y, p.z + t.x * outer, p.x - t.z * inner, y, p.z + t.x * inner);
      this.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    for (let i = 0; i + 1 < stops.length; i++) {
      const a = base + i * 2;
      this.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    return this;
  }

  /** Runde Scheibe um einen Punkt. */
  disc(center: Vec2, radius: number, y: number, color: Color, sides = 20): this {
    const base = this.positions.length / 3;
    this.positions.push(center.x, y, center.z);
    this.colors.push(color.r, color.g, color.b);
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      this.positions.push(center.x + Math.cos(angle) * radius, y, center.z + Math.sin(angle) * radius);
      this.colors.push(color.r, color.g, color.b);
    }
    for (let i = 0; i < sides; i++) {
      this.indices.push(base, base + 1 + ((i + 1) % sides), base + 1 + i);
    }
    return this;
  }

  build(): BufferGeometry {
    const normals = new Float32Array(this.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

/** Richtung der Linie, über zwei Meter gemittelt, damit Knicke an Abtastpunkten weich werden. */
function smoothDirection(line: Polyline, dist: number): Vec2 {
  const ahead = pointAt(line, Math.min(line.length, dist + 1));
  const behind = pointAt(line, Math.max(0, dist - 1));
  return normalize(sub(ahead, behind));
}
