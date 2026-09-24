/**
 * The generator's cache-busting version, alone in a module that imports nothing —
 * the same arrangement, and for the same reason, as
 * `@spotifyhero/onset-analysis/version`. Import from
 * `@spotifyhero/chart-generator/version` when all you need is the string.
 */

/**
 * Bump when a change to chart generation would produce different `Note`s for the
 * same `BeatEvent[]` — retuned `DIFFICULTY_PARAMS` included.
 *
 * This is the *package build* identity, deliberately distinct from the
 * descriptive `chart.generatorVersion` (`deterministic-1.x` / `hybrid-ml-x`) that
 * says which path produced a given chart. The cache has to key on the code, not
 * the path: keying on the per-chart string would invalidate every stored hybrid
 * chart whenever it was compared against the deterministic constant.
 */
export const CHART_GENERATOR_VERSION = "chart-gen-2";

/** Descriptive version stamped onto charts from the deterministic path. */
export const DETERMINISTIC_GENERATOR_VERSION = "deterministic-1.10";
