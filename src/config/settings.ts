/**
 * Grundeinstellungen für Karte, Zeit, Kamera und Grafik.
 * Werte hier ändern, um das Spiel anzupassen.
 */

export const WORLD = {
  /** Kantenlänge der bebaubaren Karte in Metern. */
  size: 2000,
  /** Kantenlänge einer Zonenzelle in Metern. */
  cellSize: 8,
};

export const TIME = {
  /** Simulationsschritte pro Sekunde bei einfacher Geschwindigkeit. */
  ticksPerSecond: 10,
  /** Simulationsschritte pro Spieltag. */
  ticksPerDay: 20,
  daysPerMonth: 30,
  monthsPerYear: 12,
  startYear: 2025,
  /** Wählbare Geschwindigkeiten; 0 bedeutet Pause. */
  speeds: [0, 1, 2, 3],
};

export const SAVE = {
  /** So oft speichert das Spiel von selbst, in Sekunden echter Zeit. */
  intervalSeconds: 30,
};

export const CAMERA = {
  /** Vertikaler Blickwinkel in Grad. */
  fov: 45,
  /** Kleinster und größter Abstand zum Zielpunkt in Metern. */
  minDistance: 30,
  maxDistance: 1800,
  /** Neigung über dem Horizont in Bogenmaß (0 = flach, π/2 = senkrecht von oben). */
  minPitch: 0.5,
  maxPitch: 1.5,
  startDistance: 420,
  startPitch: 0.85,
  startYaw: 0.6,
};

export const GRAPHICS = {
  /** Obergrenze der Pixeldichte; niedriger ist schneller (wichtig fürs iPad). */
  maxPixelRatio: 2,
  skyColor: 0xa9d2ee,
  treeCount: 1400,
};
