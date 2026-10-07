/**
 * The page "sky" (Przeglad-pastel `.sky`): four big blurred pastel blobs
 * drifting slowly (40 s loops), plus a faint dot grid that only shows in
 * dark (--dots is transparent in light). Fixed behind the content of the
 * nearest `isolate` ancestor (the dashboard shell), decorative, hidden in
 * print; reduced motion stops the drift (globals.css).
 *
 * Static radial gradients (no blur filter, no animation): see globals.css
 * .sky-blob for why.
 */
export function Sky() {
  return (
    <div aria-hidden className="sky print:hidden">
      {/* Sized ~ the old blob + 2x its blur radius, so the soft edge reaches
          about as far as the blurred version did. */}
      <span
        className="sky-blob left-[-400px] top-[-460px] h-[980px] w-[1200px]"
        style={{ ["--blob" as string]: "var(--blob1)" }}
      />
      <span
        className="sky-blob right-[-360px] top-[-420px] h-[920px] w-[1020px]"
        style={{ ["--blob" as string]: "var(--blob2)" }}
      />
      <span
        className="sky-blob left-[30%] top-[200px] h-[960px] w-[1080px] opacity-[.55]"
        style={{ ["--blob" as string]: "var(--blob3)" }}
      />
      <span
        className="sky-blob bottom-[-480px] left-[-420px] h-[940px] w-[1140px] opacity-30"
        style={{ ["--blob" as string]: "var(--blob1)" }}
      />
      <span className="sky-dots" />
    </div>
  );
}
