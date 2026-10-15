export type Random = {
  next: () => number;
  int: (minInclusive: number, maxInclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
};

/**
 * Seeded mulberry32 generator. Generated fixtures must be byte-identical across runs and
 * machines, so nothing in the generators may use `Math.random()`.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (minInclusive: number, maxInclusive: number): number =>
    minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty list.");
    }

    return items[int(0, items.length - 1)]!;
  };

  return { next, int, pick };
}
