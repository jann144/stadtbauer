/** Spielbalance: Nachfrage und Wachstum. Werte hier ändern, um das Spiel leichter oder schwerer zu machen. */

export const GROWTH = {
  /** Alle so viele Simulationsschritte wird geprüft, ob neue Gebäude entstehen. */
  interval: 8,
  /** Anteil der Einwohner, die arbeiten. */
  workforceShare: 0.5,
  /** Arbeitsplätze in Gewerbe und Industrie, die ein Einwohner nachfragt. */
  commercialJobsPerResident: 0.2,
  industrialJobsPerResident: 0.25,
  /** Grundnachfrage nach Wohnraum (0..1), damit eine leere Stadt starten kann. */
  baseResidentialDemand: 0.5,
};
