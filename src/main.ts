import './ui/style.css';
import { Color } from 'three';
import { MILESTONES } from './config/milestones';
import { ROAD_TYPES, SIDEWALK_WIDTH, type RoadTypeId } from './config/roads';
import { SERVICE_TYPES, type ServiceId } from './config/services';
import { SAVE, TIME, WORLD } from './config/settings';
import { ZONE_TYPES, type ZoneId } from './config/zones';
import { BulldozeTool } from './input/bulldozeTool';
import { CameraController } from './input/cameraController';
import { PointerInput } from './input/pointer';
import { RoadTool } from './input/roadTool';
import { ServiceTool } from './input/serviceTool';
import type { Tool, ToolEnvironment } from './input/tool';
import { ZoneTool } from './input/zoneTool';
import { registerServiceWorker } from './pwa';
import { CameraRig } from './render/cameraRig';
import { GameView } from './render/view';
import {
  adoptGameText,
  checkGameText,
  clearStoredGame,
  exportGame,
  loadStoredGame,
  pickGameText,
  storeGame,
} from './save/storage';
import type { Lot } from './sim/buildings';
import { SimClock } from './sim/clock';
import { forecast, repayLoan, setTaxRate, takeLoan } from './sim/economy/budget';
import {
  isRoadUnlocked,
  isServiceUnlocked,
  isZoneUnlocked,
  roadUnlockLevel,
  serviceUnlockLevel,
  zoneUnlockLevel,
} from './sim/economy/milestones';
import { samplePath, type Polyline } from './sim/roads/geometry';
import { nodeOf, segmentOf, shapeOf } from './sim/roads/graph';
import { accessOf, reachedStretches } from './sim/services/network';
import { congestion, junctionRadius } from './sim/traffic/traffic';
import { createWorld, dateAt, stepWorld } from './sim/world';
import { BudgetWindow } from './ui/budget';
import { CityWindow } from './ui/city';
import { Hud } from './ui/hud';
import { GameMenu } from './ui/menu';
import { describeUnlocks, lockNote } from './ui/milestoneText';
import { Notices } from './ui/notices';
import { Toolbar, type ToolId } from './ui/toolbar';
import { formatMoney, formatNumber } from './util/format';

// Farben der Verkehrsansicht nach Auslastung: frei, dicht, voll, Stau.
const HEAT = [
  { below: 0.5, color: new Color(0x4caf50) },
  { below: 0.9, color: new Color(0xffd54f) },
  { below: 1.4, color: new Color(0xff9800) },
  { below: Infinity, color: new Color(0xf44336) },
];

const VALID_COLOR = 0x4fb3ff;
const INVALID_COLOR = 0xff5a4d;
/** Fangradius der Werkzeuge: mindestens so viele Meter, sonst so viele Bildschirmpixel. */
const SNAP_METERS = 6;
const SNAP_PIXELS = 16;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
// Oben die Leiste, darunter die Fläche für Werkzeuge, Fenster und Meldungen.
const topRoot = document.querySelector<HTMLElement>('#top')!;
const uiRoot = document.querySelector<HTMLElement>('#stage')!;

// Weiter mit dem zuletzt gespeicherten Stand aus dem Browser, sonst mit einer neuen Stadt.
const stored = loadStoredGame();
const world = stored.game?.world ?? createWorld();
const clock = new SimClock();
const rig = new CameraRig();
if (stored.game?.camera) rig.setPose(stored.game.camera);
const view = new GameView(canvas, rig);
view.syncRoads(world.roads);
const cameraController = new CameraController(rig, canvas);

// --- Werkzeuge ---

const toolEnvironment: ToolEnvironment = {
  snapRadius: () => Math.max(SNAP_METERS, cameraController.metersPerPixel() * SNAP_PIXELS),
  changed: showTool,
  worldChanged: () => {
    view.syncRoads(world.roads);
    showMoney();
  },
};
const roadTool = new RoadTool(world, toolEnvironment);
const zoneTool = new ZoneTool(world, toolEnvironment);
const serviceTool = new ServiceTool(world, toolEnvironment);
const bulldozeTool = new BulldozeTool(world, toolEnvironment);
const tools: Record<ToolId, Tool | null> = {
  view: null,
  road: roadTool,
  zone: zoneTool,
  service: serviceTool,
  bulldoze: bulldozeTool,
};
let activeTool: ToolId = 'view';
/** Ob die Verkehrsansicht eingeschaltet ist. */
let trafficShown = false;

