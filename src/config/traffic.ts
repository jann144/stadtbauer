/** Verkehr: wie viele Autos fahren, wie viel eine Straße verträgt und was Stau bewirkt. */

export const TRAFFIC = {
  /** Höchstzahl gleichzeitig sichtbarer Autos. Kleiner ist schneller; wichtig fürs iPad. */
  maxCars: 160,
  /** Sichtbare Autos je Einwohner, bis zur Höchstzahl. */
  carsPerResident: 0.06,
  /**
   * Fahrten je Einwohner und Spieltag, die als Belastung der Straßen zählen. Sichtbar ist nur ein Teil davon;
   * jedes sichtbare Auto steht für entsprechend viele Fahrten.
   */
  tripsPerResident: 0.25,
  /** Fahrten je Spieltag und Fahrspur, bei denen eine Straße voll ausgelastet ist. */
  capacityPerLane: 120,
  /** So viel der gemessenen Belastung bleibt von einem Spieltag zum nächsten erhalten (glättet Schwankungen). */
  memory: 0.9,
  /** Langsamer als mit diesem Anteil des Tempolimits wird der Verkehr auch im dichtesten Stau nicht. */
  slowestShare: 0.2,
  /** Länge eines Autos und kleinster Abstand zum Vordermann in Metern. */
  carLength: 4.4,
  minGap: 2.5,
  /** Tempo in einer Kreuzung in Metern je Sekunde. */
  turnSpeed: 6,
  /** Beschleunigung in Metern je Sekunde, je Simulationsschritt. */
  acceleration: 0.8,
  /** Steht ein Auto so viele Simulationsschritte ohne Bewegung, wird es entfernt (löst festgefahrene Kreuzungen). */
  stuckTicks: 600,
};

export const CONGESTION = {
  /** Ab dieser Auslastung (1 = voll) leiden die Anlieger einer Straße. */
  annoysAbove: 0.9,
  /** Bei dieser Auslastung ist der volle Abzug erreicht. */
  worstAt: 1.8,
  /** Größter Abzug von der Zufriedenheit eines Gebäudes an einer überlasteten Straße. */
  penalty: 0.12,
};
