import type { CameraRig } from '../render/cameraRig';
import type { Vec2 } from '../util/vec2';
import type { DragInfo, PinchInfo, Point } from './pointer';

/** Drehung und Neigung in Bogenmaß pro gezogenem Pixel. */
const ORBIT_PER_PIXEL = 0.005;
const WHEEL_ZOOM = 0.0015;
const PINCH_WHEEL_ZOOM = 0.01;
/** Tastatur: Verschieben als Anteil des Kameraabstands pro Sekunde, Drehen in Bogenmaß pro Sekunde. */
const KEY_PAN_PER_SECOND = 1.1;
const KEY_TURN_PER_SECOND = 1.6;
/** Strecke in Pixeln, nach der feststeht, was eine Zwei-Finger-Geste bedeutet. */
const PINCH_DECIDE = 10;

type PinchMode = 'undecided' | 'tilt' | 'transform';

/** Übersetzt Zeiger- und Tastatureingaben in Kamerabewegungen. */
export class CameraController {
  private readonly keys = new Set<string>();
  private pinchMode: PinchMode = 'undecided';
  private allowTilt = true;

  constructor(
    private readonly rig: CameraRig,
    private readonly element: HTMLElement,
  ) {
    // `code` statt `key`, damit die Belegung auf deutscher Tastatur dieselbe ist.
    window.addEventListener('keydown', (e) => {
      // In einem Eingabefeld (etwa einem Regler) steuern die Pfeiltasten das Feld, nicht die Karte.
      if (e.target instanceof HTMLInputElement) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Bodenpunkt unter einer Position in CSS-Pixeln, oder null oberhalb des Horizonts. */
  groundAt(x: number, y: number): Vec2 | null {
    const hit = this.rig.groundAt(this.ndcX(x), this.ndcY(y));
    return hit && { x: hit.x, z: hit.z };
  }

  metersPerPixel(): number {
    return this.rig.metersPerPixel(this.element.clientHeight);
  }

  /** Linke/rechte Taste oder ein Finger verschieben die Karte, die mittlere Taste dreht und neigt. */
  drag(d: DragInfo): void {
    if (d.button === 1) {
      this.rig.orbit(-(d.x - d.prevX) * ORBIT_PER_PIXEL, (d.y - d.prevY) * ORBIT_PER_PIXEL);
    } else {
      this.rig.panGrab(this.ndcX(d.prevX), this.ndcY(d.prevY), this.ndcX(d.x), this.ndcY(d.y));
    }
  }

  /** Mausrad oder Trackpad; die Spreizgeste (`pinch`) meldet viel kleinere Werte und zählt daher stärker. */
  wheel(x: number, y: number, delta: number, pinch = false): void {
    this.rig.zoomAt(this.ndcX(x), this.ndcY(y), Math.exp(-delta * (pinch ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM)));
  }

  /**
   * Beginn einer Zwei-Finger-Geste. Ohne `allowTilt` verschiebt auch gemeinsames senkrechtes Ziehen
   * die Karte; nötig bei Werkzeugen, bei denen ein Finger malt statt zu verschieben.
   */
  pinchStart(allowTilt = true): void {
    this.pinchMode = 'undecided';
    this.allowTilt = allowTilt;
  }

  /** Zwei Finger: gemeinsam senkrecht ziehen neigt, alles andere zoomt, dreht und verschiebt. */
  pinch(p: PinchInfo): void {
    if (this.pinchMode === 'undecided') this.pinchMode = decidePinchMode(p);
    if (this.pinchMode === 'tilt' && !this.allowTilt) this.pinchMode = 'transform';
    if (this.pinchMode === 'undecided') return;

    if (this.pinchMode === 'tilt') {
      const dy = (p.a.y - p.prevA.y + (p.b.y - p.prevB.y)) / 2;
      this.rig.orbit(0, dy * ORBIT_PER_PIXEL);
      return;
    }

    const prevMid = middle(p.prevA, p.prevB);
    const mid = middle(p.a, p.b);
    const midX = this.ndcX(mid.x);
    const midY = this.ndcY(mid.y);
    this.rig.panGrab(this.ndcX(prevMid.x), this.ndcY(prevMid.y), midX, midY);

    const prevSpan = Math.hypot(p.prevB.x - p.prevA.x, p.prevB.y - p.prevA.y);
    const span = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
    if (prevSpan > 0 && span > 0) this.rig.zoomAt(midX, midY, span / prevSpan);

    const prevAngle = Math.atan2(p.prevB.y - p.prevA.y, p.prevB.x - p.prevA.x);
    const angle = Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x);
    this.rig.twistAt(midX, midY, wrapAngle(angle - prevAngle));
  }

  /** Tastatur: WASD/Pfeile verschieben, Q/E drehen. */
  update(dt: number): void {
    const right = this.axis('KeyD', 'ArrowRight') - this.axis('KeyA', 'ArrowLeft');
    const forward = this.axis('KeyW', 'ArrowUp') - this.axis('KeyS', 'ArrowDown');
    if (right !== 0 || forward !== 0) {
      const step = this.rig.distance * KEY_PAN_PER_SECOND * dt;
      this.rig.panBy(right * step, forward * step);
    }
    const turn = this.axis('KeyE') - this.axis('KeyQ');
    if (turn !== 0) this.rig.orbit(turn * KEY_TURN_PER_SECOND * dt, 0);
  }

  private axis(...codes: string[]): number {
    return codes.some((code) => this.keys.has(code)) ? 1 : 0;
  }

  private ndcX(x: number): number {
    return (x / this.element.clientWidth) * 2 - 1;
  }

  private ndcY(y: number): number {
    return 1 - (y / this.element.clientHeight) * 2;
  }
}

function decidePinchMode(p: PinchInfo): PinchMode {
  const ax = p.a.x - p.startA.x;
  const ay = p.a.y - p.startA.y;
  const bx = p.b.x - p.startB.x;
  const by = p.b.y - p.startB.y;
  const aMoved = Math.hypot(ax, ay);
  const bMoved = Math.hypot(bx, by);
  const most = Math.max(aMoved, bMoved);
  const least = Math.min(aMoved, bMoved);

  if (most >= PINCH_DECIDE && least >= PINCH_DECIDE / 2) {
    const bothVertical = Math.abs(ay) > 2 * Math.abs(ax) && Math.abs(by) > 2 * Math.abs(bx);
    return bothVertical && ay * by > 0 ? 'tilt' : 'transform';
  }
  // Ein Finger ruht, der andere bewegt sich deutlich: Zoomen oder Drehen um den ruhenden Finger.
  return most >= PINCH_DECIDE * 2 ? 'transform' : 'undecided';
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function wrapAngle(angle: number): number {
  if (angle > Math.PI) return angle - 2 * Math.PI;
  if (angle < -Math.PI) return angle + 2 * Math.PI;
  return angle;
}