const toolbar = new Toolbar(uiRoot, {
  onTool: selectTool,
  onRoadMode: (mode) => roadTool.setMode(mode),
  onRoadType: (type) => roadTool.setType(type),
  onSnapping: (on) => roadTool.setSnapping(on),
  onZone: (zone) => zoneTool.setZone(zone),
  onBrush: (brush) => zoneTool.setBrush(brush),
  onService: (type) => serviceTool.setType(type),
  onTrafficView: (on) => {
    trafficShown = on;
    toolbar.setTrafficView(on);
  },
  onConfirm: () => tools[activeTool]?.confirm(),
  onCancel: () => tools[activeTool]?.cancel(),
});

function selectTool(id: ToolId): void {
  tools[activeTool]?.cancel();
  activeTool = id;
  showTool();
}

/** Mittellinie eines Grundstücks von der Straßenkante nach hinten; als Band gezeichnet ergibt sie dessen Fläche. */
function lotOutline(lot: Lot): Polyline {
  const reach = lot.depth * WORLD.cellSize;
  const back = { x: lot.frontX - Math.sin(lot.angle) * reach, z: lot.frontZ + Math.cos(lot.angle) * reach };
  return samplePath({ x: lot.frontX, z: lot.frontZ }, back);
}

function showLot(lot: Lot, color: number): void {
  view.overlay.show(lotOutline(lot), (lot.width * WORLD.cellSize) / 2, color);
}

/** Zeigt, welche Straßenabschnitte ein Dienst an diesem Grundstück erreichen würde. */
function showReach(lot: Lot, range: number): void {
  const access = accessOf(world.roads, { x: lot.frontX, z: lot.frontZ });
  if (!access) return;
  const stretches = reachedStretches(world.roads, access, range).map((stretch) => ({
    line: shapeOf(world.roads, stretch.segment),
    from: stretch.from,
    to: stretch.to,
  }));
  view.coverage.show(stretches, 5);
}

/** Überträgt den Zustand des aktiven Werkzeugs in Vorschau, Hinweistext und Schaltflächen. */
function showTool(): void {
  toolbar.setTool(activeTool);
  toolbar.setRoadOptions(roadTool.mode, roadTool.type, roadTool.snapping);
  toolbar.setZoneOptions(zoneTool.zone, zoneTool.brush);
  toolbar.setServiceOption(serviceTool.type);
  view.overlay.hide();
  view.coverage.hide();
  view.brush.hide();
  view.markers.set([], 1);
  toolbar.setHint('');
  toolbar.setActions(false, 'hidden');

  if (activeTool === 'road') {
    const plan = roadTool.plan;
    const problem = roadTool.problemText;
    const price = roadTool.cost === null ? '' : formatMoney(roadTool.cost);
    if (plan) {
      view.overlay.show(plan.shape, ROAD_TYPES[roadTool.type].width / 2, problem ? INVALID_COLOR : VALID_COLOR);
    }
    const points = roadTool.candidate ? [...roadTool.points, roadTool.candidate] : roadTool.points;
    view.markers.set(points, markerRadius());
    toolbar.setHint(problem ?? (price ? `${roadTool.hint} Kosten: ${price}.` : roadTool.hint), problem !== null);
    const confirm = !roadTool.pending ? 'hidden' : roadTool.canConfirm ? 'enabled' : 'disabled';
    toolbar.setActions(roadTool.points.length > 0, confirm, price ? `Bauen · ${price}` : 'Bauen');
  } else if (activeTool === 'zone') {
    if (zoneTool.pointer) view.brush.show(zoneTool.pointer, zoneTool.radius);
    toolbar.setHint(zoneTool.hint);
  } else if (activeTool === 'service') {
    const plan = serviceTool.plan;
    const problem = serviceTool.problemText;
    const spec = SERVICE_TYPES[serviceTool.type];
    if (plan) {
      showLot(plan.lot, problem ? INVALID_COLOR : VALID_COLOR);
      if (spec.range !== undefined) showReach(plan.lot, spec.range);
    }
    toolbar.setHint(problem ?? serviceTool.hint, problem !== null);
    const confirm = !serviceTool.pending ? 'hidden' : serviceTool.canConfirm ? 'enabled' : 'disabled';
    toolbar.setActions(serviceTool.pending, confirm, `Bauen · ${formatMoney(spec.cost)}`);
  } else if (activeTool === 'bulldoze') {
    const refund = bulldozeTool.refund;
    const target = bulldozeTool.target;
    if (target?.kind === 'road') {
      const segment = segmentOf(world.roads, target.id);
      view.overlay.show(shapeOf(world.roads, segment), ROAD_TYPES[segment.type].width / 2, INVALID_COLOR);
    } else if (target) {
      const lot = target.kind === 'service' ? world.services.get(target.id) : world.buildings.get(target.id);
      if (lot) showLot(lot, INVALID_COLOR);
    }
    toolbar.setHint(bulldozeTool.hint);
    const label = !refund ? 'Abreißen' : `Abreißen · +${formatMoney(refund)}`;
    toolbar.setActions(bulldozeTool.pending, bulldozeTool.pending ? 'enabled' : 'hidden', label);
  }
}

