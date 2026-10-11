import { BoxGeometry, Color, Group, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { TRAFFIC } from '../config/traffic';
import type { Car } from '../sim/traffic/traffic';
import { Instances } from './instances';

const UP = new Vector3(0, 1, 0);
const PAINT = [0xd9534f, 0x3a7bd5, 0xf2f2ee, 0x2f3640, 0xf0b93a, 0x4caf7d, 0x9aa3ab, 0x7b5ea7].map((hex) => new Color(hex));
const GLASS = new Color(0x26303a);
const BODY = new Vector3(TRAFFIC.carLength, 1, 1.9);
const CABIN = new Vector3(TRAFFIC.carLength * 0.5, 0.75, 1.7);

/** Zeichnet alle Autos als zwei Quader (Karosserie und Aufbau) und blendet zwischen den Simulationsschritten über. */
export class CarView {
  readonly group = new Group();
  private readonly bodies: Instances;
  private readonly cabins: Instances;

  constructor() {
    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.bodies = new Instances(this.group, box, new MeshLambertMaterial());
    this.cabins = new Instances(this.group, box, new MeshLambertMaterial());
  }

  /** `blend` von 0 (Lage im vorigen Schritt) bis 1 (jetzige Lage). */
  sync(cars: readonly Car[], blend: number): void {
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    this.bodies.begin(cars.length);
    this.cabins.begin(cars.length);
    for (const car of cars) {
      // Den kürzeren Weg um den Kreis drehen, sonst wirbelt das Auto beim Sprung von +180° auf -180° herum.
      const swing = Math.atan2(Math.sin(car.angle - car.pangle), Math.cos(car.angle - car.pangle));
      const angle = car.pangle + swing * blend;
      const x = car.px + (car.x - car.px) * blend;
      const z = car.pz + (car.z - car.pz) * blend;
      rotation.setFromAxisAngle(UP, -angle);
      matrix.compose(position.set(x, 0.45, z), rotation, BODY);
      this.bodies.add(matrix, PAINT[car.id % PAINT.length]);
      // Der Aufbau sitzt etwas hinter der Mitte.
      matrix.compose(position.set(x - Math.cos(angle) * 0.35, 1.45, z - Math.sin(angle) * 0.35), rotation, CABIN);
      this.cabins.add(matrix, GLASS);
    }
    this.bodies.end();
    this.cabins.end();
  }
}
