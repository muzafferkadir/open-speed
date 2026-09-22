// Maps are fetched, not imported: a plan is a few hundred KB and only one is ever in play.

import type { RoadPropsFile } from './types.js';
import type { OvalTrack } from '../physics/OvalWorld.ts';
import type { RoadTrack } from '../physics/RoadWorld.ts';

/** Start-tab copy for a map: the event card and its four fact rows. */
export type MapStartCopy = { kicker: string; title: string; lede: string; photo: [string, string]; facts: [string, string][]; button: string };
export type MapEntry = {
 id: string; name: string; description: string; file: string; kind: 'oval' | 'road';
 kicker: string; mode: string; terrain: string; layout: string; start: MapStartCopy;
};
export type GameMap = OvalTrack | RoadTrack;
export const isOval = (map: GameMap): map is OvalTrack => (map as OvalTrack).kind === 'oval';
/** A route built from source track data: centre line, surface frame and limits. */
export const isRoad = (map: GameMap): map is RoadTrack => (map as RoadTrack).kind === 'road';

const json = async <T>(url: string): Promise<T> => {
 const response = await fetch(url);
 if (!response.ok) throw new Error(`Map load failed: ${url} — ${response.status}`);
 return response.json() as Promise<T>;
};

export const loadMapIndex = () => json<MapEntry[]>('/maps/index.json');

/**
 * Road maps carry their replacement prop stands as an extra Map JSON, next to the
 * map itself, so only a race over that track ever pays for the prop kit. The URL is derived from
 * the map id rather than listed in the index, which keeps the index free of per-map assets.
 */
export const loadRoadProps = (id: string) => json<RoadPropsFile>(`/maps/${id}-props.json`);

export async function loadMap(id: string): Promise<GameMap> {
 const map = await json<GameMap>(`/maps/${id}.json`);
 if (!isOval(map) && !isRoad(map)) throw new Error(`Map ${id}: not an oval or a road track`);
 return map;
}