/** Färbt alle Straßen nach ihrer Auslastung ein; eine Kreuzung bekommt die Farbe ihres vollsten Arms. */
function showTraffic(): void {
  const net = world.roads;
  const colorFor = (ratio: number): Color => HEAT.find((step) => ratio < step.below)!.color;
  const roads = [...net.segments.values()].map((segment) => {
    const line = shapeOf(net, segment);
    // An Kreuzungen endet der Streifen vor der Kreuzungsfläche; die färbt eine eigene Scheibe.
    const trim = (nodeId: number): number =>
      nodeOf(net, nodeId).segments.length >= 3 ? Math.min(junctionRadius(net, nodeId), line.length / 2) : 0;
    return {
      line,
      from: trim(segment.from),
      to: line.length - trim(segment.to),
      halfWidth: ROAD_TYPES[segment.type].width / 2 - SIDEWALK_WIDTH,
      color: colorFor(congestion(world, segment.id)),
    };
  });
  const junctions = [...net.nodes.values()]
    .filter((node) => node.segments.length >= 3)
    .map((node) => ({
      center: node,
      radius: junctionRadius(net, node.id),
      color: colorFor(Math.max(...node.segments.map((id) => congestion(world, id)))),
    }));
  view.heat.show(roads, junctions);
}

function markerRadius(): number {
  return Math.max(1.5, cameraController.metersPerPixel() * 7);
}

// --- Geld, Budget und Meilensteine ---

const cityWindow = new CityWindow(uiRoot);
const budget = new BudgetWindow(uiRoot, {
  onTaxRate: (kind, rate) => setTaxRate(world, kind, rate),
  onTakeLoan: (amount) => {
    takeLoan(world, amount);
    showMoney();
  },
  onRepayLoan: () => {
    repayLoan(world);
    showMoney();
  },
});

const menu = new GameMenu(uiRoot, {
  onSave: () => {
    saveGame();
    showSaveStatus();
  },
  onExport: () => void exportGame(world, rig.pose),
  onImport: () => void importGame(),
  onNewCity: () =>
    menu.ask('Die jetzige Stadt geht dabei verloren. Sichere sie vorher als Datei, wenn du sie behalten willst.', 'Neue Stadt beginnen', () => {
      clearStoredGame();
      restart();
    }),
  onSandbox: (key, on) => {
    world.sandbox[key] = on;
    menu.setSandbox(world.sandbox);
    showLocks();
    showTool();
  },
});

/** Öffnet ein Fenster und schließt die anderen; ein zweiter Druck auf denselben Knopf schließt es wieder. */
function toggleWindow(which: 'budget' | 'city' | 'menu'): void {
  const wasOpen = { budget: budget.isOpen, city: cityWindow.isOpen, menu: menu.isOpen }[which];
  closeWindows();
  if (wasOpen) return;
  if (which === 'budget') budget.open(world);
  else if (which === 'city') cityWindow.open(world);
  else {
    menu.open(world.sandbox);
    showSaveStatus();
  }
}

function closeWindows(): void {
  budget.close();
  cityWindow.close();
  menu.close();
}

function isWindowOpen(): boolean {
  return budget.isOpen || cityWindow.isOpen || menu.isOpen;
}

// Nach den Fenstern angelegt, damit eine Meldung über einem offenen Fenster liegt und bedienbar bleibt.
const notices = new Notices(uiRoot);
if (stored.problem) {
  notices.show('Spielstand nicht geladen', [
    stored.problem,
    'Es beginnt eine neue Stadt. Der alte Stand liegt weiter im Browser und wird nicht überschrieben.',
  ]);
}

