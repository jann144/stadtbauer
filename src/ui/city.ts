import { TAX } from '../config/economy';
import { MILESTONES } from '../config/milestones';
import {
  CATEGORY_NAMES,
  COVERAGE,
  SERVICE_TYPES,
  UTILITIES,
  type ServiceCategory,
  type ServiceId,
} from '../config/services';
import { isRoadUnlocked, isServiceUnlocked } from '../sim/economy/milestones';
import { isNeedActive } from '../sim/services/services';
import type { World } from '../sim/world';
import { formatNumber } from '../util/format';
import { element, Popup } from './dom';

/** Das erste freigeschaltete Gebäude, das einen Bedarf deckt; für den Tipp, was zu bauen ist. */
function remedyFor(world: World, category: ServiceCategory): string | null {
  const ids = Object.keys(SERVICE_TYPES) as ServiceId[];
  const id = ids.find((type) => SERVICE_TYPES[type].category === category && isServiceUnlocked(world, type));
  return id ? SERVICE_TYPES[id].name : null;
}

/** Fenster „Stadt“: Zufriedenheit und wie gut Versorgung und Dienste die Gebäude erreichen. */
export class CityWindow {
  private readonly popup: Popup;

  constructor(root: HTMLElement) {
    this.popup = new Popup(root, 'Stadt');
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

  /** Baut den Inhalt aus dem Stand der Welt neu auf; es gibt hier nichts zu bedienen. */
  update(world: World): void {
    const city = world.city;
    this.popup.aside.textContent = `${Math.round(city.happiness * 100)} % zufrieden`;
    const sections: HTMLElement[] = [];
    const tips: string[] = [];

    const utilities = UTILITIES.filter((category) => isNeedActive(world, category));
    if (utilities.length > 0) {
      const section = this.section('Versorgung im Straßennetz');
      for (const category of utilities) {
        const { supply, demand, served } = city.utilities[category];
        const share = demand > 0 ? served / demand : 1;
        const text = `${formatNumber(served)} von ${formatNumber(demand)} versorgt`;
        section.append(this.meter(CATEGORY_NAMES[category], text, share));
        if (share >= 1) continue;
        // Reicht die Leistung insgesamt, steht sie an einer Straße ohne Verbindung zu den Abnehmern.
        tips.push(
          supply >= demand
            ? `${CATEGORY_NAMES[category]}: Ein Teil der Stadt ist nicht mit dem Versorger verbunden. Verbinde die Straßen.`
            : this.tip(world, category),
        );
      }
      sections.push(section);
    }

    const coverage = COVERAGE.filter((category) => isNeedActive(world, category));
    if (coverage.length > 0) {
      const section = this.section('Dienste in Reichweite');
      for (const category of coverage) {
        const share = city.coverage[category];
        const text = `${Math.round(share * 100)} % der Gebäude erreicht`;
        section.append(this.meter(CATEGORY_NAMES[category], text, share));
        if (share < 1) tips.push(this.tip(world, category));
      }
      sections.push(section);
    }

    if (world.traffic.flows.size > 0) {
      const section = this.section('Verkehr');
      // Auf ganze Prozent gerundet, mindestens 1 %, sobald überhaupt ein Gebäude betroffen ist;
      // Text, Balken und Tipp richten sich nach derselben Zahl.
      const jammed = city.congested > 0 ? Math.max(1, Math.round(city.congested * 100)) : 0;
      section.append(this.meter('Freie Fahrt', `${jammed} % der Gebäude an vollen Straßen`, 1 - jammed / 100));
      if (jammed > 0) {
        const remedy = isRoadUnlocked(world, 'medium') ? 'Baue Hauptstraßen oder weitere Verbindungen' : 'Baue weitere Verbindungen';
        tips.push(`Verkehr: ${remedy}. Volle Straßen zeigt die Verkehrsansicht unter „Ansehen“.`);
      }
      sections.push(section);
    }

    const rates = world.economy.taxRate;
    if (Math.max(rates.residential, rates.commercial, rates.industrial) > TAX.normalRate) {
      tips.push(`Steuern über ${TAX.normalRate} % senken die Zufriedenheit.`);
    }

    const notes = this.section(sections.length > 0 ? 'Was hilft' : 'Noch keine Ansprüche');
    if (sections.length === 0) {
      const first = MILESTONES.find((milestone) => (milestone.unlocks.services ?? []).length > 0);
      const names = (first?.unlocks.services ?? []).map((id) => CATEGORY_NAMES[SERVICE_TYPES[id].category]);
      tips.push(
        first
          ? `Die Einwohner erwarten noch nichts. Ab dem Meilenstein „${first.name}“ (${formatNumber(first.residents)} Einwohner) brauchen sie ${names.join(' und ')}.`
          : 'Die Einwohner erwarten nichts.',
      );
    } else if (tips.length === 0) {
      tips.push('Alle sind versorgt. Zufriedene Gebäude steigen mit der Zeit auf und bringen mehr Steuern.');
    } else {
      tips.push('Je zufriedener die Gebäude, desto schneller wächst die Stadt.');
    }
    for (const tip of tips) notes.append(element('div', 'budget-note', tip));
    sections.push(notes);

    this.popup.body.replaceChildren(...sections);
  }

  private tip(world: World, category: ServiceCategory): string {
    const remedy = remedyFor(world, category);
    return remedy
      ? `${CATEGORY_NAMES[category]} fehlt: „${remedy}“ unter „Dienste“ bauen.`
      : `${CATEGORY_NAMES[category]}: Dafür gibt es noch kein Gebäude.`;
  }

  private section(title: string): HTMLElement {
    const section = element('section', 'budget-section');
    section.append(element('h3', 'section-title', title));
    return section;
  }

  /** Zeile mit Beschriftung, Angabe und einem Balken für den gedeckten Anteil. */
  private meter(label: string, text: string, share: number): HTMLElement {
    const row = element('div', 'budget-row');
    row.append(element('span', 'row-label', label), element('span', 'amount', text));
    const fill = element('div', 'goal-fill');
    fill.style.width = `${Math.round(share * 100)}%`;
    fill.classList.toggle('short', share < 1);
    const track = element('div', 'goal-track');
    track.append(fill);
    const wrap = element('div', 'meter');
    wrap.append(row, track);
    return wrap;
  }
}
