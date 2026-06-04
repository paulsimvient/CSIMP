/** Deterministic pseudo-random from string (stable per contact). */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type ContactKinematics = {
  moving: boolean;
  headingDeg: number;
  speedKts: number;
};

export function contactKinematics(factId: string): ContactKinematics {
  const h = hashString(factId);
  const moving = h % 5 !== 0;
  const headingDeg = h % 360;
  const speedKts = 12 + (hashString(`${factId}-spd`) % 48);
  return { moving, headingDeg, speedKts };
}