// --- Spielstand ---

/** Wann zuletzt gespeichert wurde; null, solange es noch keinen Spielstand gibt. */
let savedAt: Date | null = stored.game?.savedAt ?? null;
/** Ob das letzte Speichern im Browser geklappt hat. */
let saveWorks = true;
/** Die Seite lädt gleich neu (neue Stadt oder Stadt aus einer Datei); die jetzige Stadt darf dann nicht mehr gespeichert werden. */
let leaving = false;

/** Legt die Stadt im Browser ab. Liefert false, wenn das nicht ging. */
function saveGame(): boolean {
  if (leaving) return false;
  const worked = storeGame(world, rig.pose);
  if (worked) savedAt = new Date();
  else if (saveWorks) {
    notices.show('Speichern nicht möglich', [
      'Der Browser nimmt den Spielstand nicht an (Speicher voll oder gesperrt, etwa im privaten Modus).',
      'Sichere die Stadt über das Menü als Datei, sonst geht sie beim Schließen verloren.',
    ]);
  }
  saveWorks = worked;
  if (menu.isOpen) showSaveStatus();
  return worked;
}

function showSaveStatus(): void {
  if (!saveWorks) {
    menu.setStatus('Speichern im Browser ist fehlgeschlagen. Sichere die Stadt als Datei.', true);
    return;
  }
  const time = savedAt?.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const last = time ? `Zuletzt gespeichert um ${time} Uhr.` : 'Noch nicht gespeichert.';
  menu.setStatus(`${last} Das Spiel speichert alle ${SAVE.intervalSeconds} Sekunden und beim Schließen von selbst.`);
}

function restart(): void {
  leaving = true;
  location.reload();
}

/** Lässt eine Spielstand-Datei auswählen, prüft sie und ersetzt nach Rückfrage die jetzige Stadt. */
async function importGame(): Promise<void> {
  let text: string | null;
  try {
    text = await pickGameText();
  } catch (error) {
    menu.setStatus(error instanceof Error ? error.message : 'Die Datei lässt sich nicht lesen.', true);
    return;
  }
  if (text === null) return;
  const problem = checkGameText(text);
  if (problem) {
    menu.setStatus(problem, true);
    return;
  }
  const chosen = text;
  // Eine Fehlermeldung von einem früheren Versuch gilt nicht mehr.
  showSaveStatus();
  menu.ask('Die jetzige Stadt wird durch die Stadt aus der Datei ersetzt.', 'Stadt laden', () => {
    if (adoptGameText(chosen)) restart();
    else menu.setStatus('Der Browser nimmt die Datei nicht an (Speicher voll oder gesperrt).', true);
  });
}

// Von selbst speichern: regelmäßig und immer, wenn die Seite in den Hintergrund geht (auf dem iPad heißt das oft: geschlossen wird).
window.setInterval(saveGame, SAVE.intervalSeconds * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame();
});
window.addEventListener('pagehide', saveGame);

/** Kontostand, den die Anzeige zuletzt gezeigt hat; ändert er sich, prüfen die Werkzeuge neu, was bezahlbar ist. */
let shownMoney = Number.NaN;
/** Stufe, die die Oberfläche zuletzt gezeigt hat. */
let shownMilestone = -1;

function showMoney(): void {
  hud.setMoney(world.economy.money, forecast(world).net, world.sandbox.infiniteMoney);
  if (budget.isOpen) budget.update(world);
  if (cityWindow.isOpen) cityWindow.update(world);
  const whole = Math.floor(world.economy.money);
  if (whole === shownMoney) return;
  shownMoney = whole;
  if (activeTool === 'road' || activeTool === 'bulldoze' || activeTool === 'service') showTool();
}

/** Meldet neu erreichte Stufen und öffnet, was sie freischalten. */
function showMilestones(): void {
  if (world.milestone === shownMilestone) return;
  // Beim Start ist nichts zu melden; später jede neu erreichte Stufe einzeln.
  for (let level = Math.max(1, shownMilestone + 1); shownMilestone >= 0 && level <= world.milestone; level++) {
    const milestone = MILESTONES[level];
    const news = describeUnlocks(milestone);
    const lines = [`${formatNumber(milestone.residents)} Einwohner · Prämie +${formatMoney(milestone.reward)}`];
    if (news.length > 0) lines.push(`Neu: ${news.join(', ')}`);
    if ((milestone.unlocks.services ?? []).length > 0) {
      lines.push('Die Einwohner erwarten das jetzt. Baue es unter „Dienste“, sonst sinkt die Zufriedenheit.');
    }
    notices.show(`Meilenstein erreicht: ${milestone.name}`, lines);
  }
  shownMilestone = world.milestone;
  showLocks();
  showTool();
}

