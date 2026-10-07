import { cn } from "@/lib/utils";
import { snowflakes } from "@/lib/season/festive";

const PAGE_FLAKES = snowflakes(34);

/**
 * Snow falling across the whole dashboard of a Christmas-season client
 * (Elfi), in a fixed layer IN FRONT of the content: animation under the
 * frosted cards would make every one of them re-blur its backdrop each frame
 * (see .sky-blob in globals.css) and scrolling stutters. Small, translucent,
 * never catches a click; transform-only. Off for reduced motion, in print
 * and on the TV (presentation mode).
 */
export function Snowfall({ className }: { className?: string }) {
  return (
    <div aria-hidden data-present-hide className={cn("snowfall snowfall-page print:hidden", className)}>
      {PAGE_FLAKES.map((f, i) => (
        <span
          key={i}
          className="snowflake"
          style={
            {
              left: `${f.left}%`,
              width: `${f.size}px`,
              height: `${f.size}px`,
              opacity: f.opacity,
              animationDuration: `${f.duration}s`,
              animationDelay: `${f.delay}s`,
              "--drift": `${f.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Santa hat that sits on the first letter of a heading. */
export function SantaHat({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 64 52" className={cn("santa-hat", className)}>
      {/* the hat, tip flopping to the right */}
      <path
        className="santa-hat-red"
        d="M8 40 C 10 22, 22 6, 38 6 C 48 6, 56 12, 58 24 C 52 18, 46 17, 42 20 C 46 26, 48 33, 50 40 Z"
      />
      {/* fur brim and pompom */}
      <rect className="santa-hat-fur" x="4" y="37" width="50" height="11" rx="5.5" />
      <circle className="santa-hat-fur" cx="57" cy="26" r="6" />
    </svg>
  );
}
