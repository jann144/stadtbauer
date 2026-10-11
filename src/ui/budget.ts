import { LOAN, TAX } from '../config/economy';
import { MILESTONES } from '../config/milestones';
import { TIME } from '../config/settings';
import { ZONE_TYPES, type ZoneKind } from '../config/zones';
import { forecast, loanInstalment, loanLimit, taxGrowthFactor } from '../sim/economy/budget';
import { nextMilestone } from '../sim/economy/milestones';
import type { World } from '../sim/world';
import { formatMoney, formatNumber, formatSigned, monthName } from '../util/format';
import { button, element, Popup } from './dom';
import { describeUnlocks } from './milestoneText';

export interface BudgetHandlers {
  onTaxRate(kind: ZoneKind, rate: number): void;
  onTakeLoan(amount: number): void;
  onRepayLoan(): void;
}

const KINDS: { kind: ZoneKind; label: string; color: number }[] = [
  { kind: 'residential', label: 'Wohnen', color: ZONE_TYPES.residentialLow.color },
  { kind: 'commercial', label: 'Gewerbe', color: ZONE_TYPES.commercial.color },
  { kind: 'industrial', label: 'Industrie', color: ZONE_TYPES.industrial.color },
];

interface TaxRow {
  amount: HTMLElement;
  slider: HTMLInputElement;
  rate: HTMLElement;
  growth: HTMLElement;
}

/** In Worten, wie ein Steuersatz das Wachstum verändert. */
function growthWord(rate: number): string {
  const factor = taxGrowthFactor(rate);
  if (factor > 1.1) return 'wächst schnell';
  if (factor < 0.3) return 'wächst kaum';
  if (factor < 0.9) return 'wächst langsam';
  return 'wächst normal';
}

/** Budgetfenster: Einnahmen und Ausgaben je Monat, Steuersätze, Kredit und das nächste Ziel. */
export class BudgetWindow {
  private readonly popup: Popup;
  private readonly taxRows = new Map<ZoneKind, TaxRow>();
  private readonly upkeep = element('span', 'amount');
  private readonly serviceRow = element('div', 'budget-row');
  private readonly serviceUpkeep = element('span', 'amount');
  private readonly instalmentRow = element('div', 'budget-row');
  private readonly instalment = element('span', 'amount');
  private readonly result = element('span', 'amount');
  private readonly lastMonth = element('div', 'budget-note');
  private readonly loanInfo = element('div', 'budget-note');
  private readonly loanStepper = element('div', 'stepper');
  private readonly loanAmountLabel = element('span', 'stepper-value');
  private readonly loanAction: HTMLButtonElement;
  private readonly goalTitle = element('div', 'goal-title');
  private readonly goalFill = element('div', 'goal-fill');
  private readonly goalNews = element('div', 'budget-note');
  /** Betrag, der im Kreditwähler eingestellt ist. */
  private loanAmount = LOAN.step;
  private world: World | null = null;

  constructor(
    root: HTMLElement,
    private readonly handlers: BudgetHandlers,
  ) {
    this.popup = new Popup(root, 'Budget');

    const monthly = element('section', 'budget-section');
    monthly.append(element('h3', 'section-title', 'Jeden Monat (Vorschau)'));
    for (const { kind, label, color } of KINDS) monthly.append(this.taxRow(kind, label, color));
    monthly.append(this.row('Unterhalt Straßen', this.upkeep));
    this.serviceRow.append(element('span', 'row-label', 'Unterhalt Dienste'), this.serviceUpkeep);
    monthly.append(this.serviceRow);
    this.instalmentRow.append(element('span', 'row-label', 'Kreditrate'), this.instalment);
    const resultRow = this.row('Ergebnis pro Monat', this.result);
    resultRow.classList.add('total');
    monthly.append(this.instalmentRow, resultRow, this.lastMonth);

    const loan = element('section', 'budget-section');
    const less = button('icon-button', '−', () => this.changeLoanAmount(-LOAN.step));
    less.setAttribute('aria-label', 'Kleinerer Betrag');
    const more = button('icon-button', '+', () => this.changeLoanAmount(LOAN.step));
    more.setAttribute('aria-label', 'Größerer Betrag');
    this.loanStepper.append(less, this.loanAmountLabel, more);
    this.loanAction = button('action primary', '', () => this.loanClicked());
    loan.append(element('h3', 'section-title', 'Kredit'), this.loanStepper, this.loanInfo, this.loanAction);

    const goal = element('section', 'budget-section');
    const track = element('div', 'goal-track');
    track.append(this.goalFill);
    goal.append(element('h3', 'section-title', 'Nächstes Ziel'), this.goalTitle, track, this.goalNews);

    this.popup.body.append(monthly, loan, goal);
  }

  get isOpen(): boolean {
    return this.popup.isOpen;
  }

  open(world: World): void {
    this.popup.open();
    this.update(world);
  }

  close(): void {
    this.popup.close();
  }

