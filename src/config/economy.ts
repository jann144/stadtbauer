/** Geld, Steuern, Kredite und Nothilfe. Werte hier ändern, um das Spiel leichter oder schwerer zu machen. */

export const MONEY = {
  /** Startkapital in Euro. Reicht für 750 m kleine Straße. */
  start: 15000,
};

export const DEMOLITION = {
  /** Anteil der Baukosten, den der Abriss einer Straße zurückbringt. Unter 1 lassen, sonst wird Bauen und Abreißen kostenlos. */
  refundShare: 0.75,
};

export const TAX = {
  /** Steuersatz in Prozent, mit dem jede Zonenart startet und bei dem sie normal schnell wächst. */
  normalRate: 10,
  /** Höchster einstellbarer Steuersatz in Prozent; der niedrigste ist 0. */
  maxRate: 15,
  /** Jeder Prozentpunkt unter dem normalen Satz lässt die Zonenart um diesen Anteil schneller wachsen. */
  boostPerPoint: 0.05,
  /** Jeder Prozentpunkt über dem normalen Satz bremst das Wachstum um diesen Anteil. */
  brakePerPoint: 0.18,
  /** Langsamer als so wird das Wachstum durch Steuern nie. Über 0 lassen, sonst kann die Stadt stehen bleiben. */
  minGrowth: 0.1,
};

export const LOAN = {
  /** Kredite gibt es in Schritten dieser Größe (Euro). Muss durch `months` teilbar sein. */
  step: 5000,
  /** Anzahl der Monatsraten. */
  months: 20,
  /** Zinsen je Monatsrate als Anteil des Kreditbetrags (0.01 = 1 %). */
  interestPerMonth: 0.01,
};

export const RESCUE = {
  /**
   * Besitz (Geld plus Abrisswert aller Straßen), bis zu dem die Nothilfe am Monatsende auffüllt.
   * So kann man nie ganz ohne Mittel dastehen. Reicht für 250 m kleine Straße.
   */
  worth: 5000,
};
