import { DEMOLITION, LOAN, MONEY, RESCUE, TAX } from '../../config/economy';
import { MILESTONES } from '../../config/milestones';
import { ROAD_TYPES, type RoadTypeId } from '../../config/roads';
import { HAPPINESS, SERVICE_TYPES, type ServiceId } from '../../config/services';
import { TIME } from '../../config/settings';
import { ZONE_TYPES, type ZoneKind } from '../../config/zones';
import { shapeOf } from '../roads/graph';
import type { World } from '../world';

/** Regelmäßige Beträge. */
export interface BudgetLines {
  /** Steuereinnahmen je Zonenart. */
  taxes: Record<ZoneKind, number>;
  /** Unterhalt aller Straßen. */
  roadUpkeep: number;
  /** Unterhalt aller Versorger und Dienste. */
  serviceUpkeep: number;
}

/** Vorschau auf einen ganzen Monat beim jetzigen Stand der Stadt. */
export interface Forecast extends BudgetLines {
  /** Fällige Kreditrate (Tilgung plus Zinsen); 0 ohne Kredit. */
  loanPayment: number;
  /** Einnahmen minus Ausgaben. */
  net: number;
}

/** Was im laufenden Monat bisher gebucht wurde. */
export interface MonthBook extends BudgetLines {
  /** Unterhalt, für den das Geld nicht reichte; er wird erlassen. */
  unpaid: number;
  /** Höchster Steuersatz je Zonenart an einem Tag dieses Monats; er bestimmt die Folgen für die Gebäude. */
  peakTax: Record<ZoneKind, number>;
}

/** Abrechnung eines abgeschlossenen Monats. */
export interface MonthReport extends MonthBook {
  /** Nummer des Monats seit Spielbeginn (0 = erster Monat). */
  month: number;
  /** Bezahlte Kreditrate; 0, wenn keine fällig war oder das Geld nicht reichte. */
  loanPayment: number;
  /** Nothilfe, die das Konto aufgefüllt hat. */
  aid: number;
  /** Änderung des Kontostands durch alle Posten dieser Abrechnung. */
  net: number;
}

export interface Loan {
  /** Ursprünglicher Kreditbetrag; 0 = kein Kredit. */
  amount: number;
  /** Noch nicht getilgter Teil des Kreditbetrags. */
  remaining: number;
}

export interface Economy {
  /** Kontostand in Euro; nie negativ. Kann Nachkommastellen haben, angezeigt wird abgerundet. */
  money: number;
  /** Steuersatz je Zonenart in ganzen Prozent (0 bis TAX.maxRate). */
  taxRate: Record<ZoneKind, number>;
  loan: Loan;
  book: MonthBook;
  /** Abrechnung des letzten Monats; null vor dem ersten Monatsende. */
  lastReport: MonthReport | null;
}

const KINDS: ZoneKind[] = ['residential', 'commercial', 'industrial'];

function emptyBook(): MonthBook {
  return {
    taxes: { residential: 0, commercial: 0, industrial: 0 },
    roadUpkeep: 0,
    serviceUpkeep: 0,
    unpaid: 0,
    peakTax: { residential: 0, commercial: 0, industrial: 0 },
  };
}

export function createEconomy(): Economy {
  const rate = TAX.normalRate;
  return {
    money: MONEY.start,
    taxRate: { residential: rate, commercial: rate, industrial: rate },
    loan: { amount: 0, remaining: 0 },
    book: emptyBook(),
    lastReport: null,
  };
}

// --- Bauen und Abreißen ---

/** Baukosten einer Straße; aufgerundet, damit geteilte Stücke zusammen nie mehr erstatten, als bezahlt wurde. */
export function roadCost(type: RoadTypeId, meters: number): number {
  return Math.ceil(meters * ROAD_TYPES[type].costPerMeter);
}

/** Erstattung beim Abriss einer Straße; abgerundet. */
export function roadRefund(type: RoadTypeId, meters: number): number {
  return Math.floor(meters * ROAD_TYPES[type].costPerMeter * DEMOLITION.refundShare);
}

