import type { RoadTypeId } from './roads';
import type { ServiceId } from './services';
import type { ZoneId } from './zones';

export interface Milestone {
  name: string;
  /** Ab so vielen Einwohnern ist die Stufe erreicht. */
  residents: number;
  /** Einmalige Prämie in Euro. */
  reward: number;
  /** Höchster Kreditbetrag ab dieser Stufe (0 = noch keine Kredite). */
  loanLimit: number;
  /**
   * Was diese Stufe freischaltet. Was in keiner Stufe steht, ist von Anfang an verfügbar.
   * Mit einem Versorger oder Dienst entsteht auch der Bedarf danach: ab dann erwarten die Einwohner ihn.
   */
  unlocks: { roads?: RoadTypeId[]; zones?: ZoneId[]; services?: ServiceId[] };
}

/**
 * Stufen in aufsteigender Reihenfolge. Einmal erreicht, bleibt eine Stufe erhalten.
 * Achtung: Die zweite Stufe muss ohne Arbeitsplätze erreichbar sein, also unter 20 Einwohnern liegen;
 * vorher gibt es weder Gewerbe noch Industrie, und ohne Arbeit zieht bald niemand mehr zu.
 */
export const MILESTONES: Milestone[] = [
  { name: 'Gründung', residents: 0, reward: 0, loanLimit: 0, unlocks: { roads: ['small'], zones: ['residentialLow'] } },
  { name: 'Erste Siedler', residents: 12, reward: 1000, loanLimit: 0, unlocks: { zones: ['commercial', 'industrial'] } },
  { name: 'Dorf', residents: 100, reward: 3000, loanLimit: 5000, unlocks: { services: ['windTurbine', 'waterTower'] } },
  {
    name: 'Großes Dorf',
    residents: 300,
    reward: 6000,
    loanLimit: 15000,
    unlocks: { roads: ['medium'], services: ['landfill', 'park'] },
  },
  {
    name: 'Kleinstadt',
    residents: 700,
    reward: 10000,
    loanLimit: 30000,
    unlocks: { services: ['police', 'fireStation', 'school'] },
  },
  {
    name: 'Stadt',
    residents: 1500,
    reward: 15000,
    loanLimit: 60000,
    unlocks: { zones: ['residentialHigh'], services: ['clinic', 'powerPlant', 'waterWorks'] },
  },
  { name: 'Großstadt', residents: 4000, reward: 30000, loanLimit: 120000, unlocks: {} },
];
