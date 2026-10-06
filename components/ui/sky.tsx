/**
 * The page "sky" (Przeglad-pastel `.sky`): four big blurred pastel blobs
 * drifting slowly (40 s loops), plus a faint dot grid that only shows in
 * dark (--dots is transparent in light). Fixed behind the content of the
 * nearest `isolate` ancestor (the dashboard shell), decorative, hidden in
 * print; reduced motion stops the drift (globals.css).
 *
 * The blobs are transform-animated and will-change'd, so the 110px blur is
 * rasterised once and only composited afterwards.
 */
export function Sky() {
  return (
    <div aria-hidden className="sky print:hidden">
      <span
        className="sky-blob left-[-180px] top-[-240px] h-[540px] w-[760px]"
        style={{ background: "var(--blob1)" }}
      />
      <span
        className="sky-blob right-[-140px] top-[-200px] h-[480px] w-[580px]"
        style={{ background: "var(--blob2)", animationDuration: "32s", animationDelay: "-8s" }}
      />
      <span
        className="sky-blob left-[36%] top-[420px] h-[520px] w-[640px] opacity-[.55]"
        style={{ background: "var(--blob3)", animationDuration: "38s", animationDelay: "-14s" }}
      />
      <span
        className="sky-blob bottom-[-260px] left-[-200px] h-[500px] w-[700px] opacity-30"
        style={{ background: "var(--blob1)", animationDuration: "44s" }}
      />
      <span className="sky-dots" />
    </div>
  );
}
