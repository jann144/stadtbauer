import { describe, expect, it } from 'vitest';
import { LOAN, MONEY, RESCUE, TAX } from '../../config/economy';
import { TIME } from '../../config/settings';
import type { ZoneId } from '../../config/zones';
import { buildRoad, demolishRoad, zoneArea } from '../actions';
import { commitRoad, planRoad } from '../roads/builder';
import { createWorld, stepWorld, type World } from '../world';
import { paintZone, roadsChanged } from '../zoning/growth';
import {
  forecast,
  loanInstalment,
  repayLoan,
  roadCost,
  roadRefund,
  setTaxRate,
  takeLoan,
  taxGrowthFactor,
} from './budget';
import { demandFor } from './demand';

const TICKS_PER_MONTH = TIME.ticksPerDay * TIME.daysPerMonth;

function plan(world: World, x1: number, z1: number, x2: number, z2: number, type: 'small' | 'medium' = 'small') {
  return planRoad(world.roads, { start: { x: x1, z: z1 }, end: { x: x2, z: z2 }, type });
}

/** Stellt ein Gebäude direkt in die Welt, ohne Zellen und Straße; für Steuerrechnungen genügt das. */
function addBuilding(world: World, zone: ZoneId, capacity: number): void {
  const id = world.nextBuildingId++;
  world.buildings.set(id, {
    id,
    zone,
    x: 0,
    z: 0,
    angle: 0,
    width: 2,
    depth: 2,
    floors: 1,
    baseCapacity: capacity,
    capacity,
    level: 1,
    happiness: 1,
    frontX: 0,
    frontZ: 0,
    seed: id,
  });
}

function simulate(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world);
}

describe('Bauen und Abreißen', () => {
  it('startet mit Startkapital, normalen Steuersätzen und ohne Kredit', () => {
    const { economy } = createWorld();
    expect(economy.money).toBe(MONEY.start);
    expect(economy.taxRate).toEqual({ residential: 10, commercial: 10, industrial: 10 });
    expect(economy.loan.remaining).toBe(0);
    expect(economy.lastReport).toBeNull();
  });

  it('rechnet Kosten aufgerundet und Erstattungen abgerundet', () => {
    expect(roadCost('small', 80)).toBe(1600);
    expect(roadCost('small', 80.01)).toBe(1601);
    expect(roadCost('medium', 80)).toBe(3200);
    expect(roadRefund('small', 80)).toBe(1200);
    expect(roadRefund('small', 80.01)).toBe(1200);
  });

  it('zieht beim Bauen die Kosten ab', () => {
    const world = createWorld();
    expect(buildRoad(world, plan(world, 0, 0, 80, 0))).toBeNull();
    expect(world.roads.segments.size).toBe(1);
    expect(world.economy.money).toBe(MONEY.start - 1600);
    expect(world.zoning.cells.length).toBeGreaterThan(0);
  });

  it('baut nicht und kostet nichts, wenn das Geld nicht reicht', () => {
    const world = createWorld();
    world.economy.money = 1599;
    expect(buildRoad(world, plan(world, 0, 0, 80, 0))).toBe('money');
    expect(world.roads.segments.size).toBe(0);
    expect(world.economy.money).toBe(1599);
  });

  it('verweigert einen noch gesperrten Straßentyp', () => {
    const world = createWorld();
    expect(buildRoad(world, plan(world, 0, 0, 80, 0, 'medium'))).toBe('locked');
    expect(world.roads.segments.size).toBe(0);
    world.milestone = 3;
    expect(buildRoad(world, plan(world, 0, 0, 80, 0, 'medium'))).toBeNull();
  });

  it('erstattet beim Abriss drei Viertel der Baukosten', () => {
    const world = createWorld();
    buildRoad(world, plan(world, 0, 0, 80, 0));
    const [segment] = world.roads.segments.values();
    expect(demolishRoad(world, segment.id)).toBe(1200);
    expect(world.economy.money).toBe(MONEY.start - 400);
    expect(world.roads.segments.size).toBe(0);
  });

  it('erstattet für geteilte Straßen zusammen nie mehr, als sie gekostet haben', () => {
    const world = createWorld();
    buildRoad(world, plan(world, -100.3, 0, 100.4, 0));
    buildRoad(world, plan(world, 0.2, -70.1, 0.2, 70.7));
    const paid = MONEY.start - world.economy.money;
    let refunded = 0;
    while (world.roads.segments.size > 0) {
      const [segment] = world.roads.segments.values();
      refunded += demolishRoad(world, segment.id);
    }
    expect(refunded).toBeLessThanOrEqual(paid * 0.75);
  });

  it('macht mit Bauen und Abreißen nie Gewinn', () => {
    const world = createWorld();
    for (let i = 0; i < 20; i++) {
      buildRoad(world, plan(world, 0, 0, 96.5, 0));
      const [segment] = world.roads.segments.values();
      demolishRoad(world, segment.id);
      expect(world.economy.money).toBeLessThan(MONEY.start);
    }
  });
});

