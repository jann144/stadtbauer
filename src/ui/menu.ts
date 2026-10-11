import type { Sandbox } from '../sim/world';
import { button, element, Popup } from './dom';

export interface MenuHandlers {
  /** Sofort im Browser speichern. */
  onSave(): void;
  /** Die Stadt als Datei herausgeben. */
  onExport(): void;
  /** Eine Stadt aus einer Datei laden. */
  onImport(): void;
  onNewCity(): void;
  onSandbox(key: keyof Sandbox, on: boolean): void;
}

/** Die Schalter für freies Bauen mit ihrer Beschriftung. */
const SANDBOX_SWITCHES: { key: keyof Sandbox; label: string }[] = [
  { key: 'infiniteMoney', label: 'Unendlich Geld' },
  { key: 'unlockAll', label: 'Alles freischalten' },
];

/** Fenster „Spiel“: Spielstand sichern und laden, neue Stadt, Schalter für freies Bauen. */
export class GameMenu {
  private readonly popup: Popup;
  private readonly status = element('div', 'budget-note');
  private readonly switches = new Map<keyof Sandbox, HTMLButtonElement>();
  private readonly question = element('div', 'menu-question');
  private readonly questionText = element('div', 'menu-question-text');
  private readonly yes: HTMLButtonElement;
  /** Was die Rückfrage auslöst, wenn der Spieler zustimmt. */
  private pending: (() => void) | null = null;

  constructor(root: HTMLElement, handlers: MenuHandlers) {
    this.popup = new Popup(root, 'Spiel');

    const save = this.section('Spielstand');
    save.append(
      this.status,
      this.row(
        button('action', 'Jetzt speichern', () => this.act(handlers.onSave)),
        button('action', 'Als Datei sichern', () => this.act(handlers.onExport)),
        button('action', 'Aus Datei laden', () => this.act(handlers.onImport)),
      ),
      element(
        'div',
        'budget-note',
        'Mit der Datei wandert die Stadt auf ein anderes Gerät, etwa vom PC aufs iPad, und sie ist eine Sicherung, falls der Browser seinen Speicher leert.',
      ),
    );

    const sandbox = this.section('Freies Bauen');
    const switches = this.row();
    for (const { key, label } of SANDBOX_SWITCHES) {
      const el = button('chip', label, () => handlers.onSandbox(key, !el.classList.contains('active')));
      this.switches.set(key, el);
      switches.append(el);
    }
    sandbox.append(
      switches,
      element(
        'div',
        'budget-note',
        'Mit unendlich Geld kostet nichts etwas, und der Kontostand bleibt stehen. „Alles freischalten“ öffnet alle Straßen, Zonen und Dienste; was die Einwohner erwarten, richtet sich weiter nach den Meilensteinen.',
      ),
    );

    const fresh = this.section('Neu anfangen');
    fresh.append(this.row(button('action', 'Neue Stadt', handlers.onNewCity)));

    this.yes = button('action danger', '', () => {
      const action = this.pending;
      this.dismiss();
      action?.();
    });
    this.question.hidden = true;
    this.question.append(this.questionText, this.row(button('action', 'Abbrechen', () => this.dismiss()), this.yes));

    this.popup.body.append(save, sandbox, fresh, this.question);
  }

  get isOpen(): boolean {
    return this.popup.isOpen;
  }

  open(sandbox: Sandbox): void {
    this.dismiss();
    this.setSandbox(sandbox);
    this.popup.open();
  }

  close(): void {
    this.dismiss();
    this.popup.close();
  }

  /** Zeile über den Schaltflächen: wann zuletzt gespeichert wurde, oder was schiefging. */
  setStatus(text: string, isProblem = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('negative', isProblem);
  }

  setSandbox(sandbox: Sandbox): void {
    for (const [key, el] of this.switches) {
      el.classList.toggle('active', sandbox[key]);
      el.setAttribute('aria-pressed', String(sandbox[key]));
    }
  }

  /** Fragt nach, bevor etwas die jetzige Stadt ersetzt; `action` läuft erst nach der Zustimmung. */
  ask(text: string, label: string, action: () => void): void {
    this.pending = action;
    this.questionText.textContent = text;
    this.yes.textContent = label;
    this.question.hidden = false;
    this.question.scrollIntoView({ block: 'nearest' });
  }

  /** Wer etwas anderes anfängt, hat eine offene Rückfrage damit verworfen. */
  private act(action: () => void): void {
    this.dismiss();
    action();
  }

  private dismiss(): void {
    this.pending = null;
    this.question.hidden = true;
  }

  private section(title: string): HTMLElement {
    const section = element('section', 'budget-section');
    section.append(element('h3', 'section-title', title));
    return section;
  }

  private row(...children: HTMLElement[]): HTMLElement {
    const row = element('div', 'menu-row');
    row.append(...children);
    return row;
  }
}
