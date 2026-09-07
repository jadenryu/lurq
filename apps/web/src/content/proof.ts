/**
 * The evidence page: how every number on this site is produced.
 *
 * WHY THERE ARE NO CUSTOMERS ON IT. This page was asked for as "customers and
 * proof". lurq has no named customers, and the honest options were an empty
 * page, an aspirational one, or a different page. This is the different page.
 *
 * A logo wall is a proxy for "other people checked this and it held". It is a
 * proxy because the reader cannot verify any of it: the logos are images, the
 * quotes are unattributable, and the percentages have no method attached. This
 * page skips the proxy and hands over the thing the proxy stands for, which is
 * the method itself and the numbers it produces, in a form a reader can re-run.
 * For a developer audience that trade is not a compromise, it is the better
 * page. It also cannot go stale in the direction of a lie, which a logo wall
 * can the moment a customer leaves.
 *
 * WHAT THIS PAGE MUST KEEP DOING. Every figure is read from generated data.
 * Every limit is stated as a limit rather than softened into a roadmap item. And
 * the "check it yourself" section has to keep working: a page about
 * reproducibility whose commands do not run is the worst thing on the site.
 */
import stats from "@/content/generated/stats.json";

const fmt = (n: number) => n.toLocaleString("en-US");

export const PROOF_HEAD = "Every number on this site, and where it came from.";
export const PROOF_LEAD =
  "There is no logo wall here. lurq has no named customers to put on one, and a logo is a proxy for evidence rather than evidence. What follows is the method, the figures it produces, the parts that do not work yet, and the commands to check any of it without taking our word for it.";

/**
 * The pipeline, as four stages. This is the same story the about page tells in
 * prose and the home page tells as three stages; here it is told as the thing
 * that produces the numbers directly below it, which is the only version that
 * belongs on an evidence page.
 */
export const METHOD = [
  {
    title: "Read from ten public hosts",
    body: "The registry, the download API, the advisory databases, the dependency graph services. Every one of them is named on this page and every one is a host you can query yourself.",
  },
  {
    title: "Score against measurements, not attention",
    body: "Release cadence, issue latency, contributor spread, open advisories, deprecation state. Downloads are one signal among several rather than the ranking.",
  },
  {
    title: "Extract the API from what actually shipped",
    body: "Exported symbols read out of each version's own published files. This is the part with no substitute: a package's real surface is not in its README and not in a model's memory.",
  },
  {
    title: "Record what resolves together",
    body: "Peer ranges, engine floors, and the co-install pairs already observed. A compatibility answer is a lookup against that store rather than an install in a sandbox.",
  },
];

export const INDEX_HEAD = "The index, as of the last crawl.";

export const FIGURES = [
  { value: fmt(stats.packages), label: "packages scored", note: "Every one has a full evidence read behind it." },
  { value: fmt(stats.versionsTracked), label: "versions tracked", note: "Not just latest: the history is what makes a diff possible." },
  { value: fmt(stats.apiSurfaces), label: "API surfaces extracted", note: "Symbol tables read from shipped files." },
  { value: fmt(stats.coOccurrencePairs), label: "co-install pairs", note: "Observed combinations behind a compatibility verdict." },
  { value: String(stats.categories), label: "categories", note: "How a package is placed into a stack layer." },
  { value: String(stats.dataSources), label: "upstream sources", note: "All ten named below." },
];

/**
 * The sync line. `status` is printed verbatim, including when it says `partial`,
 * because a crawl that read 2,358 of 44,091 packages and reports "partial" is
 * the single most useful fact on this page for judging how much to trust the
 * rest of it.
 */
export const SYNC = {
  startedAt: stats.lastSync.startedAt,
  packagesUpdated: fmt(stats.lastSync.packagesUpdated),
  status: stats.lastSync.status,
  syncDays: String(stats.syncDays),
  dataAsOf: stats.dataAsOf,
};

export const STATUS_HEAD = "Freshness, including when it is not fresh.";
export const STATUS_BODY =
  "The crawl runs daily and does not always finish. When it reports partial, it means it read fewer packages than the index holds, and that word is printed here exactly as the pipeline recorded it rather than rounded up into a status badge.";

/**
 * The limits. Stated as limits.
 *
 * Every one of these is already true and already known internally. Writing them
 * down costs nothing we were not already paying and buys the only thing an
 * evidence page can buy, which is that the claims beside them become worth
 * reading. A page with no limits section is a page whose limits the reader has
 * to guess at, and they will guess worse than this.
 */
export const LIMITS_HEAD = "What this does not do.";

export const LIMITS = [
  {
    title: "One ecosystem",
    body: "npm only. Nothing here covers PyPI, crates.io or Go modules today, and a page implying otherwise would be describing a roadmap as a product.",
  },
  {
    title: "Declared metadata, not execution",
    body: "Compatibility is resolved the way npm would resolve it, from declared peer ranges and engines plus recorded co-installs. lurq does not install your stack and does not run package code, so a conflict that only appears at runtime is out of scope.",
  },
  {
    title: "Surface extraction has misses",
    body: "A package whose surface has not been extracted returns UNKNOWN rather than an answer, and queues itself. UNKNOWN never means a symbol is absent, and treating it as absence is the one misreading that would matter.",
  },
  {
    title: "Framework conventions are not symbols",
    body: "File-based routing, config formats and build conventions are not exported symbols, so a surface diff cannot see them. For those, the official migration guide is still the right source.",
  },
  {
    title: "The crawl is not complete every day",
    body: "See the status above. When the last sync reports partial, some packages in the index are older than the date at the top of the page.",
  },
];

export const REPRODUCE_HEAD = "Check any of it yourself.";
export const REPRODUCE_BODY =
  "Nothing on this page needs an account to verify. The first two run against the public registry and are how you would check our existence and freshness claims without us in the loop at all.";

export const REPRODUCE = [
  {
    command: "npm view lurqrun time --json",
    note: "Every published version and its registry timestamp. This is the exact source the changelog is generated from.",
  },
  {
    command: "npx lurqrun verify <package>",
    note: "The existence and health check, run against the live registry rather than the index.",
  },
  {
    command: "npx lurqrun compat <a> <b> <c>",
    note: "Resolve a set the way npm would, and see the peer range behind any conflict it reports.",
  },
];

export const REPORTS_HEAD = "Field reports.";
export const REPORTS_BODY =
  "There are no case studies here yet. When there are, they will name the stack, the version, and the thing that broke, because a case study that cannot be checked is a testimonial with more words. If lurq caught something in your build, or got something wrong, that is the report worth having and it lands in an inbox one of us reads.";