describe('Steuern', () => {
  it('berechnet Steuern aus Kapazität, Steuerbasis und Satz je Zonenart', () => {
    const world = createWorld();
    addBuilding(world, 'residentialLow', 10);
    addBuilding(world, 'commercial', 5);
    addBuilding(world, 'industrial', 4);
    const month = forecast(world);
    expect(month.taxes).toEqual({ residential: 50, commercial: 30, industrial: 20 });
    expect(month.net).toBe(100);
  });

  it('rundet Steuersätze auf ganze Prozent und begrenzt sie', () => {
    const world = createWorld();
    setTaxRate(world, 'residential', 7.6);
    setTaxRate(world, 'commercial', -3);
    setTaxRate(world, 'industrial', 99);
    expect(world.economy.taxRate).toEqual({ residential: 8, commercial: 0, industrial: TAX.maxRate });
  });

  it('lässt niedrige Steuern das Wachstum beschleunigen und hohe es bremsen, aber nie anhalten', () => {
    expect(taxGrowthFactor(TAX.normalRate)).toBe(1);
    expect(taxGrowthFactor(0)).toBeCloseTo(1.5, 9);
    expect(taxGrowthFactor(13)).toBeCloseTo(0.46, 9);
    for (let rate = 0; rate <= TAX.maxRate; rate++) {
      expect(taxGrowthFactor(rate)).toBeGreaterThan(0);
      if (rate > 0) expect(taxGrowthFactor(rate)).toBeLessThanOrEqual(taxGrowthFactor(rate - 1));
    }
  });

  it('vervielfacht die Nachfrage mit dem Faktor und hält sie zwischen 0 und 1', () => {
    const empty = { residents: 0, commercialJobs: 0, industrialJobs: 0 };
    expect(demandFor(empty).residential).toBe(0.5);
    expect(demandFor(empty, { residential: 1.5, commercial: 1, industrial: 1 }).residential).toBe(0.75);
    expect(demandFor(empty, { residential: 0.1, commercial: 1, industrial: 1 }).residential).toBeCloseTo(0.05, 9);
    expect(demandFor(empty, { residential: 9, commercial: 1, industrial: 1 }).residential).toBe(1);
  });

  it('lässt dieselbe Stadt bei höherer Wohnsteuer langsamer wachsen', () => {
    const grow = (rate: number): number => {
      const world = createWorld();
      commitRoad(world.roads, plan(world, -200, 0, 200, 0));
      roadsChanged(world);
      for (let x = -196; x <= 196; x += 8) paintZone(world, x, -20, 14, 'residentialLow');
      setTaxRate(world, 'residential', rate);
      simulate(world, 60);
      return world.stats.residents;
    };
    expect(grow(TAX.maxRate)).toBeLessThan(grow(TAX.normalRate));
  });
});

