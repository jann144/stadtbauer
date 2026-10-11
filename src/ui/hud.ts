import { TIME } from '../config/settings';
import { ZONE_TYPES, type ZoneKind } from '../config/zones';
import type { Demand } from '../sim/economy/demand';
import type { GameDate } from '../sim/world';
import { formatMoney, formatNumber, formatSigned, monthName } from '../util/format';
import { element } from './dom';

/** Nachfragebalken: Beschriftung und Farbe je Zonenart. */
const DEMAND_BARS: { kind: ZoneKind; label: string; color: number }[] = [
  { kind: 'residential', label: 'Wohnen', color: ZONE_TYPES.residentialLow.color },
  { kind: 'commercial', label: 'Gewerbe', color: ZONE_TYPES.commercial.color },
  { kind: 'industrial', label: 'Industrie', color: ZONE_TYPES.industrial.color },
];

export interface HudHandlers {
  onSpeed(speed: number): void;
  /** Der Kontostand wurde angetippt. */
  onBudget(): void;
  /** Einwohnerzahl oder Zufriedenheit wurde angetippt. */
  onCity(): void;
  /** Der Menüknopf wurde angetippt. */
  onMenu(): void;
}

const MENU_ICON =
  '<svg viewBox="0 0 18 16" width="18" height="16" fill="currentColor" aria-hidden="true"><rect y="1.5" width="18" height="2.4" rx="1.2"/><rect y="6.8" width="18" height="2.4" rx="1.2"/><rect y="12.1" width="18" height="2.4" rx="1.2"/></svg>';

/** Obere Leiste mit Menüknopf, Kontostand, Einwohnerzahl, Nachfrage, Datum, Geschwindigkeit und Bildrate. */
export class Hud {
  private readonly balanceEl = element('span', 'money-balance');
  private readonly netEl = element('span', 'money-net');
  private readonly residentsEl = element('span', 'money-balance');
  private readonly happinessEl = element('span', 'money-net');
  private readonly dateEl = element('div', 'date');
  private readonly fpsEl = element('div', 'fps');
  private readonly demandFills = new Map<ZoneKind, HTMLElement>();
  private readonly speedButtons = new Map<number, HTMLButtonElement>();
  private shownDate = '';
  private shownCity = '';
  private shownMoney = '';

  constructor(root: HTMLElement, handlers: HudHandlers) {
    const menu = element('button', 'icon-button');
    menu.type = 'button';
    menu.innerHTML = MENU_ICON;
    menu.setAttribute('aria-label', 'Spielmenü öffnen');
    menu.addEventListener('click', handlers.onMenu);

    const title = element('div', 'title', 'Stadtbauer');

    const money = element('button', 'money');
    money.type = 'button';
    money.setAttribute('aria-label', 'Budget öffnen');
    money.append(this.balanceEl, this.netEl);
    money.addEventListener('click', handlers.onBudget);

    const city = element('button', 'money');
    city.type = 'button';
    city.setAttribute('aria-label', 'Versorgung und Zufriedenheit öffnen');
    city.append(this.residentsEl, this.happinessEl);
    city.addEventListener('click', handlers.onCity);

    const demand = element('div', 'demand');
    demand.setAttribute('aria-label', 'Nachfrage');
    for (const bar of DEMAND_BARS) {
      const track = element('div', 'demand-bar');
      track.title = `Nachfrage ${bar.label}`;
      const fill = element('div', 'demand-fill');
      fill.style.background = `#${bar.color.toString(16).padStart(6, '0')}`;
      track.append(fill);
      demand.append(track);
      this.demandFills.set(bar.kind, fill);
    }

    const speeds = element('div', 'speeds');
    for (const speed of TIME.speeds) {
      const button = element('button', 'speed');
      button.type = 'button';
      button.innerHTML = speedIcon(speed);
      button.setAttribute('aria-label', speed === 0 ? 'Pause' : `Geschwindigkeit ${speed}`);
      button.addEventListener('click', () => handlers.onSpeed(speed));
      this.speedButtons.set(speed, button);
      speeds.append(button);
    }

    const bar = element('div', 'topbar');
    bar.append(menu, title, money, city, demand, this.dateEl, speeds, this.fpsEl);
    root.append(bar);
  }

  setDate(date: GameDate): void {
    const text = `${date.day}. ${monthName(date.month)} ${date.year}`;
    if (text === this.shownDate) return;
    this.shownDate = text;
    this.dateEl.textContent = text;
  }

  /** Kontostand und das erwartete Ergebnis pro Monat; mit `infinite` stattdessen der Vermerk für freies Bauen. */
  setMoney(balance: number, monthlyNet: number, infinite = false): void {
    const key = infinite ? 'unendlich' : `${Math.floor(balance)}|${Math.round(monthlyNet)}`;
    if (key === this.shownMoney) return;
    this.shownMoney = key;
    this.balanceEl.textContent = infinite ? '∞ €' : formatMoney(balance);
    this.netEl.textContent = infinite ? 'Freies Bauen' : `${formatSigned(monthlyNet)} / Monat`;
    this.netEl.classList.toggle('negative', !infinite && Math.round(monthlyNet) < 0);
  }

  /** Einwohnerzahl, Zufriedenheit (0..1) und Nachfrage je Zonenart (0..1). */
  setCity(residents: number, happiness: number, demand: Demand): void {
    const mood = Math.round(happiness * 100);
    const key = `${residents}|${mood}|${demand.residential.toFixed(2)}|${demand.commercial.toFixed(2)}|${demand.industrial.toFixed(2)}`;
    if (key === this.shownCity) return;
    this.shownCity = key;
    this.residentsEl.textContent = `${formatNumber(residents)} Einwohner`;
    this.happinessEl.textContent = `${mood} % zufrieden`;
    this.happinessEl.classList.toggle('negative', mood < 50);
    for (const [kind, fill] of this.demandFills) fill.style.height = `${Math.round(demand[kind] * 100)}%`;
  }

  setSpeed(speed: number): void {
    for (const [value, button] of this.speedButtons) {
      button.classList.toggle('active', value === speed);
      button.setAttribute('aria-pressed', String(value === speed));
    }
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${fps} FPS`;
  }
}

/** Pausenbalken bei 0, sonst so viele Dreiecke wie die Geschwindigkeit. */
function speedIcon(speed: number): string {
  if (speed === 0) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="4.5" height="12"/><rect x="9.5" y="2" width="4.5" height="12"/></svg>';
  }
  const width = speed * 9 + 1;
  let paths = '';
  for (let i = 0; i < speed; i++) paths += `<path d="M${i * 9 + 1} 2l8 6-8 6z"/>`;
  return `<svg viewBox="0 0 ${width} 16" width="${width}" height="16" fill="currentColor" aria-hidden="true">${paths}</svg>`;
}