/** Sperrt bzw. öffnet Straßentypen, Zonenarten und Dienste nach Stufe und Sandbox-Schalter. */
function showLocks(): void {
  const roadIds = Object.keys(ROAD_TYPES) as RoadTypeId[];
  const roads = {} as Record<RoadTypeId, string | null>;
  for (const id of roadIds) roads[id] = isRoadUnlocked(world, id) ? null : lockNote(roadUnlockLevel(id));
  const zoneIds = Object.keys(ZONE_TYPES) as ZoneId[];
  const zones = {} as Record<ZoneId, string | null>;
  for (const id of zoneIds) zones[id] = isZoneUnlocked(world, id) ? null : lockNote(zoneUnlockLevel(id));
  const serviceIds = Object.keys(SERVICE_TYPES) as ServiceId[];
  const services = {} as Record<ServiceId, string | null>;
  for (const id of serviceIds) services[id] = isServiceUnlocked(world, id) ? null : lockNote(serviceUnlockLevel(id));
  toolbar.setLocks(roads, zones, services);

  // Steht eine Auswahl auf etwas Gesperrtem (anfangs, oder nachdem „alles freischalten“ wieder aus ist), auf das erste Freie wechseln.
  const openRoad = roadIds.find((id) => isRoadUnlocked(world, id));
  if (openRoad && !isRoadUnlocked(world, roadTool.type)) roadTool.setType(openRoad);
  const openZone = zoneIds.find((id) => isZoneUnlocked(world, id));
  if (openZone && zoneTool.zone !== 'none' && !isZoneUnlocked(world, zoneTool.zone)) zoneTool.setZone(openZone);
  const openService = serviceIds.find((id) => isServiceUnlocked(world, id));
  if (openService && !isServiceUnlocked(world, serviceTool.type)) serviceTool.setType(openService);
  showMoney();
}

// --- Eingaben ---

new PointerInput(canvas, {
  onDrag: (drag) => {
    const tool = tools[activeTool];
    // Manche Werkzeuge (Zonenpinsel) arbeiten beim Ziehen; sonst verschiebt Ziehen die Karte.
    if (drag.button !== 0 || !tool?.drag) {
      cameraController.drag(drag);
      return;
    }
    const from = cameraController.groundAt(drag.prevX, drag.prevY);
    const to = cameraController.groundAt(drag.x, drag.y);
    if (from && to) tool.drag(from, to);
  },
  onDragEnd: (interrupted) => tools[activeTool]?.dragEnd?.(interrupted),
  // Malt ein Finger, muss das Verschieben mit zwei Fingern in jede Richtung gehen, auch senkrecht.
  onPinchStart: () => cameraController.pinchStart(!tools[activeTool]?.drag),
  onPinch: (pinch) => cameraController.pinch(pinch),
  onWheel: (x, y, delta, pinch) => cameraController.wheel(x, y, delta, pinch),
  onTap: (x, y, pointerType) => {
    const ground = cameraController.groundAt(x, y);
    if (ground) tools[activeTool]?.tap(ground, pointerType);
  },
  onHover: (x, y) => tools[activeTool]?.hover(cameraController.groundAt(x, y)),
  onHoverEnd: () => tools[activeTool]?.hover(null),
  onSecondaryTap: () => tools[activeTool]?.cancel(),
});

/** Geschwindigkeit, zu der die Leertaste aus der Pause zurückkehrt. */
let resumeSpeed = 1;
const hud = new Hud(topRoot, {
  onSpeed: setSpeed,
  onBudget: () => toggleWindow('budget'),
  onCity: () => toggleWindow('city'),
  onMenu: () => toggleWindow('menu'),
});
setSpeed(1);
showTool();
showMilestones();

function setSpeed(speed: number): void {
  if (speed > 0) resumeSpeed = speed;
  clock.speed = speed;
  hud.setSpeed(speed);
}

