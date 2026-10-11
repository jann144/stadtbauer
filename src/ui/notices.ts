import { button, element } from './dom';

/** Meldungen unter der oberen Leiste, etwa bei einem erreichten Meilenstein. Mehrere reihen sich hintereinander. */
export class Notices {
  private readonly card = element('div', 'panel notice');
  private readonly title = element('div', 'notice-title');
  private readonly body = element('div', 'notice-body');
  private readonly queue: { title: string; lines: string[] }[] = [];

  constructor(root: HTMLElement) {
    this.card.hidden = true;
    this.card.setAttribute('role', 'status');
    this.card.append(this.title, this.body, button('action primary', 'Weiter', () => this.next()));
    root.append(this.card);
  }

  /** Zeigt eine Meldung; läuft schon eine, kommt diese danach. */
  show(title: string, lines: string[]): void {
    this.queue.push({ title, lines });
    if (this.card.hidden) this.next();
  }

  private next(): void {
    const notice = this.queue.shift();
    this.card.hidden = !notice;
    if (!notice) return;
    this.title.textContent = notice.title;
    this.body.replaceChildren(...notice.lines.map((line) => element('div', 'notice-line', line)));
  }
}
