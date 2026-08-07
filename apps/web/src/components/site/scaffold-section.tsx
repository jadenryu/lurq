/**
 * A labelled empty box, so the page can be scrolled and judged for rhythm before
 * the sections that go here are designed.
 *
 * TEMPORARY. These are scaffolding, not a component anyone should build on.
 * Dashed border and a visible label so nobody mistakes one for a finished
 * surface or ships it by accident. Delete this file and its mounts in
 * (marketing)/page.tsx as each real section lands.
 */
export function ScaffoldSection({
  id,
  label,
  note,
  height = 520,
}: {
  id: string;
  label: string;
  note: string;
  height?: number;
}) {
  return (
    <section id={id} className="w-full px-4 py-8 min-[768px]:px-6">
      <div
        style={{ minHeight: height }}
        className="mx-auto flex w-full max-w-[1180px] flex-col items-center justify-center rounded-xl border border-dashed border-edge px-6 text-center"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">{id}</p>
        <p className="mt-3 font-sans text-[20px] font-medium text-ink-2">{label}</p>
        <p className="mt-2 max-w-[46ch] font-mono text-[12px] leading-[1.6] text-ink-3">
          {note}
        </p>
      </div>
    </section>
  );
}