/** Erstattung beim Abriss eines Versorgers oder Dienstes. */
export function serviceRefund(type: ServiceId): number {
  return Math.floor(SERVICE_TYPES[type].cost * DEMOLITION.refundShare);
}

export function canAfford(world: World, cost: number): boolean {
  return world.sandbox.infiniteMoney || world.economy.money >= cost;
}

/**
 * Alle Geldbewegungen laufen über diese beiden. Mit „unendlich Geld“ bleibt der Kontostand stehen:
 * nichts kostet etwas, und nichts bringt etwas ein (sonst ließe sich mit Abriss-Erstattungen Geld erzeugen).
 */
export function earn(world: World, amount: number): void {
  if (!world.sandbox.infiniteMoney) world.economy.money += amount;
}

export function spend(world: World, amount: number): void {
  if (!world.sandbox.infiniteMoney) world.economy.money -= amount;
}

/** Was der Abriss aller Straßen und Dienste zusammen einbrächte. */
export function demolitionValue(world: World): number {
  let value = 0;
  for (const segment of world.roads.segments.values()) {
    value += roadRefund(segment.type, shapeOf(world.roads, segment).length);
  }
  for (const service of world.services.values()) value += serviceRefund(service.type);
  return value;
}

// --- Steuern ---

/** Setzt den Steuersatz einer Zonenart; rundet auf ganze Prozent und begrenzt auf 0 bis TAX.maxRate. */
export function setTaxRate(world: World, kind: ZoneKind, rate: number): void {
  world.economy.taxRate[kind] = Math.min(TAX.maxRate, Math.max(0, Math.round(rate)));
}

/**
 * Wie stark ein Steuersatz das Wachstum einer Zonenart verändert:
 * 1 beim normalen Satz, mehr darunter, weniger darüber, aber nie unter TAX.minGrowth.
 */
export function taxGrowthFactor(rate: number): number {
  if (rate <= TAX.normalRate) return 1 + (TAX.normalRate - rate) * TAX.boostPerPoint;
  return Math.max(TAX.minGrowth, 1 - (rate - TAX.normalRate) * TAX.brakePerPoint);
}

/** Wie stark die Zufriedenheit das Wachstum verändert: 1 bei voller Zufriedenheit, darunter weniger. */
export function happinessGrowthFactor(happiness: number): number {
  return HAPPINESS.growthAtZero + (1 - HAPPINESS.growthAtZero) * happiness;
}

/** Wachstumsfaktor je Zonenart aus Steuersatz und Zufriedenheit. */
export function growthFactors(world: World): Record<ZoneKind, number> {
  const rates = world.economy.taxRate;
  const mood = world.city.happinessByKind;
  return {
    residential: taxGrowthFactor(rates.residential) * happinessGrowthFactor(mood.residential),
    commercial: taxGrowthFactor(rates.commercial) * happinessGrowthFactor(mood.commercial),
    industrial: taxGrowthFactor(rates.industrial) * happinessGrowthFactor(mood.industrial),
  };
}

// --- Kredit ---

/** Monatsrate eines Kredits: ein gleicher Teil der Tilgung plus Zinsen auf den ganzen Betrag. */
export function loanInstalment(amount: number): number {
  return amount / LOAN.months + Math.round(amount * LOAN.interestPerMonth);
}

/** Höchster Kreditbetrag auf der erreichten Stufe. */
export function loanLimit(world: World): number {
  return MILESTONES[world.milestone].loanLimit;
}

/**
 * Nimmt einen Kredit auf. Liefert false, wenn schon einer läuft oder der Betrag nicht erlaubt ist.
 * Mit „unendlich Geld“ gibt es keinen: die Schuld bliebe, das Geld käme aber nie an.
 */
export function takeLoan(world: World, amount: number): boolean {
  if (world.sandbox.infiniteMoney) return false;
  const loan = world.economy.loan;
  if (loan.remaining > 0 || amount <= 0 || amount % LOAN.step !== 0 || amount > loanLimit(world)) return false;
  world.economy.loan = { amount, remaining: amount };
  earn(world, amount);
  return true;
}

