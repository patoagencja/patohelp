"use client";

// One level above the client layout: a throw in the header chrome (switcher,
// bell, live stamp) or a cut navigation stream used to land on Next's blank
// "Application error" page, since [clientSlug]/error.tsx only wraps the pages.
export { default } from "./[clientSlug]/error";
