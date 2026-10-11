import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { GRAPHICS, WORLD } from '../config/settings';
import { nearBounds, project, type Polyline } from '../sim/roads/geometry';
import { createRandom } from '../util/random';
import type { Vec2 } from '../util/vec2';

const UP = new Vector3(0, 1, 0);
/** Auf null geschrumpft: so verschwindet eine einzelne Instanz, ohne die anderen umzusortieren. */
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

/** Boden: bebaubare Karte, dunkleres Umland und eine Linie an der Kartengrenze. */
export function createGround(maxAnisotropy: number): Group {
  const random = createRandom(7);
  const half = WORLD.size / 2;
  const group = new Group();

  // Sanfte Farbflecken über Eckpunktfarben, feine Körnung über die Textur.
  const field = new PlaneGeometry(WORLD.size, WORLD.size, 80, 80);
  field.rotateX(-Math.PI / 2);
  const vertexCount = field.getAttribute('position').count;
  const colors = new Float32Array(vertexCount * 3);
  const color = new Color();
  for (let i = 0; i < vertexCount; i++) {
    color.setHSL(0.26 + random() * 0.03, 0.4, 0.37 + random() * 0.05, SRGBColorSpace);
    color.toArray(colors, i * 3);
  }
  field.setAttribute('color', new BufferAttribute(colors, 3));
  group.add(
    new Mesh(
      field,
      new MeshLambertMaterial({ vertexColors: true, map: grainTexture(random, maxAnisotropy) }),
    ),
  );

  // Umland als Fläche mit Loch, damit es sich nicht mit der Karte überdeckt.
  const far = WORLD.size * 6;
  const outline = new Shape();
  outline.moveTo(-far, -far).lineTo(far, -far).lineTo(far, far).lineTo(-far, far).closePath();
  const hole = new Path();
  hole.moveTo(-half, -half).lineTo(-half, half).lineTo(half, half).lineTo(half, -half).closePath();
  outline.holes.push(hole);
  const surround = new ShapeGeometry(outline);
  surround.rotateX(-Math.PI / 2);
  group.add(new Mesh(surround, new MeshLambertMaterial({ color: 0x55793f })));

  const border = new BufferGeometry().setFromPoints([
    new Vector3(-half, 0.2, -half),
    new Vector3(half, 0.2, -half),
    new Vector3(half, 0.2, half),
    new Vector3(-half, 0.2, half),
  ]);
  group.add(
    new LineLoop(border, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })),
  );

  return group;
}

function grainTexture(random: () => number, maxAnisotropy: number): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const shade = 212 + Math.floor(random() * 44);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(Math.floor(random() * size), Math.floor(random() * size), 2, 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  // Eine Kachel deckt 32 m ab.
  texture.repeat.set(WORLD.size / 32, WORLD.size / 32);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/** Bäume in losen Gruppen über die Karte verteilt, als zwei instanzierte Meshes. */
export class Trees {
  readonly group = new Group();
  private readonly trunks: InstancedMesh;
  private readonly crowns: InstancedMesh;
  /** Standort jedes Baums; gefällte Bäume sind null. */
  private readonly spots: (Vec2 | null)[] = [];

  constructor() {
    const random = createRandom(11);
    const half = WORLD.size / 2;
    const count = GRAPHICS.treeCount;

    const trunkGeometry = new CylinderGeometry(0.35, 0.45, 3, 5);
    trunkGeometry.translate(0, 1.5, 0);
    const crownGeometry = new ConeGeometry(2.6, 7.5, 6);
    crownGeometry.translate(0, 6, 0);
    this.trunks = new InstancedMesh(trunkGeometry, new MeshLambertMaterial({ color: 0x6b4a2f }), count);
    this.crowns = new InstancedMesh(crownGeometry, new MeshLambertMaterial(), count);

    const groves: { x: number; z: number; radius: number }[] = [];
    for (let i = 0; i < 70; i++) {
      groves.push({
        x: (random() - 0.5) * WORLD.size,
        z: (random() - 0.5) * WORLD.size,
        radius: 30 + random() * 90,
      });
    }

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const color = new Color();
    for (let i = 0; i < count; i++) {
      const grove = groves[Math.floor(random() * groves.length)];
      const angle = random() * Math.PI * 2;
      // Zwei Zufallswerte multipliziert: dichter in der Mitte der Gruppe.
      const reach = grove.radius * random() * random() * 2;
      position.set(
        Math.max(-half, Math.min(half, grove.x + Math.cos(angle) * reach)),
        0,
        Math.max(-half, Math.min(half, grove.z + Math.sin(angle) * reach)),
      );
      this.spots.push({ x: position.x, z: position.z });
      rotation.setFromAxisAngle(UP, random() * Math.PI * 2);
      scale.setScalar(0.7 + random() * 0.7);
      matrix.compose(position, rotation, scale);
      this.trunks.setMatrixAt(i, matrix);
      this.crowns.setMatrixAt(i, matrix);
      color.setHSL(0.28 + random() * 0.07, 0.45, 0.24 + random() * 0.09, SRGBColorSpace);
      this.crowns.setColorAt(i, color);
    }
    this.trunks.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
    if (this.crowns.instanceColor) this.crowns.instanceColor.needsUpdate = true;
    this.group.add(this.trunks, this.crowns);
  }

  /** Fällt alle Bäume, die näher als `radius` Meter an der Linie stehen. */
  clearAlong(line: Polyline, radius: number): void {
    this.fell((spot) => nearBounds(line, spot, radius) && project(line, spot).offset <= radius);
  }

  /** Fällt alle Bäume, die näher als `radius` Meter am Punkt stehen. */
  clearAround(center: Vec2, radius: number): void {
    this.fell((spot) => Math.hypot(spot.x - center.x, spot.z - center.z) <= radius);
  }

  private fell(isInTheWay: (spot: Vec2) => boolean): void {
    let felled = false;
    for (let i = 0; i < this.spots.length; i++) {
      const spot = this.spots[i];
      if (!spot || !isInTheWay(spot)) continue;
      this.spots[i] = null;
      this.trunks.setMatrixAt(i, HIDDEN);
      this.crowns.setMatrixAt(i, HIDDEN);
      felled = true;
    }
    if (!felled) return;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
  }
}
