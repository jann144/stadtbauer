import { BufferGeometry, CircleGeometry, Color, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { Polyline } from '../sim/roads/geometry';
import type { Vec2 } from '../util/vec2';
import { RibbonBuilder } from './ribbon';

const WHITE = new Color(0xffffff);

/** Halbtransparentes Band über dem Boden, etwa als Bauvorschau oder Markierung einer Straße. */
export class RibbonOverlay {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;

  constructor() {
    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.visible = false;
    // Durchscheinende Ebenen in fester Reihenfolge: Einzugsbereich (1), Bauvorschau (2), Punkte und Pinsel (3).
    this.mesh.renderOrder = 2;
  }

  show(line: Polyline, halfWidth: number, color: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new RibbonBuilder().strip(line, 0, line.length, halfWidth, 0.3, WHITE).build();
    this.mesh.material.color.set(color);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

/** Färbt Straßenabschnitte ein, etwa den Einzugsbereich eines Dienstes. */
export class StretchOverlay {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;

  constructor(color: number) {
    const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false });
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }

  /** Zeigt die Abschnitte als Bänder in halber Straßenbreite `halfWidth`. */
  show(stretches: readonly { line: Polyline; from: number; to: number }[], halfWidth: number): void {
    const builder = new RibbonBuilder();
    for (const stretch of stretches) builder.strip(stretch.line, stretch.from, stretch.to, halfWidth, 0.26, WHITE);
    this.mesh.geometry.dispose();
    this.mesh.geometry = builder.build();
    this.mesh.visible = stretches.length > 0;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

/** Färbt Straßen und Kreuzungen deckend in verschiedenen Farben ein, etwa nach ihrer Auslastung. */
export class HeatOverlay {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;

  constructor() {
    // Deckend, damit sich überlappende Stücke an Knoten nicht dunkler mischen.
    this.mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true }));
    this.mesh.visible = false;
  }

  /** `roads`: Abschnitte von `from` bis `to` Metern; `junctions`: Scheiben über den Kreuzungsflächen. */
  show(
    roads: readonly { line: Polyline; from: number; to: number; halfWidth: number; color: Color }[],
    junctions: readonly { center: Vec2; radius: number; color: Color }[],
  ): void {
    const builder = new RibbonBuilder();
    for (const road of roads) builder.strip(road.line, road.from, road.to, road.halfWidth, 0.24, road.color);
    for (const junction of junctions) builder.disc(junction.center, junction.radius, 0.25, junction.color);
    this.mesh.geometry.dispose();
    this.mesh.geometry = builder.build();
    this.mesh.visible = roads.length > 0;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

/** Ring auf dem Boden, der die Größe eines Pinsels zeigt. */
export class BrushRing {
  readonly mesh: Mesh;

  constructor() {
    const material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.mesh = new Mesh(new RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
  }

  show(center: Vec2, radius: number): void {
    this.mesh.position.set(center.x, 0.4, center.z);
    this.mesh.scale.set(radius, 1, radius);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

/** Kleine Scheiben, die gesetzte Punkte eines Werkzeugs zeigen. */
export class PointMarkers {
  readonly group = new Group();
  private readonly geometry = new CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private readonly material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });

  /** Zeigt Scheiben an den gegebenen Punkten; `radius` in Metern. */
  set(points: readonly Vec2[], radius: number): void {
    while (this.group.children.length < points.length) {
      const mesh = new Mesh(this.geometry, this.material);
      mesh.renderOrder = 3;
      this.group.add(mesh);
    }
    this.group.children.forEach((mesh, i) => {
      const point = points[i];
      mesh.visible = point !== undefined;
      if (point) mesh.position.set(point.x, 0.4, point.z);
    });
    this.resize(radius);
  }

  /** Passt die Größe der Scheiben an, etwa damit sie beim Zoomen gleich groß erscheinen. */
  resize(radius: number): void {
    for (const mesh of this.group.children) mesh.scale.set(radius, 1, radius);
  }
}
