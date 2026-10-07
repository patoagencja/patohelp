"use client";

import { useEffect, useRef, useState } from "react";
import { Flower2, Volume2, VolumeX } from "lucide-react";

import { cn } from "@/lib/utils";

import { startZenAudio, type ZenAudio } from "./zen-audio";

/**
 * "Tryb zen" for the login page: a Bali sunset with a meditating Buddha and
 * ambient music. Off by default; the music starts only from the switch
 * click (browsers block audio without a gesture) and stops when it is
 * turned off or the page is left.
 */
export function useZenMode() {
  const [zen, setZen] = useState(false);
  const [muted, setMuted] = useState(false);
  const audio = useRef<ZenAudio | null>(null);

  useEffect(() => () => audio.current?.stop(), []);

  function toggleZen() {
    if (zen) {
      audio.current?.stop();
      audio.current = null;
      setZen(false);
      return;
    }
    audio.current = startZenAudio();
    audio.current?.setMuted(muted);
    setZen(true);
  }

  function toggleMuted() {
    const next = !muted;
    audio.current?.setMuted(next);
    setMuted(next);
  }

  return { zen, muted, toggleZen, toggleMuted };
}

export function ZenControls({
  zen,
  muted,
  onToggleZen,
  onToggleMuted,
}: {
  zen: boolean;
  muted: boolean;
  onToggleZen: () => void;
  onToggleMuted: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-4 z-10 flex justify-center gap-2 px-4">
      <button
        type="button"
        role="switch"
        aria-checked={zen}
        onClick={onToggleZen}
        className="glass flex h-11 items-center gap-2.5 rounded-full pl-4 pr-1.5 text-sm font-medium transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[.97] motion-reduce:active:scale-100"
      >
        <Flower2 className="h-4 w-4 text-ink-2" aria-hidden />
        Tryb zen
        <span
          aria-hidden
          className={cn(
            "relative h-7 w-12 rounded-full transition-colors",
            zen ? "bg-anchor" : "bg-[var(--chip-hover)]"
          )}
        >
          <span
            className={cn(
              "absolute left-1 top-1 h-5 w-5 rounded-full bg-card shadow transition-transform",
              zen && "translate-x-5 bg-anchor-dot"
            )}
          />
        </span>
      </button>
      {zen ? (
        <button
          type="button"
          onClick={onToggleMuted}
          aria-pressed={!muted}
          aria-label={muted ? "Włącz muzykę" : "Wycisz muzykę"}
          title={muted ? "Włącz muzykę" : "Wycisz muzykę"}
          className="glass grid h-11 w-11 place-items-center rounded-full animate-rise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
      ) : null}
    </div>
  );
}

const TERRACES = [
  "M0 722Q400 690 800 716T1600 704V900H0Z",
  "M0 772Q420 742 820 768T1600 756V900H0Z",
  "M0 822Q380 796 800 818T1600 808V900H0Z",
  "M0 866Q400 846 800 862T1600 854V900H0Z",
];