/** Zahlt die Restschuld auf einmal zurück, ohne weitere Zinsen. Liefert false, wenn das Geld nicht reicht. */
export function repayLoan(world: World): boolean {
  const loan = world.economy.loan;
  if (loan.remaining <= 0 || !canAfford(world, loan.remaining)) return false;
  spend(world, loan.remaining);
  world.economy.loan = { amount: 0, remaining: 0 };
  return true;
}

// --- Laufende Abrechnung ---

/** Einnahmen und Ausgaben eines ganzen Monats beim jetzigen Stand. Grundlage für Anzeige und Buchung. */
export function forecast(world: World): Forecast {
  const taxes: Record<ZoneKind, number> = { residential: 0, commercial: 0, industrial: 0 };
  for (const building of world.buildings.values()) {
    const type = ZONE_TYPES[building.zone];
    taxes[type.kind] += (building.capacity * type.taxBase * world.economy.taxRate[type.kind]) / 100;
  }
  let roadUpkeep = 0;
  for (const segment of world.roads.segments.values()) {
    roadUpkeep += shapeOf(world.roads, segment).length * ROAD_TYPES[segment.type].upkeepPerMeter;
  }
  let serviceUpkeep = 0;
  for (const service of world.services.values()) serviceUpkeep += SERVICE_TYPES[service.type].upkeep;
  const loan = world.economy.loan;
  const loanPayment = loan.remaining > 0 ? loanInstalment(loan.amount) : 0;
  const income = taxes.residential + taxes.commercial + taxes.industrial;
  const net = income - roadUpkeep - serviceUpkeep - loanPayment;
  return { taxes, roadUpkeep, serviceUpkeep, loanPayment, net };
}

/**
 * Bucht einen Tag: ein Dreißigstel der Steuern und des Unterhalts. So zählt jeder Tag mit dem Steuersatz
 * und dem Straßennetz, die an ihm galten. Reicht das Geld nicht, wird der Rest erlassen.
 */
export function settleDay(world: World): void {
  const economy = world.economy;
  const month = forecast(world);
  for (const kind of KINDS) {
    const income = month.taxes[kind] / TIME.daysPerMonth;
    earn(world, income);
    economy.book.taxes[kind] += income;
    economy.book.peakTax[kind] = Math.max(economy.book.peakTax[kind], economy.taxRate[kind]);
  }
  const roads = month.roadUpkeep / TIME.daysPerMonth;
  const services = month.serviceUpkeep / TIME.daysPerMonth;
  spend(world, roads + services);
  economy.book.roadUpkeep += roads;
  economy.book.serviceUpkeep += services;
  if (economy.money < 0) {
    economy.book.unpaid -= economy.money;
    economy.money = 0;
  }
}

/** Monatsende: Kreditrate zahlen, bei Bedarf Nothilfe, Bericht schreiben und neu beginnen. */
export function settleMonth(world: World): void {
  const economy = world.economy;
  const book = economy.book;

  let loanPayment = 0;
  const loan = economy.loan;
  if (loan.remaining > 0) {
    const instalment = loanInstalment(loan.amount);
    // Reicht das Geld nicht, setzt die Rate aus: keine Strafe, aber die Schuld bleibt.
    if (canAfford(world, instalment)) {
      spend(world, instalment);
      loanPayment = instalment;
      loan.remaining -= loan.amount / LOAN.months;
      if (loan.remaining < 0.5) economy.loan = { amount: 0, remaining: 0 };
    }
  }

  // Nothilfe: wer fast nichts mehr besitzt, kann nicht bauen und käme nie wieder auf die Beine.
  const aid = world.sandbox.infiniteMoney ? 0 : Math.max(0, RESCUE.worth - (economy.money + demolitionValue(world)));
  earn(world, aid);

  const income = book.taxes.residential + book.taxes.commercial + book.taxes.industrial;
  economy.lastReport = {
    ...book,
    month: world.tick / (TIME.ticksPerDay * TIME.daysPerMonth) - 1,
    loanPayment,
    aid,
    net: income - (book.roadUpkeep + book.serviceUpkeep - book.unpaid) - loanPayment + aid,
  };
  economy.book = emptyBook();
}
