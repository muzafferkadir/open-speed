// Map contract shared by the track layer: one JSON file per map under assets/maps/, listed in
// assets/maps/index.json. In game space +X is right, +Z is back, -Z is forward (the car faces -Z).

/** A smooth road centre-line: ordered [x, z] points in meters, plus its drivable width. */
export type RoadLine = {
 pts: [number, number][];
 width: number;
};

/** Real scenery stand of a road map's own cut-out sprites: one model per kind, one point per stand. */
export type RoadProp = {
 /** Scenery model drawn at every point, one instance each. */
 model: string;
 /** Base position and card height in metres (`[x, y, z, h]`, world space); h scales a height-1 model. */
 points: [number, number, number, number][];
};

/**
 * Sidecar of a road map built from source track data (`assets/maps/<id>-props.json`,
 * written by scripts/extract-track.mjs --props). It replaces the track's flat cut-out scenery
 * cards with real models: `replaced` lists the QFS texNumbers whose source cards are dropped from
 * the track GLB, so nothing is drawn twice, and `stands` says what to plant where.
 */
export type RoadPropsFile = {
 schema: 1;
 /** QFS texNumbers of the source cards this sidecar stands in for. */
 replaced: number[];
 /** Real models replacing the dropped cards. */
 stands: RoadProp[];
};
