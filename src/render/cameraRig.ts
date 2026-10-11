import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { CAMERA, WORLD } from '../config/settings';

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

/** Blick der Kamera als einfache Daten, etwa für den Spielstand. */
export interface CameraPose {
  /** Zielpunkt auf dem Boden. */
  x: number;
  z: number;
  distance: number;
  yaw: number;
  pitch: number;
}

/**
 * Kamera, die um einen Zielpunkt auf dem Boden kreist.
 * Bildschirmpositionen sind normalisiert: x und y jeweils von -1 bis 1, y zeigt nach oben.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(CAMERA.fov, 1, 1, 12000);
  readonly target = new Vector3();
  yaw = CAMERA.startYaw;
  pitch = CAMERA.startPitch;
  distance = CAMERA.startDistance;

  private readonly raycaster = new Raycaster();
  private readonly screen = new Vector2();
  private readonly before = new Vector3();
  private readonly after = new Vector3();

  constructor() {
    this.apply();
  }

  get pose(): CameraPose {
    return { x: this.target.x, z: this.target.z, distance: this.distance, yaw: this.yaw, pitch: this.pitch };
  }

  /** Stellt einen früheren Blick wieder her; Werte außerhalb der Grenzen werden eingefangen. */
  setPose(pose: CameraPose): void {
    this.target.set(pose.x, 0, pose.z);
    this.distance = MathUtils.clamp(pose.distance, CAMERA.minDistance, CAMERA.maxDistance);
    this.yaw = pose.yaw;
    this.pitch = MathUtils.clamp(pose.pitch, CAMERA.minPitch, CAMERA.maxPitch);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Bodenpunkt unter einer Bildschirmposition, oder null, wenn der Strahl den Boden verfehlt. */
  groundAt(x: number, y: number, out = new Vector3()): Vector3 | null {
    this.screen.set(x, y);
    this.raycaster.setFromCamera(this.screen, this.camera);
    return this.raycaster.ray.intersectPlane(GROUND, out);
  }

  /** Meter am Zielpunkt, die einem Bildschirmpixel entsprechen. */
  metersPerPixel(viewportHeight: number): number {
    return (2 * this.distance * Math.tan(MathUtils.degToRad(CAMERA.fov) / 2)) / viewportHeight;
  }

  /** Verschiebt die Karte so, dass der Bodenpunkt unter (fromX, fromY) nach (toX, toY) wandert. */
  panGrab(fromX: number, fromY: number, toX: number, toY: number): void {
    const from = this.groundAt(fromX, fromY, this.before);
    const to = this.groundAt(toX, toY, this.after);
    if (!from || !to) return;
    const dx = from.x - to.x;
    const dz = from.z - to.z;
    // Nahe am Horizont liegen Bodenpunkte weit auseinander; ohne Grenze würde die Karte springen.
    const length = Math.hypot(dx, dz);
    const scale = length > this.distance ? this.distance / length : 1;
    this.target.x += dx * scale;
    this.target.z += dz * scale;
    this.apply();
  }

  /** Verschiebt den Zielpunkt relativ zur Blickrichtung (für die Tastatur). */
  panBy(right: number, forward: number): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.target.x += right * cos - forward * sin;
    this.target.z += -right * sin - forward * cos;
    this.apply();
  }

  /** Zoomt um `factor` (größer als 1 = näher heran) und hält den Bodenpunkt unter (x, y) fest. */
  zoomAt(x: number, y: number, factor: number): void {
    this.pinned(x, y, () => {
      this.distance = MathUtils.clamp(this.distance / factor, CAMERA.minDistance, CAMERA.maxDistance);
    });
  }

  /** Dreht die Karte um den Bodenpunkt unter (x, y); positiv = im Uhrzeigersinn auf dem Bildschirm. */
  twistAt(x: number, y: number, angle: number): void {
    this.pinned(x, y, () => {
      this.yaw += angle;
    });
  }

  /** Dreht und neigt die Kamera um den Zielpunkt. */
  orbit(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    this.pitch = MathUtils.clamp(this.pitch + deltaPitch, CAMERA.minPitch, CAMERA.maxPitch);
    this.apply();
  }

  private pinned(x: number, y: number, change: () => void): void {
    const before = this.groundAt(x, y, this.before);
    change();
    this.apply();
    const after = this.groundAt(x, y, this.after);
    if (!before || !after) return;
    this.target.x += before.x - after.x;
    this.target.z += before.z - after.z;
    this.apply();
  }

  private apply(): void {
    const half = WORLD.size / 2;
    this.target.x = MathUtils.clamp(this.target.x, -half, half);
    this.target.z = MathUtils.clamp(this.target.z, -half, half);

    const flat = this.distance * Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + flat * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch),
      this.target.z + flat * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);

    // Nahe Schnittebene wächst mit dem Abstand; das hält die Tiefenauflösung in der Ferne hoch.
    this.camera.near = Math.max(1, this.distance * 0.02);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
