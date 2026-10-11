import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { ServiceId } from '../config/services';
import { WORLD } from '../config/settings';
import { ZONE_TYPES } from '../config/zones';
import type { Building, Lot, ServiceBuilding } from '../sim/buildings';
import { createRandom } from '../util/random';
import { Instances } from './instances';

const CELL = WORLD.cellSize;
const UP = new Vector3(0, 1, 0);

// Farbpaletten; je Gebäude wird zufällig (aber immer gleich) eine Farbe gewählt.
const HOUSE_WALLS = [0xf1e9d8, 0xe9d7b8, 0xd9c2a3, 0xf4f1ea, 0xd7dfe6, 0xe6c9b8];
const HOUSE_ROOFS = [0xa5503a, 0x8a3f30, 0x5a5f66, 0x74513a];
const TOWER_WALLS = [0xcfd6dc, 0xb9c4cf, 0xe3ddd0, 0xa9b6c4, 0xd8cfc4];
const SHOP_WALLS = [0xe8e4da, 0xcfe0ea, 0xf0e2c4, 0xd9d9d9];
const SHOP_SIGNS = [0xd9534f, 0xf0963c, 0x2a9d8f, 0x7b5ea7, 0x3a7bd5];
const FACTORY_WALLS = [0x9aa3ab, 0xa7a091, 0x8b97a6, 0xb0a79a];
const LOT_GROUND = { residential: 0x7fb46b, commercial: 0xaaa9a3, industrial: 0x9b968b };
const PAVED = 0xaaa9a3;

/** Ein Bauteil in den Koordinaten des Grundstücks: x entlang der Straße, z von ihr weg, y nach oben. */
interface Part {
  /** Pyramide statt Quader: Dächer, Baumkronen, Hügel. */
  roof?: boolean;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  color: number;
}

/** Bodenplatte knapp unter Gehweghöhe, damit der Gehweg an Kurven darüber liegt. */
function ground(lot: Lot, color: number): Part {
  return { x: 0, y: 0, z: 0, width: lot.width * CELL - 0.6, height: 0.1, depth: lot.depth * CELL - 0.6, color };
}

/** Setzt ein gewachsenes Gebäude aus einfachen Quadern und Dächern zusammen. Aussehen hier anpassen. */
function partsOf(building: Building): Part[] {
  const random = createRandom(building.seed);
  const pick = (palette: number[]): number => palette[Math.floor(random() * palette.length)];
  const lotWidth = building.width * CELL;
  const lotDepth = building.depth * CELL;
  const front = -lotDepth / 2;
  const kind = ZONE_TYPES[building.zone].kind;
  // Jede Ausbaustufe macht das Gebäude sichtbar höher.
  const extra = building.level - 1;
  const parts: Part[] = [ground(building, LOT_GROUND[kind])];

  if (building.zone === 'residentialLow') {
    const width = Math.min(lotWidth - 5, 9 + random() * 4);
    const depth = Math.min(lotDepth - 6, 8 + random() * 3);
    const height = building.floors * 3 + extra * 1.5;
    const z = front + 3 + depth / 2;
    parts.push({ x: 0, y: 0, z, width, height, depth, color: pick(HOUSE_WALLS) });
    parts.push({
      roof: true,
      x: 0,
      y: height,
      z,
      width: width + 0.8,
      height: 2.2 + random() * 1.2,
      depth: depth + 0.8,
      color: pick(HOUSE_ROOFS),
    });
  } else if (kind === 'residential') {
    const width = Math.min(lotWidth - 5, 26);
    const depth = Math.min(lotDepth - 7, 22);
    const height = (building.floors + extra * 2) * 3.2;
    const z = front + 4 + depth / 2;
    const color = pick(TOWER_WALLS);
    parts.push({ x: 0, y: 0, z, width, height, depth, color });
    parts.push({ x: 0, y: height, z, width: width * 0.5, height: 2.4, depth: depth * 0.5, color: 0x6f7780 });
  } else if (kind === 'commercial') {
    const width = lotWidth - 3;
    const depth = Math.min(lotDepth - 6, 26);
    const height = (building.floors + extra) * 4;
    const z = front + 2.5 + depth / 2;
    parts.push({ x: 0, y: 0, z, width, height, depth, color: pick(SHOP_WALLS) });
    // Farbiges Band über dem Erdgeschoss als Ladenschild.
    parts.push({ x: 0, y: 3.1, z, width: width + 0.6, height: 0.7, depth: depth + 0.6, color: pick(SHOP_SIGNS) });
  } else {
    const width = lotWidth - 4;
    const depth = lotDepth - 8;
    const height = 6 + random() * 3 + extra * 2;
    const z = front + 5 + depth / 2;
    parts.push({ x: 0, y: 0, z, width, height, depth, color: pick(FACTORY_WALLS) });
    parts.push({ x: -width * 0.2, y: height, z, width: width * 0.3, height: 1.8, depth: depth * 0.4, color: 0x70767d });
    parts.push({ x: width / 2 - 2, y: 0, z: z + depth / 2 - 2, width: 1.6, height: height + 7, depth: 1.6, color: 0x8c5a4a });
  }
  return parts;
}

