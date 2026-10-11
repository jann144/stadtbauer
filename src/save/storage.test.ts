import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRoad } from '../sim/actions';
import { planRoad } from '../sim/roads/builder';
import { createWorld, stepWorld, type World } from '../sim/world';
import { paintZone } from '../sim/zoning/growth';
import {
  adoptGameText,
  checkGameText,
  clearStoredGame,
  loadStoredGame,
  parseGame,
  storeGame,
} from './storage';

/** Speicher des Browsers als einfache Tabelle; mit `full` verweigert er das Schreiben. */
class FakeStorage {
  readonly items = new Map<string, string>();
  full = false;

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.full) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function town(): World {
  const world = createWorld();
  const plan = planRoad(world.roads, { start: { x: -100, z: 0 }, end: { x: 100, z: 0 }, type: 'small' });
  expect(buildRoad(world, plan)).toBeNull();
  for (let x = -90; x <= 90; x += 8) paintZone(world, x, 20, 26, 'residentialLow');
  for (let i = 0; i < 400; i++) stepWorld(world);
  expect(world.buildings.size).toBeGreaterThan(0);
  return world;
}

const CAMERA = { x: 30, z: -40, distance: 250, yaw: 1.2, pitch: 0.9 };

describe('Spielstand im Browser', () => {
  it('findet nichts, solange nie gespeichert wurde', () => {
    expect(loadStoredGame()).toEqual({ game: null, problem: null });
  });

  it('speichert und lädt die Stadt samt Kamera und Zeitpunkt', () => {
    const world = town();
    const before = Date.now();
    expect(storeGame(world, CAMERA)).toBe(true);

    const { game, problem } = loadStoredGame();
    expect(problem).toBeNull();
    expect(game!.world.tick).toBe(world.tick);
    expect([...game!.world.buildings.values()]).toEqual([...world.buildings.values()]);
    expect(game!.world.economy).toEqual(world.economy);
    expect(game!.camera).toEqual(CAMERA);
    expect(game!.savedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('meldet, wenn der Browser den Spielstand nicht annimmt', () => {
    storage.full = true;
    expect(storeGame(town(), null)).toBe(false);
    expect(adoptGameText('{}')).toBe(false);
  });

  it('legt einen kaputten Spielstand beiseite, statt ihn zu überschreiben', () => {
    storeGame(town(), null);
    const [key] = [...storage.items.keys()];
    storage.items.set(key, '{"version":1,"roads":');

    const { game, problem } = loadStoredGame();
    expect(game).toBeNull();
    expect(problem).toContain('Kein gültiger Spielstand');
    // Der kaputte Text liegt jetzt unter einem anderen Namen; der Platz des Spielstands ist frei.
    expect(storage.items.has(key)).toBe(false);
    expect([...storage.items.values()]).toEqual(['{"version":1,"roads":']);
    expect(loadStoredGame()).toEqual({ game: null, problem: null });
  });

  it('löscht den Spielstand für eine neue Stadt', () => {
    storeGame(town(), null);
    clearStoredGame();
    expect(loadStoredGame().game).toBeNull();
  });

  it('prüft eine Datei, bevor sie die Stadt ersetzt', () => {
    const world = town();
    storeGame(world, CAMERA);
    const text = [...storage.items.values()][0];
    expect(checkGameText(text)).toBeNull();
    expect(checkGameText('Das ist kein Spielstand')).toContain('lassen sich nicht lesen');
    expect(checkGameText('{"version":7}')).toContain('Version 7');
    expect(checkGameText('[1,2,3]')).toContain('Kein gültiger Spielstand');
    // Auch Daten, die an unerwarteter Stelle kaputt sind, ergeben eine deutsche Meldung statt eines Absturzes.
    const damaged = JSON.parse(text);
    damaged.buildings = [null];
    expect(checkGameText(JSON.stringify(damaged))).toBe('Kein gültiger Spielstand: Die Daten sind beschädigt.');

    // Eine geprüfte Datei wird zum Spielstand, der beim nächsten Start lädt.
    clearStoredGame();
    expect(adoptGameText(text)).toBe(true);
    expect(loadStoredGame().game!.world.buildings.size).toBe(world.buildings.size);
  });

  it('kommt mit einem Spielstand ohne Kamera und Zeitpunkt zurecht', () => {
    storeGame(town(), null);
    const data = JSON.parse([...storage.items.values()][0]);
    delete data.savedAt;
    data.camera = { x: 'links', z: 0 };
    const game = parseGame(JSON.stringify(data));
    expect(game.camera).toBeNull();
    expect(game.savedAt).toBeNull();
  });
});