describe('Laufende Abrechnung', () => {
  /** 25 Arbeitsplätze im Gewerbe bringen 150 € im Monat, 100 m kleine Straße kosten 50 €. */
  function smallTown(): World {
    const world = createWorld();
    addBuilding(world, 'commercial', 25);
    commitRoad(world.roads, plan(world, 0, 0, 100, 0));
    return world;
  }

  it('bucht jeden Tag ein Dreißigstel des Monatsergebnisses', () => {
    const world = smallTown();
    expect(forecast(world).net).toBeCloseTo(100, 9);
    simulate(world, TIME.ticksPerDay - 1);
    expect(world.economy.money).toBe(MONEY.start);
    simulate(world, 1);
    expect(world.economy.money).toBeCloseTo(MONEY.start + 100 / 30, 9);
  });

  it('schließt den Monat mit einem Bericht ab und beginnt neu', () => {
    const world = smallTown();
    simulate(world, TICKS_PER_MONTH);
    expect(world.economy.money).toBeCloseTo(MONEY.start + 100, 6);
    const report = world.economy.lastReport!;
    expect(report.month).toBe(0);
    expect(report.taxes.commercial).toBeCloseTo(150, 6);
    expect(report.roadUpkeep).toBeCloseTo(50, 6);
    expect(report.net).toBeCloseTo(100, 6);
    expect(report.aid).toBe(0);
    expect(world.economy.book.roadUpkeep).toBe(0);

    simulate(world, TICKS_PER_MONTH);
    expect(world.economy.lastReport!.month).toBe(1);
  });

  it('zählt einen erst am letzten Tag erhöhten Steuersatz nur für diesen Tag', () => {
    const world = smallTown();
    setTaxRate(world, 'commercial', 0);
    simulate(world, TICKS_PER_MONTH - TIME.ticksPerDay);
    setTaxRate(world, 'commercial', 15);
    simulate(world, TIME.ticksPerDay);
    // Voller Monat bei 15 % wären 225 €; gebucht wird ein Dreißigstel davon.
    expect(world.economy.lastReport!.taxes.commercial).toBeCloseTo(225 / 30, 6);
  });

  it('lässt das Konto nie unter null fallen und erlässt fehlenden Unterhalt', () => {
    const world = createWorld();
    commitRoad(world.roads, plan(world, -400, 0, 400, 0));
    world.economy.money = 100;
    for (let day = 0; day < TIME.daysPerMonth; day++) {
      simulate(world, TIME.ticksPerDay);
      expect(world.economy.money).toBeGreaterThanOrEqual(0);
    }
    const report = world.economy.lastReport!;
    // 800 m kosten 400 € Unterhalt; 100 € waren da, 300 € werden erlassen.
    expect(report.roadUpkeep).toBeCloseTo(400, 6);
    expect(report.unpaid).toBeCloseTo(300, 6);
    expect(report.net).toBeCloseTo(-100, 6);
    // Die Straßen sind beim Abriss noch genug wert, also gibt es keine Nothilfe.
    expect(report.aid).toBe(0);
    expect(world.economy.money).toBe(0);
  });
});

describe('Kredit', () => {
  function withCredit(): World {
    const world = createWorld();
    world.milestone = 2;
    return world;
  }

  it('zahlt den Betrag sofort aus und verlangt ein Zwanzigstel plus ein Prozent Zinsen je Monat', () => {
    const world = withCredit();
    expect(takeLoan(world, 5000)).toBe(true);
    expect(world.economy.money).toBe(MONEY.start + 5000);
    expect(loanInstalment(5000)).toBe(300);
    expect(forecast(world).loanPayment).toBe(300);
  });

  it('erlaubt keinen zweiten Kredit, keinen über dem Rahmen und keine krummen Beträge', () => {
    const world = withCredit();
    expect(takeLoan(world, 10000)).toBe(false);
    expect(takeLoan(world, 2500)).toBe(false);
    expect(takeLoan(world, 0)).toBe(false);
    expect(takeLoan(world, 5000)).toBe(true);
    expect(takeLoan(world, 5000)).toBe(false);
    expect(createWorld().milestone).toBe(0);
    expect(takeLoan(createWorld(), LOAN.step)).toBe(false);
  });

  it('ist nach zwanzig Raten getilgt und hat zwanzig Prozent gekostet', () => {
    const world = withCredit();
    takeLoan(world, 5000);
    simulate(world, TICKS_PER_MONTH * (LOAN.months - 1));
    expect(world.economy.loan.remaining).toBeCloseTo(250, 6);
    simulate(world, TICKS_PER_MONTH);
    expect(world.economy.loan).toEqual({ amount: 0, remaining: 0 });
    expect(world.economy.money).toBeCloseTo(MONEY.start - 1000, 6);
    expect(world.economy.lastReport!.loanPayment).toBe(300);
  });

  it('setzt die Rate aus, wenn das Geld nicht reicht, und lässt die Schuld stehen', () => {
    const world = withCredit();
    takeLoan(world, 5000);
    world.economy.money = 100;
    simulate(world, TICKS_PER_MONTH);
    expect(world.economy.lastReport!.loanPayment).toBe(0);
    expect(world.economy.loan.remaining).toBe(5000);
    expect(takeLoan(world, 5000)).toBe(false);
  });

  it('lässt sich vorzeitig für die Restschuld zurückzahlen', () => {
    const world = withCredit();
    takeLoan(world, 5000);
    expect(repayLoan(world)).toBe(true);
    expect(world.economy.money).toBe(MONEY.start);
    expect(world.economy.loan.remaining).toBe(0);
    expect(repayLoan(world)).toBe(false);

    takeLoan(world, 5000);
    world.economy.money = 4999;
    expect(repayLoan(world)).toBe(false);
  });
});