/** The scene, fixed behind the login cards (inside the `isolate` main). */
export function ZenScene() {
  return (
    <div aria-hidden className="zen-scene pointer-events-none fixed inset-0 -z-10 overflow-hidden animate-fade [--d:0s] print:hidden">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="zen-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--zen-sky-1)" />
            <stop offset=".45" stopColor="var(--zen-sky-2)" />
            <stop offset=".72" stopColor="var(--zen-sky-3)" />
            <stop offset=".8" stopColor="var(--zen-sky-4)" />
          </linearGradient>
          <radialGradient id="zen-sun">
            <stop offset="0" stopColor="var(--zen-sun)" />
            <stop offset=".35" stopColor="var(--zen-sun)" stopOpacity=".9" />
            <stop offset="1" stopColor="var(--zen-sun)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#zen-sky)" />
        <g fill="var(--zen-star)">
          {[
            [120, 60], [310, 130], [520, 40], [700, 110], [960, 70], [1130, 140], [1300, 50], [1480, 120], [240, 210], [1420, 230],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.8 : 1.2} className="zen-twinkle" style={{ animationDelay: `${i * 0.7}s` }} />
          ))}
        </g>
        <circle cx="800" cy="600" r="260" fill="url(#zen-sun)" className="zen-breathe" />
        <circle cx="800" cy="600" r="88" fill="var(--zen-sun)" />
        <g fill="var(--zen-cloud)" className="zen-drift">
          <ellipse cx="300" cy="300" rx="190" ry="14" />
          <ellipse cx="380" cy="318" rx="120" ry="9" />
          <ellipse cx="1180" cy="250" rx="230" ry="15" />
          <ellipse cx="1080" cy="270" rx="110" ry="8" />
          <ellipse cx="760" cy="420" rx="160" ry="10" />
        </g>
        <path
          d="M1020 260l14 8 14-8M1060 240l10 6 10-6M990 290l9 5 9-5"
          fill="none"
          stroke="var(--zen-silhouette)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity=".6"
        />
        {/* Gunung Agung on the left, a lower ridge across. */}
        <path d="M0 650L260 610L520 480Q560 456 600 480L880 618L1600 640V900H0Z" fill="var(--zen-mount-far)" />
        <path d="M0 690Q220 640 440 676T900 668T1320 648T1600 676V900H0Z" fill="var(--zen-mount-near)" />
        {TERRACES.map((d, i) => (
          <path key={d} d={d} fill={`var(--zen-terrace-${i + 1})`} />
        ))}
        {/* Water in the paddies catching the sun. */}
        <g fill="none" stroke="var(--zen-sun)" strokeLinecap="round" opacity=".45">
          <path d="M520 742Q700 728 880 738" strokeWidth="2" />
          <path d="M600 792Q760 780 960 790" strokeWidth="2" />
          <path d="M660 840Q800 832 940 838" strokeWidth="1.5" />
        </g>
      </svg>

      <Buddha className="absolute bottom-[2vh] left-[4vw] h-[26vh] max-h-[440px] md:h-[40vh]" />
      <Palm className="zen-sway absolute bottom-[-2vh] right-[-3vw] h-[62vh] md:h-[78vh]" />
      <Palm className="zen-sway absolute bottom-[-2vh] right-[9vw] hidden h-[48vh] -scale-x-100 [animation-delay:-3s] md:block" />
    </div>
  );
}

function Buddha({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 230" className={className}>
      <defs>
        <radialGradient id="zen-halo">
          <stop offset="0" stopColor="var(--zen-sun)" stopOpacity=".95" />
          <stop offset=".55" stopColor="var(--zen-sun)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--zen-sun)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="48" r="58" fill="url(#zen-halo)" className="zen-breathe" />
      {/* evenodd: the two gaps between arms and torso are holes in the body. */}
      <g fill="var(--zen-silhouette)" fillRule="evenodd">
        <circle cx="100" cy="20" r="7.5" />
        <ellipse cx="100" cy="42" rx="15" ry="18" />
        <path d="M84 38C82 44 82 56 86 62L89 52ZM116 38C118 44 118 56 114 62L111 52Z" />
        <path d="M93 56H107V68H93Z" />
        <path d="M93 64C80 66 66 70 60 80C53 91 52 106 50 122C48 140 44 152 38 162C28 172 18 182 18 194C18 206 44 211 100 211C156 211 182 206 182 194C182 182 172 172 162 162C156 152 152 140 150 122C148 106 147 91 140 80C134 70 120 66 107 64ZM66 116C62 132 62 150 70 162C75 152 74 132 66 116ZM134 116C138 132 138 150 130 162C125 152 126 132 134 116Z" />
        {/* Lotus seat */}
        <path d="M6 216Q28 200 54 210Q76 194 100 208Q124 194 146 210Q172 200 194 216Q100 234 6 216Z" />
      </g>
      {/* Robe drape, hands and folded legs: faint warm edges so the pose reads. */}
      <g fill="none" stroke="var(--zen-sun)" strokeLinecap="round" strokeOpacity=".35" strokeWidth="2">
        <path d="M74 74Q96 108 128 158" />
        <path d="M72 170Q100 186 128 170" />
        <path d="M30 196Q100 182 170 196" />
      </g>
    </svg>
  );
}

function Palm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 600" className={cn("origin-bottom", className)}>
      <g fill="var(--zen-silhouette)">
        <path d="M156 600C146 450 138 300 182 150L194 154C158 300 168 450 176 600Z" />
        <path d="M188 150Q120 108 34 150Q118 124 186 160Z" />
        <path d="M188 150Q140 66 66 58Q140 88 184 158Z" />
        <path d="M188 150Q196 58 250 26Q210 80 192 156Z" />
        <path d="M188 150Q262 86 300 118Q250 110 194 158Z" />
        <path d="M188 150Q254 160 292 236Q240 176 190 160Z" />
        <path d="M188 150Q118 168 76 244Q128 182 186 160Z" />
        <circle cx="182" cy="164" r="7" />
        <circle cx="194" cy="166" r="6" />
      </g>
    </svg>
  );
}
