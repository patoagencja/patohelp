// Christmas touches for seasons that run through Christmas Eve (Elfi:
// 1 October - 24 December). Import-free so it can be unit tested directly.

const WIGILIA = "12-24";

/** The season window (ISO dates) contains Christmas Eve. */
export function coversWigilia(window: { start: string; end: string }): boolean {
  const startYear = Number(window.start.slice(0, 4));
  const endYear = Number(window.end.slice(0, 4));
  for (let y = startYear; y <= endYear; y += 1) {
    const eve = `${y}-${WIGILIA}`;
    if (eve >= window.start && eve <= window.end) return true;
  }
  return false;
}

/**
 * Deterministic flakes (same markup on server and client, nothing random at
 * render): horizontal position, size, fall time, start offset, sideways drift
 * and opacity per flake.
 */
export function snowflakes(count: number) {
  const rand = (i: number, salt: number) => {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return Array.from({ length: count }, (_, i) => ({
    left: Math.round(rand(i, 1) * 1000) / 10,
    // Small and faint: flakes drift over numbers too, and must never make
    // one harder to read.
    size: Math.round((2.5 + rand(i, 2) * 3) * 10) / 10,
    duration: Math.round(11 + rand(i, 3) * 12),
    delay: -Math.round(rand(i, 4) * 23),
    drift: Math.round((rand(i, 5) - 0.5) * 70),
    opacity: Math.round((0.25 + rand(i, 6) * 0.35) * 100) / 100,
  }));
}
