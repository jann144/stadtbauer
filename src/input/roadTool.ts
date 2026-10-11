import { ROAD_RULES, type RoadTypeId } from '../config/roads';
import { WORLD } from '../config/settings';
import { buildRoad, refusalFor, roadPlanCost, type Refusal } from '../sim/actions';
import { isRoadUnlocked } from '../sim/economy/milestones';
import { planRoad, type RoadPlan, type RoadProblem } from '../sim/roads/builder';
import type { RoadNetwork } from '../sim/roads/graph';
import { roadAngleAt, snapToNetwork, type Snap } from '../sim/roads/snap';
import type { World } from '../sim/world';
import { formatMoney } from '../util/format';
import { distance, type Vec2 } from '../util/vec2';
import type { Tool, ToolEnvironment } from './tool';

export type RoadMode = 'straight' | 'curve';

/** Beim Einrasten bleibt die Richtung an Vielfachen von 45° hängen, wenn sie näher als 7° liegt. */
const ANGLE_STEP = Math.PI / 4;
const ANGLE_STICKY = (7 * Math.PI) / 180;

const PROBLEM_TEXT: Record<RoadProblem, string> = {
  tooShort: 'Die Straße ist zu kurz.',
  tooSharp: 'Die Kurve ist zu eng.',
  outOfBounds: 'Die Straße verlässt die Karte.',
  tooCloseToJunction: 'Zu nah an einer bestehenden Kreuzung.',
  angleTooSmall: 'Der Winkel zur anderen Straße ist zu spitz.',
  overlap: 'Die Straße überlappt eine andere.',
};

/** Straßenbau: Punkte nacheinander setzen; Geraden brauchen zwei, Kurven drei. */
export class RoadTool implements Tool {
  mode: RoadMode = 'straight';
  type: RoadTypeId = 'small';
  /** Richtung und Länge gerader Straßen an glatten Werten einrasten. */
  snapping = true;

  /** Bereits gesetzte Punkte: der Anfang, bei Kurven danach der Kontrollpunkt. */
  points: Vec2[] = [];
  /** Vorläufiger nächster Punkt: der Mauszeiger oder die zuletzt angetippte Stelle. */
  candidate: Vec2 | null = null;
  /** Die Straße ist fertig gezeichnet und wartet auf Bestätigung (Touchscreen). */
  pending = false;
  plan: RoadPlan | null = null;

  private startSnap: Snap | null = null;

  constructor(
    private readonly world: World,
    private readonly env: ToolEnvironment,
  ) {}

  private get net(): RoadNetwork {
    return this.world.roads;
  }

  setMode(mode: RoadMode): void {
    this.mode = mode;
    this.cancel();
  }

  setType(type: RoadTypeId): void {
    if (!isRoadUnlocked(this.world, type)) return;
    this.type = type;
    this.replan();
    this.env.changed();
  }

  setSnapping(on: boolean): void {
    this.snapping = on;
    this.env.changed();
  }

  hover(ground: Vec2 | null): void {
    if (this.pending) return;
    this.candidate = ground && this.snap(ground);
    this.replan();
    this.env.changed();
  }

  tap(ground: Vec2, pointerType: string): void {
    const point = this.snap(ground);
    if (this.points.length === this.pointsNeeded - 1) {
      // Letzter Punkt: mit der Maus sofort bauen, auf dem Touchscreen erst nach Bestätigung.
      this.candidate = point;
      this.replan();
      if (pointerType === 'mouse') {
        this.confirm();
      } else {
        this.pending = true;
      }
      this.env.changed();
      return;
    }
    if (this.points.length === 0) {
      this.startSnap = snapToNetwork(this.net, ground, this.env.snapRadius());
    }
    this.points.push(point);
    this.candidate = null;
    this.replan();
    this.env.changed();
  }

  confirm(): void {
    if (!this.plan || this.plan.problem) return;
    const end = this.plan.request.end;
    // Fehlt das Geld, bleibt alles Gezeichnete stehen; ein näherer Endpunkt macht die Straße billiger.
    if (buildRoad(this.world, this.plan) !== null) return;
    this.reset();
    // Weiterbauen: die nächste Straße beginnt am Ende der letzten.
    this.startSnap = snapToNetwork(this.net, end, ROAD_RULES.snapTolerance);
    this.points = [this.startSnap.point];
    this.env.worldChanged();
    this.env.changed();
  }