/** Ein kleiner Baum aus Stamm und Krone. */
function tree(x: number, z: number, size: number): Part[] {
  return [
    { x, y: 0, z, width: 0.6, height: 2, depth: 0.6, color: 0x6b4a2f },
    { roof: true, x, y: 1.6, z, width: 4 * size, height: 6 * size, depth: 4 * size, color: 0x3f8f46 },
  ];
}

/** Aussehen der Versorger und Dienste. Jeder Eintrag setzt das Gebäude aus Quadern und Pyramiden zusammen. */
const SERVICE_PARTS: Record<ServiceId, (lot: Lot) => Part[]> = {
  windTurbine: (lot) => [
    ground(lot, 0x9aa08f),
    { x: 0, y: 0, z: 0, width: 1.2, height: 27, depth: 1.2, color: 0xe9ecee },
    { x: 0, y: 26, z: 0, width: 2, height: 2, depth: 2.6, color: 0xd7dbde },
    // Rotor als Kreuz aus zwei schmalen Flügeln.
    { x: 0, y: 26.7, z: -1.6, width: 16, height: 0.6, depth: 0.4, color: 0xf6f7f8 },
    { x: 0, y: 19, z: -1.6, width: 0.6, height: 16, depth: 0.4, color: 0xf6f7f8 },
  ],
  powerPlant: (lot) => [
    ground(lot, 0x8d8a82),
    { x: -4, y: 0, z: -2, width: 24, height: 12, depth: 18, color: 0x8b97a6 },
    { x: 13, y: 0, z: -6, width: 9, height: 16, depth: 9, color: 0xb9b4a8 },
    { x: -10, y: 12, z: 2, width: 3, height: 20, depth: 3, color: 0x8c5a4a },
    { x: -2, y: 12, z: 2, width: 3, height: 20, depth: 3, color: 0x8c5a4a },
  ],
  waterTower: (lot) => [
    ground(lot, 0x9aa08f),
    { x: 0, y: 0, z: 0, width: 2.6, height: 14, depth: 2.6, color: 0xb7bcc2 },
    { x: 0, y: 14, z: 0, width: 9, height: 6, depth: 9, color: 0x8fc1e3 },
    { roof: true, x: 0, y: 20, z: 0, width: 9.6, height: 2.6, depth: 9.6, color: 0x5b89ad },
  ],
  waterWorks: (lot) => [
    ground(lot, 0x8f958c),
    { x: -4, y: 0, z: -6, width: 18, height: 7, depth: 12, color: 0x93a7b8 },
    { x: 9, y: 0, z: -7, width: 8, height: 5, depth: 8, color: 0x8fc1e3 },
    { x: 9, y: 0, z: 5, width: 8, height: 5, depth: 8, color: 0x8fc1e3 },
    { x: -6, y: 0, z: 7, width: 10, height: 1, depth: 8, color: 0x6fa6cf },
  ],
  landfill: (lot) => [
    ground(lot, 0x8a7a5c),
    { roof: true, x: -5, y: 0, z: 2, width: 15, height: 5, depth: 15, color: 0x7d6d52 },
    { roof: true, x: 7, y: 0, z: 5, width: 11, height: 3.6, depth: 11, color: 0x8b8474 },
    { roof: true, x: 6, y: 0, z: -7, width: 9, height: 2.8, depth: 9, color: 0x6f6a5c },
    { x: -9, y: 0, z: -11, width: 5, height: 3, depth: 4, color: 0xb9b4a8 },
  ],
  police: (lot) => [
    ground(lot, PAVED),
    { x: 0, y: 0, z: -2, width: 16, height: 8, depth: 12, color: 0x3e6fb5 },
    { x: 0, y: 3.4, z: -2, width: 16.6, height: 0.9, depth: 12.6, color: 0xf2f2ee },
    { x: 0, y: 8, z: -2, width: 6, height: 1.6, depth: 5, color: 0x2c4f82 },
  ],
  fireStation: (lot) => [
    ground(lot, PAVED),
    { x: -1, y: 0, z: -2, width: 15, height: 7, depth: 12, color: 0xc2473a },
    { x: -1, y: 0, z: -8.2, width: 11, height: 4.4, depth: 0.5, color: 0xe6e2da },
    { x: 8.5, y: 0, z: 3, width: 3.2, height: 13, depth: 3.2, color: 0xa63a30 },
  ],
  clinic: (lot) => [
    ground(lot, PAVED),
    { x: 0, y: 0, z: -3, width: 17, height: 12, depth: 18, color: 0xf2f2ee },
    // Rotes Kreuz auf dem Dach.
    { x: 0, y: 12, z: -3, width: 7, height: 0.8, depth: 2.2, color: 0xd9534f },
    { x: 0, y: 12, z: -3, width: 2.2, height: 0.8, depth: 7, color: 0xd9534f },
  ],
  school: (lot) => [
    ground(lot, 0xb9b29a),
    { x: -2, y: 0, z: -8, width: 22, height: 8, depth: 9, color: 0xc98a5a },
    { x: -9, y: 0, z: 2, width: 8, height: 8, depth: 12, color: 0xc98a5a },
    { roof: true, x: -2, y: 8, z: -8, width: 22.8, height: 2.4, depth: 9.8, color: 0x74513a },
    ...tree(8, 6, 0.8),
  ],
  park: (lot) => [
    ground(lot, 0x6fbf6a),
    { x: 0, y: 0.1, z: 0, width: 2.2, height: 0.06, depth: lot.depth * CELL - 3, color: 0xd9cfb0 },
    ...tree(-7, -6, 1),
    ...tree(7, -4, 0.85),
    ...tree(-6, 6, 0.9),
    ...tree(6, 7, 1.1),
    ...tree(-8, 0, 0.7),
  ],
};

