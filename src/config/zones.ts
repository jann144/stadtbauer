/** Zonenarten. Neue Arten einfach als weiteren Eintrag ergänzen. */

export type ZoneKind = 'residential' | 'commercial' | 'industrial';

export interface ZoneType {
  name: string;
  /** Bestimmt, welche Nachfrage die Zone bedient und was in ihr entsteht. */
  kind: ZoneKind;
  /** Farbe der Zellen in der Zonenansicht. */
  color: number;
  /** Grundstücksbreite entlang der Straße in Zellen: kleinste und größte. */
  lotWidth: [number, number];
  /** Grundstückstiefe von der Straße weg in Zellen: kleinste und größte. */
  lotDepth: [number, number];
  /** Geschosszahl: kleinste und größte. */
  floors: [number, number];
  /** Einwohner bzw. Arbeitsplätze je Zelle und Geschoss. */
  capacityPerCellFloor: number;
  /** Steuerpflichtiger Betrag je Einwohner bzw. Arbeitsplatz und Monat in Euro; davon geht der Steuersatz ab. */
  taxBase: number;
}

export const ZONE_TYPES = {
  residentialLow: {
    name: 'Wohnen locker',
    kind: 'residential',
    color: 0x6fd17a,
    lotWidth: [2, 3],
    lotDepth: [2, 3],
    floors: [1, 2],
    capacityPerCellFloor: 0.6,
    taxBase: 50,
  },
  residentialHigh: {
    name: 'Wohnen dicht',
    kind: 'residential',
    color: 0x1f9150,
    lotWidth: [2, 4],
    lotDepth: [3, 4],
    floors: [4, 9],
    capacityPerCellFloor: 1.2,
    taxBase: 20,
  },
  commercial: {
    name: 'Gewerbe',
    kind: 'commercial',
    color: 0x4a90e2,
    lotWidth: [2, 4],
    lotDepth: [2, 4],
    floors: [1, 3],
    capacityPerCellFloor: 1,
    taxBase: 60,
  },
  industrial: {
    name: 'Industrie',
    kind: 'industrial',
    color: 0xe2b93b,
    lotWidth: [3, 5],
    lotDepth: [3, 6],
    floors: [1, 2],
    capacityPerCellFloor: 0.8,
    taxBase: 50,
  },
} satisfies Record<string, ZoneType>;

export type ZoneId = keyof typeof ZONE_TYPES;

/** So viele Zellen tief reicht bebaubares Land von jeder Straßenseite. */
export const ZONE_DEPTH = 6;
