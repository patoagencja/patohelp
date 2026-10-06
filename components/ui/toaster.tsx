"use client";

import { Toaster as Sonner } from "sonner";

/**
 * App-wide toasts in the v2 skin: the dark rounded tooltip card (styled in
 * app/globals.css, "Toasts") with a coloured status icon. Offsets keep the
 * stack clear of the sticky header (desktop) and of the phone's top edge.
 * No richColors: a green/red slab per toast is louder than the news.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      theme="dark"
      gap={10}
      offset={{ top: 76, right: 20 }}
      mobileOffset={{ top: 64, left: 12, right: 12 }}
    />
  );
}