/** Zeichnet alle Gebäude und Dienste als instanzierte Quader und Pyramiden. */
export class BuildingView {
  readonly group = new Group();
  private readonly boxes: Instances;
  private readonly roofs: Instances;
  private readonly known = new Set<number>();

  constructor() {
    // Beide Formen sind 1 × 1 × 1 groß und stehen auf dem Boden; die Maße kommen über die Skalierung.
    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const roof = new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    this.boxes = new Instances(this.group, box, new MeshLambertMaterial());
    this.roofs = new Instances(this.group, roof, new MeshLambertMaterial({ flatShading: true }));
  }

  /** Baut die Darstellung neu auf und liefert die Grundstücke, die seit dem letzten Mal dazugekommen sind. */
  sync(buildings: ReadonlyMap<number, Building>, services: ReadonlyMap<number, ServiceBuilding>): Lot[] {
    const added: Lot[] = [];
    for (const id of this.known) {
      if (!buildings.has(id) && !services.has(id)) this.known.delete(id);
    }

    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const color = new Color();
    const draw = (lot: Lot, parts: Part[]): void => {
      if (!this.known.has(lot.id)) {
        this.known.add(lot.id);
        added.push(lot);
      }
      const cos = Math.cos(lot.angle);
      const sin = Math.sin(lot.angle);
      rotation.setFromAxisAngle(UP, -lot.angle);
      for (const part of parts) {
        position.set(lot.x + part.x * cos - part.z * sin, part.y, lot.z + part.x * sin + part.z * cos);
        scale.set(part.width, part.height, part.depth);
        matrix.compose(position, rotation, scale);
        (part.roof ? this.roofs : this.boxes).add(matrix, color.setHex(part.color));
      }
    };

    // Großzügig Platz: je gewachsenem Gebäude höchstens vier Quader und ein Dach, je Dienst ein gutes Dutzend Teile.
    this.boxes.begin(buildings.size * 4 + services.size * 8);
    this.roofs.begin(buildings.size + services.size * 6);
    for (const building of buildings.values()) draw(building, partsOf(building));
    for (const service of services.values()) draw(service, SERVICE_PARTS[service.type](service));
    this.boxes.end();
    this.roofs.end();
    return added;
  }
}
