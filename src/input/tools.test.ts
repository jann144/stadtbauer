import { describe, expect, it } from 'vitest';
import { MONEY } from '../config/economy';
import { createWorld, type World } from '../sim/world';
import { BulldozeTool } from './bulldozeTool';
import { RoadTool } from './roadTool';
import type { ToolEnvironment } from './tool';
import { ZoneTool } from './zoneTool';

/** Umgebung ohne Darstellung: fester Fangradius, die Rückmeldungen werden nur gezählt. */
function environment() {
  const calls = { changed: 0, worldChanged: 0 };
  const env: ToolEnvironment = {
    snapRadius: () => 7,
    changed: () => calls.changed++,
    worldChanged: () => calls.worldChanged++,
  };
  return { env, calls };
}

function roadTool(world: World) {
  const { env, calls } = environment();
  return { tool: new RoadTool(world, env), calls };
}

describe('Straßenwerkzeug', () => {
  it('baut mit der Maus sofort beim zweiten Klick und baut von dort weiter', () => {
    const world = createWorld();
    const { tool, calls } = roadTool(world);
    tool.tap({ x: 0, z: 0 }, 'mouse');
    tool.tap({ x: 80, z: 0 }, 'mouse');
    expect(world.roads.segments.size).toBe(1);
    expect(world.economy.money).toBe(MONEY.start - 1600);
    expect(tool.points).toEqual([{ x: 80, z: 0 }]);
    expect(calls.worldChanged).toBe(1);
  });

  it('wartet auf dem Touchscreen auf die Bestätigung', () => {
    const world = createWorld();
    const { tool } = roadTool(world);
    tool.tap({ x: 0, z: 0 }, 'touch');
    tool.tap({ x: 80, z: 0 }, 'touch');
    expect(world.roads.segments.size).toBe(0);
    expect(tool.pending).toBe(true);
    expect(tool.cost).toBe(1600);
    expect(tool.canConfirm).toBe(true);
    tool.confirm();
    expect(world.roads.segments.size).toBe(1);
    expect(tool.pending).toBe(false);
  });

  it('baut bei einem Doppelklick auf den Startpunkt kein Stück aus dem Nichts', () => {
    const world = createWorld();
    const { tool } = roadTool(world);
    tool.tap({ x: -67.3, z: 39.7 }, 'mouse');
    tool.tap({ x: -67.3, z: 39.7 }, 'mouse');
    expect(world.roads.segments.size).toBe(0);
    expect(tool.problemText).toBe('Die Straße ist zu kurz.');
  });

  it('baut mit der Maus nicht ohne Geld und behält die gesetzten Punkte', () => {
    const world = createWorld();
    world.economy.money = 1000;
    const { tool } = roadTool(world);
    tool.tap({ x: 0, z: 0 }, 'mouse');
    tool.tap({ x: 80, z: 0 }, 'mouse');
    expect(world.roads.segments.size).toBe(0);
    expect(world.economy.money).toBe(1000);
    expect(tool.points).toEqual([{ x: 0, z: 0 }]);
    expect(tool.problemText).toContain('Zu teuer');
    // Ein näherer Endpunkt ist bezahlbar.
    tool.tap({ x: 48, z: 0 }, 'mouse');
    expect(world.roads.segments.size).toBe(1);
  });

  it('sperrt auf dem Touchscreen die Bestätigung, bis das Geld reicht', () => {
    const world = createWorld();
    world.economy.money = 1000;
    const { tool } = roadTool(world);
    tool.tap({ x: 0, z: 0 }, 'touch');
    tool.tap({ x: 80, z: 0 }, 'touch');
    expect(tool.canConfirm).toBe(false);
    tool.confirm();
    expect(world.roads.segments.size).toBe(0);
    world.economy.money = 2000;
    expect(tool.canConfirm).toBe(true);
  });

  it('wechselt nicht auf einen gesperrten Straßentyp', () => {
    const world = createWorld();
    const { tool } = roadTool(world);
    tool.setType('medium');
    expect(tool.type).toBe('small');
    world.milestone = 3;
    tool.setType('medium');
    expect(tool.type).toBe('medium');
  });
});

describe('Abrisswerkzeug', () => {
  it('nennt die Erstattung vor der Bestätigung und schreibt sie danach gut', () => {
    const world = createWorld();
    const road = roadTool(world).tool;
    road.tap({ x: 0, z: 0 }, 'mouse');
    road.tap({ x: 80, z: 0 }, 'mouse');
    const { env } = environment();
    const tool = new BulldozeTool(world, env);

    tool.tap({ x: 40, z: 3 }, 'touch');
    expect(tool.pending).toBe(true);
    expect(tool.refund).toBe(1200);
    expect(tool.hint).toContain('1.200 €');
    expect(world.roads.segments.size).toBe(1);
    tool.confirm();
    expect(world.roads.segments.size).toBe(0);
    expect(world.economy.money).toBe(MONEY.start - 400);
    expect(tool.refund).toBeNull();
  });
});

describe('Zonenwerkzeug', () => {
  function zonedWorld() {
    const world = createWorld();
    const road = roadTool(world).tool;
    road.tap({ x: -80, z: 0 }, 'mouse');
    road.tap({ x: 80, z: 0 }, 'mouse');
    const { env } = environment();
    return { world, tool: new ZoneTool(world, env) };
  }
  const zoned = (world: World) => world.zoning.cells.filter((cell) => cell.zone !== null).length;

  it('malt beim Ziehen lückenlos und kostet nichts', () => {
    const { world, tool } = zonedWorld();
    const money = world.economy.money;
    tool.drag({ x: -70, z: 20 }, { x: 70, z: 20 });
    tool.dragEnd(false);
    // Großer Pinsel über 140 m: drei Reihen tief auf ganzer Länge.
    expect(zoned(world)).toBeGreaterThan(50);
    expect(world.economy.money).toBe(money);
  });

  it('nimmt einen unterbrochenen Pinselstrich zurück, lässt frühere aber stehen', () => {
    const { world, tool } = zonedWorld();
    tool.tap({ x: -60, z: 20 });
    const before = zoned(world);
    expect(before).toBeGreaterThan(0);
    tool.drag({ x: 0, z: 20 }, { x: 60, z: 20 });
    expect(zoned(world)).toBeGreaterThan(before);
    tool.dragEnd(true);
    expect(zoned(world)).toBe(before);
  });

  it('wählt keine gesperrte Zone', () => {
    const { world, tool } = zonedWorld();
    tool.setZone('commercial');
    expect(tool.zone).toBe('residentialLow');
    world.milestone = 1;
    tool.setZone('commercial');
    expect(tool.zone).toBe('commercial');
  });
});
