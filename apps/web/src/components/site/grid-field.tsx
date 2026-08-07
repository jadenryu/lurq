import { DependencyGraph } from "@/components/site/dependency-graph";

/**
 * The background, as a drawing rather than a photograph.
 *
 * `section` is a dot matrix and one grain tile — paper, and nothing on it.
 * `hero` draws the dependency graph on that paper and is the only variant with
 * motion: one pulse walking the graph, gone under prefers-reduced-motion.
 *
 * The scan bands that used to be the hero's motion are gone. They lit the dots
 * as they passed, which was a nice trick about the matrix and said nothing
 * about the product; the traversal says the same thing about movement and also
 * means something.
 *
 * The section mounting this needs `position: relative` and content above z-0.
 */
export function GridField({
  variant = "section",
}: {
  /** `hero` carries the graph; `section` is paper only. */
  variant?: "hero" | "section";
}) {
  return (
    <div aria-hidden className="room-field" data-variant={variant}>
      <div className="room-field-dots" />
      {variant === "hero" ? <DependencyGraph /> : null}
      <div className="room-field-grain" />
    </div>
  );
}

/**
 * A hatched band, for the seam between two sections. Borrowed from the language
 * of a technical drawing, where hatching means "this area is cut through" rather
 * than "this area is decorated".
 */
export function HatchBand() {
  return <div aria-hidden className="room-hatch" />;
}
