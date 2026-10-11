/** Legt ein HTML-Element mit Klasse und optionalem Text an. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const el = element('button', className, label);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

/** Fenster über dem Spiel mit Titelzeile und Schließen-Knopf; ein Klick daneben schließt es. */
export class Popup {
  /** Inhalt des Fensters; scrollt, wenn er nicht auf den Bildschirm passt. */
  readonly body = element('div', 'window-body');
  /** Kurze Angabe in der Titelzeile, rechts neben dem Titel. */
  readonly aside = element('div', 'window-balance');
  // Fängt Klicks neben dem Fenster ab, damit dabei nichts gebaut wird.
  private readonly backdrop = element('div', 'backdrop');
  private readonly card = element('div', 'panel window');

  constructor(root: HTMLElement, title: string) {
    this.backdrop.hidden = true;
    this.card.hidden = true;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', title);
    this.backdrop.addEventListener('click', () => this.close());

    const close = button('icon-button', '×', () => this.close());
    close.setAttribute('aria-label', 'Schließen');
    const head = element('div', 'window-head');
    head.append(element('h2', 'window-title', title), this.aside, close);
    this.card.append(head, this.body);
    root.append(this.backdrop, this.card);
  }

  get isOpen(): boolean {
    return !this.card.hidden;
  }

  open(): void {
    this.backdrop.hidden = false;
    this.card.hidden = false;
  }

  close(): void {
    this.backdrop.hidden = true;
    this.card.hidden = true;
  }
}

/** Gruppe von Schaltflächen, von denen genau eine gewählt ist. */
export class Choice<T extends string> {
  readonly element = element('div', 'choice');
  private readonly buttons = new Map<T, HTMLButtonElement>();

  /** `color` setzt ein Farbfeld vor die Beschriftung, etwa für Zonenarten. */
  constructor(options: readonly { id: T; label: string; color?: number }[], onPick: (id: T) => void) {
    for (const option of options) {
      const el = button('chip', option.label, () => onPick(option.id));
      if (option.color !== undefined) {
        const swatch = element('span', 'swatch');
        swatch.style.background = `#${option.color.toString(16).padStart(6, '0')}`;
        el.prepend(swatch);
      }
      this.buttons.set(option.id, el);
      this.element.append(el);
    }
  }

  set(active: T): void {
    for (const [id, el] of this.buttons) {
      el.classList.toggle('active', id === active);
      el.setAttribute('aria-pressed', String(id === active));
    }
  }

  /** Sperrt eine Schaltfläche und zeigt darunter `note` (etwa „ab 300 Einw.“); null gibt sie wieder frei. */
  setLocked(id: T, note: string | null): void {
    const el = this.buttons.get(id);
    if (!el) return;
    el.disabled = note !== null;
    let hint = el.querySelector<HTMLElement>('.lock-note');
    if (note === null) {
      hint?.remove();
      return;
    }
    if (!hint) el.append((hint = element('span', 'lock-note')));
    hint.textContent = note;
  }
}
