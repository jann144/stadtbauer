import { InstancedMesh, type BufferGeometry, type Color, type Group, type Material, type Matrix4 } from 'three';

/** Viele Kopien derselben Form mit eigener Lage und Farbe; wächst bei Bedarf mit. */
export class Instances {
  private mesh: InstancedMesh;
  private used = 0;

  constructor(
    private readonly parent: Group,
    private readonly geometry: BufferGeometry,
    private readonly material: Material,
  ) {
    this.mesh = this.create(256);
  }

  /** Beginnt eine neue Füllung mit Platz für mindestens `count` Kopien. */
  begin(count: number): void {
    let capacity = this.mesh.instanceMatrix.count;
    if (count > capacity) {
      while (capacity < count) capacity *= 2;
      this.parent.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.create(capacity);
    }
    this.used = 0;
  }

  add(matrix: Matrix4, color: Color): void {
    this.mesh.setMatrixAt(this.used, matrix);
    this.mesh.setColorAt(this.used, color);
    this.used++;
  }

  end(): void {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private create(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.count = 0;
    // Die Kopien ändern sich laufend; eine feste Hüllkugel würde sie fälschlich ausblenden.
    mesh.frustumCulled = false;
    this.parent.add(mesh);
    return mesh;
  }
}