  cancel(): void {
    this.reset();
    this.env.changed();
  }

  get canConfirm(): boolean {
    return this.plan !== null && this.plan.problem === null && this.refusal === null;
  }

  /** Baukosten der gezeichneten Straße; null, solange nichts Baubares gezeichnet ist. */
  get cost(): number | null {
    return this.plan && !this.plan.problem ? roadPlanCost(this.plan) : null;
  }

  /** Warum die an sich baubare Straße verweigert wird (Geld, Freischaltung), oder null. */
  private get refusal(): Refusal | null {
    return this.plan && !this.plan.problem ? refusalFor(this.world, this.plan) : null;
  }

  /** Grund, warum die gezeichnete Straße nicht gebaut werden kann, oder null. */
  get problemText(): string | null {
    if (this.plan?.problem) return PROBLEM_TEXT[this.plan.problem];
    if (this.refusal === 'locked') return 'Dieser Straßentyp ist noch nicht freigeschaltet.';
    if (this.refusal === 'money' && this.cost !== null) {
      const have = formatMoney(this.world.economy.money);
      return `Zu teuer: Die Straße kostet ${formatMoney(this.cost)}, du hast ${have}. Wähle einen näheren Endpunkt.`;
    }
    return null;
  }

  get hint(): string {
    if (this.pending) return 'Mit „Bauen“ bestätigen oder den Endpunkt neu wählen.';
    if (this.points.length === 0) return 'Wähle den Startpunkt der Straße.';
    if (this.mode === 'curve' && this.points.length === 1) {
      return 'Wähle den Punkt, zu dem sich die Kurve wölbt.';
    }
    return 'Wähle den Endpunkt.';
  }

  private get pointsNeeded(): number {
    return this.mode === 'straight' ? 2 : 3;
  }

  private reset(): void {
    this.points = [];
    this.candidate = null;
    this.pending = false;
    this.plan = null;
    this.startSnap = null;
  }

  private replan(): void {
    if (this.points.length !== this.pointsNeeded - 1 || !this.candidate) {
      this.plan = null;
      return;
    }
    this.plan = planRoad(this.net, {
      start: this.points[0],
      end: this.candidate,
      control: this.mode === 'curve' ? this.points[1] : undefined,
      type: this.type,
    });
  }

  private snap(raw: Vec2): Vec2 {
    const placing = this.points.length;
    // Der Kontrollpunkt einer Kurve ist nur ein Griff und rastet nirgends ein.
    if (this.mode === 'curve' && placing === 1) return raw;

    const snapped = snapToNetwork(this.net, raw, this.env.snapRadius());
    if (snapped.node !== undefined || snapped.segment !== undefined) return snapped.point;
    if (!this.snapping || this.mode !== 'straight' || placing !== 1) return raw;
    return this.snapDirection(this.points[0], raw);
  }

  /** Richtet das freie Ende einer Geraden an der Ausgangsstraße aus und rundet die Länge auf Zonenzellen. */
  private snapDirection(start: Vec2, raw: Vec2): Vec2 {
    // Zu nah am Start (etwa beim Doppelklick) nichts runden: sonst entstünde aus dem Nichts ein Straßenstück.
    if (distance(start, raw) < ROAD_RULES.minLength) return raw;
    const reference = this.startSnap ? roadAngleAt(this.net, this.startSnap) : 0;
    let angle = Math.atan2(raw.z - start.z, raw.x - start.x);
    const relative = angle - reference;
    const nearest = Math.round(relative / ANGLE_STEP) * ANGLE_STEP;
    if (Math.abs(relative - nearest) < ANGLE_STICKY) angle = reference + nearest;

    const cell = WORLD.cellSize;
    const length = Math.max(cell * 2, Math.round(distance(start, raw) / cell) * cell);
    return { x: start.x + Math.cos(angle) * length, z: start.z + Math.sin(angle) * length };
  }
}
