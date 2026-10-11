import type { Vec2 } from '../util/vec2';

/** Ein Bauwerkzeug. Es kennt nur Bodenpunkte, keine Bildschirmkoordinaten und keine Grafik. */
export interface Tool {
  /** Antippen oder Klick auf den Boden. */
  tap(ground: Vec2, pointerType: string): void;
  /** Mauszeiger über dem Boden; null, wenn er die Karte verlässt. */
  hover(ground: Vec2 | null): void;
  /**
   * Ziehen mit linker Taste oder einem Finger, vom letzten gemeldeten Bodenpunkt zum aktuellen.
   * Fehlt die Methode, verschiebt Ziehen die Karte.
   */
  drag?(from: Vec2, to: Vec2): void;
  /** Das Ziehen ist zu Ende; `interrupted`, wenn es abgebrochen statt losgelassen wurde. */
  dragEnd?(interrupted: boolean): void;
  confirm(): void;
  cancel(): void;
}

export interface ToolEnvironment {
  /** Fangradius in Metern, passend zur aktuellen Zoomstufe. */
  snapRadius(): number;
  /** Der sichtbare Zustand des Werkzeugs hat sich geändert. */
  changed(): void;
  /** Das Werkzeug hat die Spielwelt verändert. */
  worldChanged(): void;
}
