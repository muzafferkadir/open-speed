/**
 * Lamp placement in model space (metres, Y up, +Z toward the tail). One catalog entry describes
 * the positive-X side; the site list mirrors it across the body so both lamps stay symmetric.
 */
export type LampPlacement = { center: [number, number, number]; size: [number, number]; round?: boolean };

export type LampConfig = { brake?: LampPlacement; reverse?: LampPlacement };

export type LampSites = { brake: LampPlacement[]; reverse: LampPlacement[] };

/** Mirror a placement across X unless it sits on the centre line. */
function mirror(placement: LampPlacement): LampPlacement[] {
 const [x, y, z] = placement.center;
 if (Math.abs(x) < 1e-4) return [placement];
 return [placement, { ...placement, center: [-x, y, z] }];
}

export function lampSites(config: LampConfig | undefined, fallback: LampConfig): LampSites {
 const pick = (key: keyof LampConfig) => config?.[key] ?? fallback[key]!;
 return { brake: mirror(pick('brake')), reverse: mirror(pick('reverse')) };
}
