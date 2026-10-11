import { WORLD } from '../../config/settings';
import { onLot, type Lot } from '../buildings';
import { cellsNear, type ZoneCell, type ZoneGrid } from './cells';

const CELL = WORLD.cellSize;
/** Eine Zelle gilt als belegt, wenn ein Grundstück mindestens so viele Meter in sie hineinragt. */
const OCCUPIED_OVERLAP = 1.5;

/** Lage eines Grundstücks, das genau die gegebenen Zellen (ein Rechteck aus `width` Spalten) bedeckt. */
export function lotFromCells(cells: ZoneCell[], width: number): Omit<Lot, 'id' | 'width' | 'depth'> {
  let x = 0;
  let z = 0;
  let cos = 0;
  let sin = 0;
  let frontX = 0;
  let frontZ = 0;
  for (const cell of cells) {
    x += cell.x / cells.length;
    z += cell.z / cells.length;
    cos += Math.cos(cell.angle);
    sin += Math.sin(cell.angle);
    if (cell.row === 0) {
      frontX += cell.x / width;
      frontZ += cell.z / width;
    }
  }
  // Mittlere Ausrichtung aller Zellen; auf geraden Straßen ist sie für alle gleich.
  const angle = Math.atan2(sin, cos);
  return {
    x,
    z,
    angle,
    // Von der Mitte der vordersten Zellen eine halbe Zelle zur Straße hin.
    frontX: frontX + (Math.sin(angle) * CELL) / 2,
    frontZ: frontZ - (Math.cos(angle) * CELL) / 2,
  };
}

function cellsUnder(grid: ZoneGrid, lot: Lot): ZoneCell[] {
  const reach = ((lot.width + lot.depth) * CELL) / 2 + CELL;
  return cellsNear(grid, lot, reach).filter((cell) => onLot(lot, cell, CELL / 2 - OCCUPIED_OVERLAP));
}

/** Sind alle Zellen, die das Grundstück belegen würde, noch unbebaut? */
export function isLotFree(grid: ZoneGrid, lot: Lot): boolean {
  const cells = cellsUnder(grid, lot);
  return cells.length > 0 && cells.every((cell) => cell.building === null);
}

/** Vermerkt in allen Zellen unter dem Grundstück, dass sie belegt sind. */
export function occupy(grid: ZoneGrid, lot: Lot): void {
  for (const cell of cellsUnder(grid, lot)) cell.building = lot.id;
}

/** Gibt die Zellen eines Grundstücks wieder frei; ihre Zone bleibt. */
export function vacate(grid: ZoneGrid, lot: Lot): void {
  for (const cell of cellsUnder(grid, lot)) {
    if (cell.building === lot.id) cell.building = null;
  }
  grid.version++;
}
