// Concurrency limiter for paged reads (lib/supabase/fetch-all.ts). Its own
// module, free of React/Next imports, so the lane rules are unit-testable.

export type FetchLane = "foreground" | "background";

export type Release = () => void;

export interface Limiter {
  acquire(lane?: FetchLane): Promise<Release>;
}

/**
 * At most `max` grants at once, of which at most `backgroundMax` background
 * ones. A freed slot goes to the oldest foreground waiter first, then to the
 * oldest background waiter that fits its cap. With foreground work only it
 * is a plain FIFO semaphore.
 */
export function createLimiter(max: number, backgroundMax: number): Limiter {
  let active = 0;
  let backgroundActive = 0;
  const foreground: Array<() => void> = [];
  const background: Array<() => void> = [];
  const pump = () => {
    while (active < max) {
      const next =
        foreground.shift() ??
        (backgroundActive < backgroundMax ? background.shift() : undefined);
      if (!next) return;
      next();
    }
  };
  return {
    acquire(lane: FetchLane = "foreground") {
      return new Promise<Release>((resolve) => {
        const isBackground = lane === "background";
        const grant = () => {
          active += 1;
          if (isBackground) backgroundActive += 1;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active -= 1;
            if (isBackground) backgroundActive -= 1;
            pump();
          });
        };
        (isBackground ? background : foreground).push(grant);
        pump();
      });
    },
  };
}