// Leertaste pausiert, Ziffern wählen die Geschwindigkeit, R/Z/B/Esc/Enter bedienen die Werkzeuge.
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  // In einem Eingabefeld (Steuerregler) gehören die Tasten dem Feld.
  if (e.target instanceof HTMLInputElement) return;
  const windowOpen = isWindowOpen();
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      setSpeed(clock.speed === 0 ? resumeSpeed : 0);
      return;
    case 'Enter':
      // Hat eine Schaltfläche den Fokus, gehört die Eingabetaste ihr.
      if (!(e.target instanceof HTMLButtonElement) && !windowOpen) tools[activeTool]?.confirm();
      return;
    case 'Escape':
      // Der Reihe nach: ein offenes Fenster schließen, das Gezeichnete verwerfen, das Werkzeug ablegen.
      if (windowOpen) closeWindows();
      else if (activeTool === 'road' && roadTool.points.length > 0) roadTool.cancel();
      else selectTool('view');
      return;
  }
  // Buchstaben nach ihrer Beschriftung, damit Z auf deutscher wie englischer Tastatur das Z ist.
  const letterTool: Record<string, ToolId> = { r: 'road', z: 'zone', g: 'service', b: 'bulldoze' };
  const tool = letterTool[e.key.toLowerCase()];
  if (tool && !windowOpen) {
    selectTool(tool);
    return;
  }
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) {
    const speed = Number(digit[1]);
    if (speed > 0 && TIME.speeds.includes(speed)) setSpeed(speed);
  }
});

window.addEventListener('resize', () => view.resize());

// --- Spielschleife ---

let last = performance.now();
let fpsFrames = 0;
let fpsSeconds = 0;
// Zuletzt gezeichneter Stand; weicht er von der Welt ab, wird die Darstellung aktualisiert.
let shownBuildings = '';
let shownZones = '';
let shownTraffic = '';

function frame(now: number): void {
  const elapsed = (now - last) / 1000;
  last = now;

  // Lange Pausen (Tab im Hintergrund) nicht als Spielzeit zählen.
  const dt = Math.min(elapsed, 0.1);
  for (let steps = clock.advance(dt); steps > 0; steps--) stepWorld(world);
  cameraController.update(dt);

  const buildingsKey = `${world.buildingsVersion}|${world.servicesVersion}`;
  if (buildingsKey !== shownBuildings) {
    shownBuildings = buildingsKey;
    view.syncBuildings(world.buildings, world.services);
    // Wo eben noch Platz war, kann jetzt ein Haus stehen; Vorschau und Schaltflächen neu bewerten.
    if (activeTool === 'service' || activeTool === 'bulldoze') showTool();
  }
  const zonesKey = `${world.zoning.version}|${activeTool === 'zone'}`;
  if (zonesKey !== shownZones) {
    shownZones = zonesKey;
    view.syncZones(world.zoning, activeTool === 'zone');
  }
  if (activeTool === 'road') view.markers.resize(markerRadius());
  // Die Verkehrsansicht folgt den Messwerten (einmal je Spieltag neu) und dem Straßennetz.
  const trafficKey = `${trafficShown}|${world.traffic.version}|${world.zoning.version}`;
  if (trafficKey !== shownTraffic) {
    shownTraffic = trafficKey;
    if (trafficShown) showTraffic();
    else view.heat.hide();
  }
  view.syncCars(world.traffic.cars, clock.blend);
  view.render();
  hud.setDate(dateAt(world.tick));
  hud.setCity(world.stats.residents, world.city.happiness, world.demand);
  showMilestones();

  fpsFrames++;
  fpsSeconds += elapsed;
  if (fpsSeconds >= 0.5) {
    hud.setFps(Math.round(fpsFrames / fpsSeconds));
    fpsFrames = 0;
    fpsSeconds = 0;
    // Zweimal je Sekunde genügt: gebucht wird nur einmal je Spieltag.
    showMoney();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Eine neue Version des Spiels lädt die Seite neu, sobald die Stadt sicher gespeichert ist.
registerServiceWorker(saveGame);

// Zugriff aus der Browser-Konsole beim Entwickeln; `game.step(n)` rechnet n Schritte sofort.
if (import.meta.env.DEV) {
  const step = (count: number): void => {
    for (let i = 0; i < count; i++) stepWorld(world);
  };
  Object.assign(window, { game: { world, clock, rig, view, roadTool, zoneTool, serviceTool, step, save: saveGame } });
}
