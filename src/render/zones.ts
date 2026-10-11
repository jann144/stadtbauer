import { Color, Group, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { WORLD } from '../config/settings';
import { ZONE_TYPES } from '../config/zones';
import type { ZoneGrid } from '../sim/zoning/cells';
import { Instances } from './instances';

const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);
const UNZONED = new Color(0xf2f2f2);

/** Zeigt die freien Zonenzellen als farbige Quadrate auf dem Boden. */
export class ZoneView {
  readonly group = new Group();
  private readonly tiles: Instances;
  private readonly colors = new Map<string, Color>();

  constructor() {
    const size = WORLD.cellSize - 0.8;
    const geometry = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const material = new MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    this.tiles = new Instances(this.group, geometry, material);
    for (const [id, type] of Object.entries(ZONE_TYPES)) this.colors.set(id, new Color(type.color));
  }

  /**
   * Zeigt unbebaute Zellen: mit `showAll` alle, sonst nur die mit einer Zone,
   * auf denen noch etwas entstehen kann (also nicht hinter einem Gebäude liegen).
   */
  sync(grid: ZoneGrid, showAll: boolean): void {
    // Die Reihen einer Spalte stehen hintereinander; ab dem ersten Gebäude ist der Rest der Spalte verdeckt.
    let blocked = false;
    const shown = grid.cells.filter((cell) => {
      if (cell.row === 0) blocked = false;
      if (cell.building !== null) blocked = true;
      return cell.building === null && (showAll || (cell.zone !== null && !blocked));
    });
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    this.tiles.begin(shown.length);
    for (const cell of shown) {
      position.set(cell.x, 0.07, cell.z);
      rotation.setFromAxisAngle(UP, -cell.angle);
      matrix.compose(position, rotation, ONE);
      this.tiles.add(matrix, (cell.zone && this.colors.get(cell.zone)) || UNZONED);
    }
    this.tiles.end();
  }
}
