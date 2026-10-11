import type { World } from '../sim/world';
import { cameraOf, fromSave, toSave, type SavedCamera } from './save';

/** Unter diesem Namen liegt der Spielstand im Speicher des Browsers. */
const KEY = 'stadtbauer.spielstand';
/** Ein Spielstand, der sich nicht laden ließ, wird hierhin beiseitegelegt statt überschrieben. */
const BROKEN_KEY = 'stadtbauer.spielstand.defekt';
/** Größere Dateien sind sicher kein Spielstand; sie zu lesen würde das Gerät nur lahmlegen. */
const MAX_FILE_BYTES = 30_000_000;

export interface LoadedGame {
  world: World;
  camera: SavedCamera | null;
  /** Wann gespeichert wurde, oder null, wenn die Angabe fehlt. */
  savedAt: Date | null;
}

/** Liest einen Spielstand aus seinem Text; wirft mit einer deutschen Meldung, wenn das nicht geht. */
export function parseGame(text: string): LoadedGame {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Kein gültiger Spielstand: Die Daten lassen sich nicht lesen.');
  }
  const world = fromSave(data);
  const savedAt = new Date(String((data as { savedAt?: unknown }).savedAt));
  return { world, camera: cameraOf(data), savedAt: Number.isNaN(savedAt.getTime()) ? null : savedAt };
}

/** Die Meldung für den Spieler; unerwartete Fehler (beschädigte Daten) bekommen eine allgemeine. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return text.startsWith('Kein gültiger Spielstand') ? text : 'Kein gültiger Spielstand: Die Daten sind beschädigt.';
}

/** Der Text, der die Welt als Spielstand festhält. */
function gameText(world: World, camera: SavedCamera | null): string {
  return JSON.stringify(toSave(world, new Date().toISOString(), camera));
}

/** Legt die Welt im Speicher des Browsers ab. Liefert false, wenn der Browser das verweigert (voll oder gesperrt). */
export function storeGame(world: World, camera: SavedCamera | null): boolean {
  try {
    localStorage.setItem(KEY, gameText(world, camera));
    return true;
  } catch {
    return false;
  }
}

/**
 * Holt den Spielstand aus dem Speicher des Browsers. `problem` nennt den Grund, wenn einer da war,
 * sich aber nicht laden ließ; er wird dann beiseitegelegt, damit ihn das nächste Speichern nicht löscht.
 */
export function loadStoredGame(): { game: LoadedGame | null; problem: string | null } {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return { game: null, problem: null };
  }
  if (text === null) return { game: null, problem: null };
  try {
    return { game: parseGame(text), problem: null };
  } catch (error) {
    try {
      localStorage.setItem(BROKEN_KEY, text);
      localStorage.removeItem(KEY);
    } catch {
      // Lässt er sich nicht einmal verschieben, bleibt er liegen, bis das Spiel wieder speichert.
    }
    return { game: null, problem: messageOf(error) };
  }
}

export function clearStoredGame(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ohne Speicher gibt es nichts zu löschen.
  }
}

/** Prüft den Text einer Spielstand-Datei; liefert die Fehlermeldung oder null, wenn er sich laden lässt. */
export function checkGameText(text: string): string | null {
  try {
    parseGame(text);
    return null;
  } catch (error) {
    return messageOf(error);
  }
}

/** Macht den Text einer geprüften Spielstand-Datei zum Spielstand im Browser; beim nächsten Start wird er geladen. */
export function adoptGameText(text: string): boolean {
  try {
    localStorage.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gibt die Stadt als Datei heraus: auf Touch-Geräten über das Teilen-Menü (dort „In Dateien sichern“),
 * sonst als Download.
 */
export async function exportGame(world: World, camera: SavedCamera | null): Promise<void> {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const file = new File([gameText(world, camera)], `stadtbauer-${day}.json`, { type: 'application/json' });

  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Stadtbauer-Spielstand' });
      return;
    } catch (error) {
      // Der Spieler hat das Teilen-Menü selbst geschlossen: nichts weiter tun.
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Erst später freigeben; manche Browser beginnen den Download nicht sofort.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Lässt den Spieler eine Spielstand-Datei auswählen und liefert ihren Text; null, wenn er abbricht.
 * Muss direkt aus einem Klick heraus aufgerufen werden, sonst öffnet der Browser die Auswahl nicht.
 */
export function pickGameText(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) resolve(null);
      else if (file.size > MAX_FILE_BYTES) reject(new Error('Kein gültiger Spielstand: Die Datei ist zu groß.'));
      else file.text().then(resolve, reject);
    });
    input.click();
  });
}
