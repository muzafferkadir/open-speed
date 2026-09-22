export type ScreenProfile = 'compact' | 'standard' | 'wide';

const PROFILE_ASPECT: Record<ScreenProfile, number> = {
 compact: 4 / 3,
 standard: 16 / 9,
 wide: 20 / 9,
};

/** Selects a stable composition profile and preserves its horizontal framing. */
export const screenProfile = (aspect: number): ScreenProfile =>
 aspect < 1.5 ? 'compact' : aspect < 1.95 ? 'standard' : 'wide';

export const profileFov = (baseFov: number, aspect: number): number => {
 const referenceAspect = PROFILE_ASPECT[screenProfile(aspect)];
 const vertical = Math.tan(THREE_DEG_TO_RAD * baseFov / 2) * referenceAspect / Math.max(aspect, .01);
 return Math.atan(vertical) * 2 / THREE_DEG_TO_RAD;
};

const THREE_DEG_TO_RAD = Math.PI / 180;
