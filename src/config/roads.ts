/** Straßentypen und Bauregeln. Neue Typen einfach als weiteren Eintrag ergänzen. */

export interface RoadType {
  name: string;
  /** Gesamtbreite inklusive Gehwegen in Metern. */
  width: number;
  /** Anzahl der Fahrspuren, beide Richtungen zusammen. Mehr Spuren vertragen mehr Verkehr. */
  lanes: number;
  /** Tempo bei freier Fahrt in Metern je Sekunde (11 m/s sind 40 km/h). */
  speed: number;
  /** Baukosten je Meter in Euro. */
  costPerMeter: number;
  /** Unterhalt je Meter und Monat in Euro. */
  upkeepPerMeter: number;
}

export const ROAD_TYPES = {
  small: { name: 'Kleine Straße', width: 16, lanes: 2, speed: 11, costPerMeter: 20, upkeepPerMeter: 0.5 },
  medium: { name: 'Hauptstraße', width: 24, lanes: 4, speed: 16, costPerMeter: 40, upkeepPerMeter: 1 },
} satisfies Record<string, RoadType>;

export type RoadTypeId = keyof typeof ROAD_TYPES;

/** Breite des Gehwegs auf jeder Straßenseite in Metern; der Rest der Breite ist Fahrbahn. */
export const SIDEWALK_WIDTH = 2.5;

export const ROAD_RULES = {
  /** Kürzeste erlaubte Straße in Metern. */
  minLength: 12,
  /** Kleinster Abstand zwischen zwei Kreuzungen in Metern. */
  minSpacing: 12,
  /** Kleinster Winkel zwischen zwei Straßen an einer Kreuzung in Grad. */
  minAngle: 20,
  /** Kleinster Kurvenradius in Metern. */
  minRadius: 12,
  /** So nah (in Metern) gilt ein Punkt als auf einem Knoten oder einer Straße liegend. */
  snapTolerance: 1,
};