describe('Nothilfe und Balance', () => {
  it('füllt am Monatsende auf, wer fast nichts mehr besitzt', () => {
    const world = createWorld();
    world.economy.money = 0;
    simulate(world, TICKS_PER_MONTH);
    expect(world.economy.lastReport!.aid).toBe(RESCUE.worth);
    expect(world.economy.money).toBe(RESCUE.worth);
  });

  it('lässt sich nicht melken: Besitz aus Nothilfe bleibt begrenzt', () => {
    const world = createWorld();
    world.economy.money = 0;
    for (let month = 0; month < 12; month++) {
      // Alles Geld verbauen und wieder abreißen, dann auf die nächste Nothilfe warten.
      const length = Math.floor(world.economy.money / 20);
      if (length >= 16) {
        buildRoad(world, plan(world, 0, 0, length, 0));
        const [segment] = world.roads.segments.values();
        demolishRoad(world, segment.id);
      }
      simulate(world, TICKS_PER_MONTH);
      expect(world.economy.money).toBeLessThanOrEqual(RESCUE.worth);
    }
  });

  it('führt aus der Pleite wieder zu einer Stadt mit Überschuss', () => {
    const world = createWorld();
    world.economy.money = 0;
    simulate(world, TICKS_PER_MONTH);
    // Mit der Nothilfe eine Straße bauen und Wohnen ausweisen; das kostet nichts weiter.
    expect(buildRoad(world, plan(world, -120, 0, 120, 0))).toBeNull();
    for (let x = -116; x <= 116; x += 8) zoneArea(world, x, -20, 14, 'residentialLow');
    simulate(world, TICKS_PER_MONTH);
    // Die ersten Siedler schalten Gewerbe und Industrie frei; erst mit Arbeitsplätzen trägt sich die Stadt.
    expect(world.milestone).toBeGreaterThanOrEqual(1);
    for (let x = -116; x <= 116; x += 8) zoneArea(world, x, 20, 14, x < 0 ? 'commercial' : 'industrial');
    expect(world.zoning.cells.some((cell) => cell.zone === 'commercial')).toBe(true);
    expect(world.zoning.cells.some((cell) => cell.zone === 'industrial')).toBe(true);
    simulate(world, TICKS_PER_MONTH * 2);
    expect(forecast(world).net).toBeGreaterThan(0);
  });

  it('trägt eine voll ausgewiesene Straße und zahlt sie in unter 18 Monaten zurück', () => {
    const world = createWorld();
    expect(buildRoad(world, plan(world, -140, 0, 140, 0))).toBeNull();
    const cost = MONEY.start - world.economy.money;
    for (let x = -136; x <= 136; x += 8) {
      paintZone(world, x, -28, 26, 'residentialLow');
      paintZone(world, x, 28, 26, x < 0 ? 'commercial' : 'industrial');
    }
    simulate(world, TICKS_PER_MONTH * 3);
    const net = forecast(world).net;
    expect(net).toBeGreaterThan(0);
    expect(cost / net).toBeLessThan(18);
  });

  it('übersteht als reine Daten das Speichern und Laden', () => {
    const world = createWorld();
    world.milestone = 2;
    takeLoan(world, 5000);
    addBuilding(world, 'commercial', 25);
    simulate(world, TICKS_PER_MONTH + 40);
    expect(JSON.parse(JSON.stringify(world.economy))).toEqual(world.economy);
  });
});
