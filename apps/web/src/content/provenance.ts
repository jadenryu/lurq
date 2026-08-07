/**
 * Where the index gets its numbers, as the hosts it actually reads.
 *
 * WHY THIS SECTION EXISTS. The capability grid claims lurq answers five
 * questions. The next thing a reader wants is "from what", and the page had no
 * answer on it: provenance.json has been generated all along and rendered only
 * in the dashboard guide. This is that answer, and it is the only section on
 * the page whose content is a list of other people's hostnames.
 *
 * Nothing below is typed by hand. The sources, the count and the cycle length
 * are read out of the generated file, so a host added to or dropped from the
 * pipeline changes this section without anyone editing copy, the same rule the
 * hero's version eyebrow follows.
 */
import provenance from "@/content/generated/provenance.json";
import stats from "@/content/generated/stats.json";

export const SOURCES: readonly (typeof provenance.sources)[number][] = provenance.sources;

/**
 * Three rings, dealt round-robin.
 *
 * Round-robin rather than a 3/4/3 split written down: a split has to be kept in
 * step with the source count by hand, and the failure mode when it isn't is a
 * source that silently renders nowhere. `i % 3` puts every source on exactly one
 * ring for any count, which is the property that matters. Reading order is lost,
 * but the rings rotate, so there was never a reading order to lose.
 */
export const RINGS = [0, 1, 2].map((ring) => {
  const sources = SOURCES.filter((_, i) => i % 3 === ring);
  /**
   * Spread across a half turn, not a whole one.
   *
   * This looks wrong until you know the component mirrors every badge to
   * angle + 180. Base angles over 360 would put the mirror straight on top of
   * an existing badge: with four sources at 90° apart, +180 is another badge's
   * seat exactly. Laying the originals out over 180 means the mirrors fill the
   * gaps and the finished ring is evenly spaced all the way round.
   */
  const step = 180 / sources.length;
  return sources.map((source, i) => ({
    source,
    /**
     * Centred in its slot, then the whole ring turned a little per index out.
     * Without that offset all three rings start their run at the same bearing
     * and read as one spoke rather than as three orbits.
     */
    angle: -90 + step * (i + 0.5) + ring * 12,
  }));
});

// ── copy ─────────────────────────────────────────────────────────────────────


/**
 * No count in the headline. The number is data, it belongs in the caption at
 * mono size with the rest of the measured figures, and a headline that says
 * "ten" is one more string to keep in step with the generated file.
 */
export const PROVENANCE_HEAD = "Every answer traces back to a host you can check yourself.";

/**
 * The taxonomy lives in this sentence rather than as labels on the rings.
 *
 * Grouping the chips by what they feed was the other option and it cost a
 * legend, three ring labels that collide with the chips at 9 o'clock, and a
 * mapping keyed by hostname that goes stale the moment the pipeline adds a
 * source. One sentence says the same thing and cannot drift.
 *
 * Accuracy note: the index does compute a score on top of these, so this stops
 * at "traces back to" rather than claiming nothing is derived.
 */
export const PROVENANCE_BODY =
  "Existence and version ranges come straight off the registry. Maintenance is a composite: downloads, release cadence, open issues, the OpenSSF Scorecard. Risk is OSV advisories plus the deprecation flags. The API surface is the odd one out, parsed from each package's shipped types.";

/**
 * The receipt line. Every figure on it is measured.
 *
 * The package count used to sit inside the sphere. It moved here when the globe
 * went back to being half-sunk in the bottom edge: the centre of that circle is
 * off the bottom of the section, so there is no middle left to put type in.
 *
 * `syncDays` USED TO BE HERE AND IT WAS WRONG.
 *
 * The generator computes it as `count(distinct date_trunc('day', started_at))
 * from sync_runs` (scripts/build-landing-content.mts). That is how many separate
 * days a sync has ever run, 21 of them, for all time. This row rendered it as
 * "21d / re-read cycle", which is a different fact entirely: a cycle length is
 * the gap between runs. Anyone who read the query would have caught it, and this
 * is the section whose whole argument is "check us".
 *
 * `dataAsOf` replaces it. The pipeline stamps that date on the rows themselves,
 * so it is both true and the number a reader actually wanted from the slot.
 */
const READ_ON = new Date(stats.dataAsOf).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export const PROVENANCE_STATS = [
  { value: stats.packages.toLocaleString("en-US"), label: "packages indexed" },
  { value: String(SOURCES.length), label: "sources" },
  { value: provenance.versionsTracked.toLocaleString("en-US"), label: "versions tracked" },
  /**
   * "co-install pairs" was wrong twice over and this section cannot afford it.
   *
   * The figure is `select count(*) from compat_edges`, unfiltered. The unique
   * index is (package_a, version_a, package_b, version_b), so a row is a pair of
   * *versions*, not a pair of packages. And `status` is not filtered, so pairs
   * recorded as conflicts, which by definition do not co-install, were being
   * counted as ones that do. The generator's own witness query adds
   * `and status = 'compatible'` for exactly that reason.
   *
   * "graded" is what every row genuinely has in common: it has a verdict.
   */
  { value: provenance.coOccurrencePairs.toLocaleString("en-US"), label: "version pairs graded" },
  { value: READ_ON, label: "last read" },
] as const;
