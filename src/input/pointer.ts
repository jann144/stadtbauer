export interface Point {
  x: number;
  y: number;
}

/** Ziehen mit einem Zeiger. Positionen in CSS-Pixeln relativ zum Element. */
export interface DragInfo {
  prevX: number;
  prevY: number;
  x: number;
  y: number;
  /** 0 = linke Taste oder Finger, 1 = mittlere, 2 = rechte Taste. */
  button: number;
  pointerType: string;
}

/** Bewegung zweier Finger: Position vorher, nachher und beim Beginn der Geste. */
export interface PinchInfo {
  prevA: Point;
  prevB: Point;
  a: Point;
  b: Point;
  startA: Point;
  startB: Point;
}

export interface PointerHandlers {
  /** Antippen oder Klick mit der linken Taste, ohne zu ziehen. */
  onTap?(x: number, y: number, pointerType: string): void;
  /** Klick mit der rechten Taste, ohne zu ziehen. */
  onSecondaryTap?(): void;
  /** Mausbewegung ohne gedrückte Taste. */
  onHover?(x: number, y: number): void;
  /** Der Mauszeiger hat das Element verlassen. */
  onHoverEnd?(): void;
  onDrag?(drag: DragInfo): void;
  /**
   * Ein begonnenes Ziehen ist zu Ende. `interrupted`: nicht losgelassen, sondern vom System abgebrochen
   * oder von einem zweiten Finger abgelöst; was das Ziehen bewirkt hat, war dann nicht gewollt.
   */
  onDragEnd?(interrupted: boolean): void;
  /** Ein zweiter Finger wurde aufgesetzt. */
  onPinchStart?(): void;
  onPinch?(pinch: PinchInfo): void;
  /** Mausrad; `delta` in Pixeln, positiv = nach unten. `pinch`: Spreizgeste auf dem Trackpad. */
  onWheel?(x: number, y: number, delta: number, pinch: boolean): void;
}

interface Tracked extends Point {
  startX: number;
  startY: number;
  button: number;
}

/** Ab dieser Strecke gilt eine Berührung als Ziehen statt als Antippen. */
const DRAG_THRESHOLD_MOUSE = 4;
const DRAG_THRESHOLD_TOUCH = 10;

/** Fasst Maus-, Stift- und Touch-Eingaben eines Elements zu einfachen Gesten zusammen. */
export class PointerInput {
  private readonly pointers = new Map<number, Tracked>();
  private dragging = false;
  /** Seit dem ersten Aufsetzen waren mehrere Finger beteiligt. */
  private multi = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: PointerHandlers,
  ) {
    element.addEventListener('pointerdown', this.down);
    element.addEventListener('pointermove', this.move);
    element.addEventListener('pointerup', this.up);
    element.addEventListener('pointercancel', this.cancel);
    element.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.has(e.pointerId)) this.handlers.onHoverEnd?.();
    });
    element.addEventListener('wheel', this.wheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari würde sonst bei zwei Fingern die ganze Seite zoomen.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  private local(e: MouseEvent): Point {
    const rect = this.element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly down = (e: PointerEvent): void => {
    e.preventDefault();
    // Weil die Standardaktion entfällt, behielte eine zuvor angeklickte Schaltfläche den Fokus
    // und würde auf die Eingabetaste reagieren, die eigentlich dem Werkzeug gilt.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.element.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, startX: p.x, startY: p.y, button: e.button });

    if (this.pointers.size === 1) {
      this.dragging = false;
      this.multi = false;
      return;
    }
    this.multi = true;
    this.endDrag(true);
    if (this.pointers.size === 2) {
      for (const t of this.pointers.values()) {
        t.startX = t.x;
        t.startY = t.y;
      }
      this.handlers.onPinchStart?.();
    }
  };

  private readonly move = (e: PointerEvent): void => {
    const p = this.local(e);
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) {
      if (e.pointerType === 'mouse') this.handlers.onHover?.(p.x, p.y);
      return;
    }
    const prev = { x: tracked.x, y: tracked.y };
    tracked.x = p.x;
    tracked.y = p.y;

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [Tracked, Tracked];
      this.handlers.onPinch?.({
        prevA: a === tracked ? prev : { x: a.x, y: a.y },
        prevB: b === tracked ? prev : { x: b.x, y: b.y },
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        startA: { x: a.startX, y: a.startY },
        startB: { x: b.startX, y: b.startY },
      });
      return;
    }
    // Nach einer Zwei-Finger-Geste nicht mit dem verbliebenen Finger weiterziehen.
    if (this.pointers.size !== 1 || this.multi) return;

    if (!this.dragging) {
      const threshold = e.pointerType === 'mouse' ? DRAG_THRESHOLD_MOUSE : DRAG_THRESHOLD_TOUCH;
      if (Math.hypot(p.x - tracked.startX, p.y - tracked.startY) < threshold) return;
      this.dragging = true;
      // Vom Startpunkt aus ziehen, damit der gegriffene Punkt unter dem Zeiger bleibt.
      prev.x = tracked.startX;
      prev.y = tracked.startY;
    }
    this.handlers.onDrag?.({
      prevX: prev.x,
      prevY: prev.y,
      x: p.x,
      y: p.y,
      button: tracked.button,
      pointerType: e.pointerType,
    });
  };

  private readonly up = (e: PointerEvent): void => {
    const tracked = this.pointers.get(e.pointerId);
    if (!tracked) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    if (!this.dragging && !this.multi) {
      if (tracked.button === 0) this.handlers.onTap?.(tracked.x, tracked.y, e.pointerType);
      else if (tracked.button === 2) this.handlers.onSecondaryTap?.();
    }
    this.endDrag(false);
  };

  private readonly cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.endDrag(true);
  };

  private endDrag(interrupted: boolean): void {
    if (this.dragging) this.handlers.onDragEnd?.(interrupted);
    this.dragging = false;
  }

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const p = this.local(e);
    // Browser melden die Spreizgeste auf dem Trackpad als Mausrad mit gedrückter Strg-Taste.
    this.handlers.onWheel?.(p.x, p.y, e.deltaY * unit, e.ctrlKey);
  };
}
