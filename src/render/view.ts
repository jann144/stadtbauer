import { Color, DirectionalLight, Fog, HemisphereLight, Scene, WebGLRenderer } from 'three';
import { ROAD_TYPES } from '../config/roads';
import { GRAPHICS, WORLD } from '../config/settings';
import type { Building, ServiceBuilding } from '../sim/buildings';
import { shapeOf, type RoadNetwork } from '../sim/roads/graph';
import type { Car } from '../sim/traffic/traffic';
import type { ZoneGrid } from '../sim/zoning/cells';
import { BuildingView } from './buildings';
import { CarView } from './cars';
import type { CameraRig } from './cameraRig';
import { BrushRing, HeatOverlay, PointMarkers, RibbonOverlay, StretchOverlay } from './overlay';
import { RoadView } from './roads';
import { createGround, Trees } from './terrain';
import { ZoneView } from './zones';

/** Abstand in Metern, den Bäume vom Straßenrand halten. */
const TREE_CLEARANCE = 3;

/** Zeichnet die Spielwelt auf das Canvas. */
export class GameView {
  readonly scene = new Scene();
  /** Bauvorschau, gesetzte Punkte und Pinsel des aktiven Werkzeugs. */
  readonly overlay = new RibbonOverlay();
  readonly markers = new PointMarkers();
  readonly brush = new BrushRing();
  /** Einzugsbereich des Dienstes, der gerade gebaut wird. */
  readonly coverage = new StretchOverlay(0x7ddc8a);
  /** Verkehrsansicht: Straßen nach Auslastung eingefärbt. */
  readonly heat = new HeatOverlay();

  private readonly renderer: WebGLRenderer;
  private readonly roads = new RoadView();
  private readonly zones = new ZoneView();
  private readonly buildings = new BuildingView();
  private readonly cars = new CarView();
  private readonly trees = new Trees();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rig: CameraRig,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });

    const sky = new Color(GRAPHICS.skyColor);
    this.scene.background = sky;
    // Dunst verdeckt den Rand des Umlands.
    this.scene.fog = new Fog(sky, 2500, 9000);

    const sun = new DirectionalLight(0xfff1d8, 2.4);
    sun.position.set(0.55, 1, 0.35);
    this.scene.add(new HemisphereLight(0xd4e9ff, 0x5c6b40, 1.3), sun);

    this.scene.add(
      createGround(this.renderer.capabilities.getMaxAnisotropy()),
      this.trees.group,
      this.zones.group,
      this.roads.group,
      this.buildings.group,
      this.heat.mesh,
      this.cars.group,
      this.coverage.mesh,
      this.overlay.mesh,
      this.markers.group,
      this.brush.mesh,
    );
    this.resize();
  }

  /** Passt Auflösung und Seitenverhältnis an die aktuelle Größe des Canvas an. */
  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    // Die Pixeldichte ändert sich beim Zoomen im Browser oder beim Wechsel auf einen anderen Bildschirm.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / height);
  }

  /** Übernimmt Änderungen am Straßennetz in die Darstellung. */
  syncRoads(net: RoadNetwork): void {
    for (const segment of this.roads.sync(net)) {
      this.trees.clearAlong(shapeOf(net, segment), ROAD_TYPES[segment.type].width / 2 + TREE_CLEARANCE);
    }
  }

  /** Zeigt die freien Zonenzellen: mit `showAll` alle, sonst nur die mit einer Zone. */
  syncZones(grid: ZoneGrid, showAll: boolean): void {
    this.zones.sync(grid, showAll);
  }

  syncBuildings(buildings: ReadonlyMap<number, Building>, services: ReadonlyMap<number, ServiceBuilding>): void {
    for (const lot of this.buildings.sync(buildings, services)) {
      const reach = (Math.hypot(lot.width, lot.depth) * WORLD.cellSize) / 2;
      this.trees.clearAround(lot, reach);
    }
  }

  /** Setzt die Autos an ihre Stellen; `blend` blendet zwischen vorigem und jetzigem Simulationsschritt. */
  syncCars(cars: readonly Car[], blend: number): void {
    this.cars.sync(cars, blend);
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }
}