  /** Bringt alle Zahlen auf den Stand der Welt. */
  update(world: World): void {
    this.world = world;
    const economy = world.economy;
    const month = forecast(world);
    this.popup.aside.textContent = `Kontostand ${formatMoney(economy.money)}`;

    for (const [kind, row] of this.taxRows) {
      const rate = economy.taxRate[kind];
      row.amount.textContent = formatSigned(month.taxes[kind]);
      row.rate.textContent = `${rate} %`;
      row.growth.textContent = growthWord(rate);
      if (Number(row.slider.value) !== rate) row.slider.value = String(rate);
    }
    this.upkeep.textContent = formatSigned(-month.roadUpkeep);
    this.serviceRow.hidden = month.serviceUpkeep === 0;
    this.serviceUpkeep.textContent = formatSigned(-month.serviceUpkeep);
    this.instalmentRow.hidden = month.loanPayment === 0;
    this.instalment.textContent = formatSigned(-month.loanPayment);
    this.result.textContent = formatSigned(month.net);
    this.result.classList.toggle('negative', month.net < 0);

    const report = economy.lastReport;
    if (report) {
      const year = TIME.startYear + Math.floor(report.month / TIME.monthsPerYear);
      const name = `${monthName((report.month % TIME.monthsPerYear) + 1)} ${year}`;
      let text = `Letzter Monat (${name}): ${formatSigned(report.net)}`;
      if (report.aid > 0) text += ` · darin Nothilfe ${formatSigned(report.aid)}`;
      if (report.unpaid > 0.5) text += ` · erlassener Unterhalt ${formatMoney(report.unpaid)}`;
      this.lastMonth.textContent = text;
    } else {
      this.lastMonth.textContent = 'Abgerechnet wird jeden Tag ein Dreißigstel; am Monatsende folgt der Bericht.';
    }

    this.updateLoan(world);
    this.updateGoal(world);
  }

  private updateLoan(world: World): void {
    const { loan, money } = world.economy;
    const limit = loanLimit(world);
    if (loan.remaining > 0) {
      const left = Math.round(loan.remaining / (loan.amount / LOAN.months));
      this.loanStepper.hidden = true;
      this.loanInfo.textContent = `Restschuld ${formatMoney(loan.remaining)} · Rate ${formatMoney(loanInstalment(loan.amount))} · noch ${left} Raten`;
      this.loanAction.hidden = false;
      this.loanAction.textContent = `Jetzt zurückzahlen (${formatMoney(loan.remaining)})`;
      this.loanAction.disabled = money < loan.remaining;
      return;
    }
    if (limit === 0) {
      const first = MILESTONES.find((milestone) => milestone.loanLimit > 0);
      this.loanStepper.hidden = true;
      this.loanAction.hidden = true;
      this.loanInfo.textContent = first
        ? `Kredite gibt es ab dem Meilenstein „${first.name}“ (${formatNumber(first.residents)} Einwohner).`
        : 'Kredite gibt es in diesem Spiel nicht.';
      return;
    }
    this.loanAmount = Math.min(limit, Math.max(LOAN.step, this.loanAmount));
    const instalment = loanInstalment(this.loanAmount);
    this.loanStepper.hidden = false;
    this.loanAmountLabel.textContent = formatMoney(this.loanAmount);
    this.loanInfo.textContent = `${LOAN.months} Monatsraten zu ${formatMoney(instalment)} (zusammen ${formatMoney(instalment * LOAN.months)}). Höchstens ${formatMoney(limit)}.`;
    this.loanAction.hidden = false;
    this.loanAction.disabled = false;
    this.loanAction.textContent = 'Kredit aufnehmen';
  }

  private updateGoal(world: World): void {
    const next = nextMilestone(world);
    if (!next) {
      this.goalTitle.textContent = `${MILESTONES[world.milestone].name}: höchste Stufe erreicht`;
      this.goalFill.style.width = '100%';
      this.goalNews.textContent = '';
      return;
    }
    const residents = world.stats.residents;
    const missing = Math.max(0, next.residents - residents);
    this.goalTitle.textContent = `${next.name}: ${formatNumber(next.residents)} Einwohner (noch ${formatNumber(missing)})`;
    this.goalFill.style.width = `${Math.min(100, (residents / next.residents) * 100)}%`;
    const news = describeUnlocks(next);
    const reward = `Prämie ${formatMoney(next.reward)}`;
    this.goalNews.textContent = news.length > 0 ? `Schaltet frei: ${news.join(', ')} · ${reward}` : reward;
  }

  private changeLoanAmount(delta: number): void {
    this.loanAmount += delta;
    if (this.world) this.updateLoan(this.world);
  }

  private loanClicked(): void {
    if (!this.world) return;
    if (this.world.economy.loan.remaining > 0) this.handlers.onRepayLoan();
    else this.handlers.onTakeLoan(this.loanAmount);
    this.update(this.world);
  }

  private row(label: string, amount: HTMLElement): HTMLElement {
    const row = element('div', 'budget-row');
    row.append(element('span', 'row-label', label), amount);
    return row;
  }

  /** Zeile mit Steuerertrag und darunter dem Regler für den Steuersatz einer Zonenart. */
  private taxRow(kind: ZoneKind, label: string, color: number): HTMLElement {
    const amount = element('span', 'amount');
    const name = element('span', 'row-label');
    const swatch = element('span', 'swatch');
    swatch.style.background = `#${color.toString(16).padStart(6, '0')}`;
    name.append(swatch, `Steuern ${label}`);
    const top = element('div', 'budget-row');
    top.append(name, amount);

    const slider = element('input', 'tax-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(TAX.maxRate);
    slider.step = '1';
    slider.setAttribute('aria-label', `Steuersatz ${label}`);
    const set = (rate: number): void => {
      this.handlers.onTaxRate(kind, rate);
      if (this.world) this.update(this.world);
    };
    slider.addEventListener('input', () => set(Number(slider.value)));
    const less = button('icon-button', '−', () => set(Number(slider.value) - 1));
    less.setAttribute('aria-label', `Steuersatz ${label} senken`);
    const more = button('icon-button', '+', () => set(Number(slider.value) + 1));
    more.setAttribute('aria-label', `Steuersatz ${label} erhöhen`);

    const rate = element('span', 'tax-rate');
    const growth = element('span', 'tax-growth');
    const controls = element('div', 'tax-controls');
    controls.append(less, slider, more, rate, growth);

    this.taxRows.set(kind, { amount, slider, rate, growth });
    const wrap = element('div', 'tax-row');
    wrap.append(top, controls);
    return wrap;
  }
}
