import { Color, Group, Mesh, MeshLambertMaterial } from 'three';
import { ROAD_TYPES, SIDEWALK_WIDTH } from '../config/roads';
import { pointAt } from '../sim/roads/geometry';
import { nodeOf, segmentOf, shapeOf, type RoadNetwork, type RoadNode, type RoadSegment } from '../sim/roads/graph';
import type { Vec2 } from '../util/vec2';
import { RibbonBuilder } from './ribbon';

const SIDEWALK = new Color(0xb9b8b0);
const ASPHALT = new Color(0x3b3e44);
const CENTER_LINE = new Color(0xe6c964);
const LANE_LINE = new Color(0xdcdcd4);

// Schichten knapp übereinander: der Asphalt überdeckt an Kreuzungen die Gehwege der Querstraße.
const Y_SIDEWALK = 0.12;
const Y_ASPHALT = 0.16;
const Y_MARKING = 0.2;

/**
 * Kantenlänge einer Kachel in Metern. Alle Straßen einer Kachel bilden ein einziges Mesh: das hält die Zahl
 * der Zeichenaufrufe auch in großen Städten klein, und beim Bauen entsteht nur die betroffene Kachel neu.
 */
const TILE = 250;

interface Tile {
  mesh: Mesh;
  /** Beschreibt alles, wovon die Geometrie abhängt; ändert es sich, wird die Kachel neu gebaut. */
  key: string;
}

/** Was in einer Kachel liegt. */
interface Content {
  key: string;
  segments: { segment: RoadSegment; trimFrom: number; trimTo: number }[];
  nodes: { node: RoadNode; radius: number }[];
}

/** Hält die 3D-Darstellung des Straßennetzes aktuell. */
export class RoadView {
  readonly group = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly tiles = new Map<string, Tile>();
  /** Segmente, die schon gezeichnet sind. */
  private known = new Set<number>();

  /** Gleicht die Darstellung mit dem Netz ab und liefert die neu hinzugekommenen Segmente. */
  sync(net: RoadNetwork): RoadSegment[] {
    const added = [...net.segments.values()].filter((segment) => !this.known.has(segment.id));
    this.known = new Set(net.segments.keys());

    // Jedes Segment gehört zur Kachel seiner Mitte, jeder Knoten zur Kachel seines Punkts.
    const contents = new Map<string, Content>();
    const contentAt = (p: Vec2): Content => {
      const id = `${Math.floor(p.x / TILE)}|${Math.floor(p.z / TILE)}`;
      let content = contents.get(id);
      if (!content) contents.set(id, (content = { key: '', segments: [], nodes: [] }));
      return content;
    };
    for (const segment of net.segments.values()) {
      const line = shapeOf(net, segment);
      const trimFrom = markingTrim(net, segment.from);
      const trimTo = markingTrim(net, segment.to);
      const content = contentAt(pointAt(line, line.length / 2));
      content.segments.push({ segment, trimFrom, trimTo });
      content.key += `s${segment.id}:${segment.from}:${segment.to}:${segment.type}:${trimFrom}:${trimTo};`;
    }
    for (const node of net.nodes.values()) {
      const radius = widestHalfWidth(net, node.id);
      const content = contentAt(node);
      content.nodes.push({ node, radius });
      content.key += `n${node.id}:${radius};`;
    }

    for (const [id, tile] of this.tiles) {
      if (contents.has(id)) continue;
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      this.tiles.delete(id);
    }
    for (const [id, content] of contents) {
      const tile = this.tiles.get(id);
      if (tile?.key === content.key) continue;
      const geometry = tileGeometry(net, content);
      if (tile) {
        tile.mesh.geometry.dispose();
        tile.mesh.geometry = geometry;
        tile.key = content.key;
      } else {
        const mesh = new Mesh(geometry, this.material);
        this.group.add(mesh);
        this.tiles.set(id, { mesh, key: content.key });
      }
    }
    return added;
  }
}

function widestHalfWidth(net: RoadNetwork, nodeId: number): number {
  let widest = 0;
  for (const id of nodeOf(net, nodeId).segments) {
    widest = Math.max(widest, ROAD_TYPES[segmentOf(net, id).type].width / 2);
  }
  return widest;
}

/** An Kreuzungen (drei oder mehr Arme) enden die Markierungen vor der Kreuzungsfläche. */
function markingTrim(net: RoadNetwork, nodeId: number): number {
  return nodeOf(net, nodeId).segments.length >= 3 ? widestHalfWidth(net, nodeId) + 1 : 0;
}

function tileGeometry(net: RoadNetwork, content: Content) {
  const builder = new RibbonBuilder();
  for (const { segment, trimFrom, trimTo } of content.segments) addSegment(builder, net, segment, trimFrom, trimTo);
  for (const { node, radius } of content.nodes) {
    // Scheiben füllen Lücken an Knicken, runden Sackgassen ab und bilden die Gehwegecken an Kreuzungen.
    builder.disc(node, radius, Y_SIDEWALK, SIDEWALK).disc(node, radius - SIDEWALK_WIDTH, Y_ASPHALT, ASPHALT);
  }
  return builder.build();
}

function addSegment(builder: RibbonBuilder, net: RoadNetwork, segment: RoadSegment, trimFrom: number, trimTo: number): void {
  const line = shapeOf(net, segment);
  const type = ROAD_TYPES[segment.type];
  const halfWidth = type.width / 2;
  const asphaltHalf = halfWidth - SIDEWALK_WIDTH;

  builder
    .strip(line, 0, line.length, halfWidth, Y_SIDEWALK, SIDEWALK)
    .strip(line, 0, line.length, asphaltHalf, Y_ASPHALT, ASPHALT);

  // Linien zwischen den Fahrspuren; die mittlere trennt die Fahrtrichtungen.
  const laneWidth = (asphaltHalf * 2) / type.lanes;
  for (let i = 1; i < type.lanes; i++) {
    const isCenter = i * 2 === type.lanes;
    builder.strip(
      line,
      trimFrom,
      line.length - trimTo,
      isCenter ? 0.2 : 0.12,
      Y_MARKING,
      isCenter ? CENTER_LINE : LANE_LINE,
      (i - type.lanes / 2) * laneWidth,
    );
  }
}
