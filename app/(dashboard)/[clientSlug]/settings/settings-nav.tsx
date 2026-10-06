"use client";

import { useEffect, useRef, useState } from "react";

import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/**
 * Jump links for the long settings page. Sticks under the header and marks
 * the section currently on screen, so after a jump (or a long scroll through
 * the notification form) it is obvious where you are. Plain anchors: works
 * without JS, the highlight is the only enhancement.
 */
export function SettingsNav({ links }: { links: Array<{ id: string; label: string }> }) {
  const [active, setActive] = useState(links[0]?.id ?? "");
  const trackRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // A section is "current" once its top passes just under the sticky
      // header + this bar; at the very bottom the last one wins even if it
      // is too short to ever reach that line.
      const line = 150;
      let current = links[0]?.id ?? "";
      for (const l of links) {
        const el = document.getElementById(l.id);
        if (el && el.getBoundingClientRect().top <= line) current = l.id;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && links.length) current = links[links.length - 1].id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [links]);

  // Phones: keep the highlighted pill inside the horizontally scrolling
  // track (scrolls only the track, never the page).
  useEffect(() => {
    const track = trackRef.current;
    const pill = track?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!track || !pill) return;
    // The track is `relative`, so offsetLeft is measured from its edge.
    const left = pill.offsetLeft;
    if (left < track.scrollLeft || left + pill.offsetWidth > track.scrollLeft + track.clientWidth) {
      track.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
    }
  }, [active]);

  return (
    <div
      data-print-hide
      data-present-hide
      className="sticky top-14 z-20 -mx-4 bg-chrome/75 px-4 py-2 backdrop-blur-xl backdrop-saturate-150 sm:-mx-6 sm:px-6 md:top-16"
    >
      <nav ref={trackRef} aria-label="Sekcje ustawień" className={cn(segmentedTrack, "relative")}>
        {links.map((l) => (
          <a
            key={l.id}
            href={`#${l.id}`}
            data-id={l.id}
            aria-current={active === l.id ? "location" : undefined}
            onClick={() => setActive(l.id)}
            className={segmentedItem(active === l.id)}
          >
            {l.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
