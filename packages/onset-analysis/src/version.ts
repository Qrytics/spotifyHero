/**
 * The analyser's cache-busting version, alone in a module that imports nothing.
 *
 * Its own file, and its own `./version` subpath in `package.json`, because the
 * cache and the diagnostics panel need this string but must **not** pull the DSP
 * into the main bundle chunk: a module that is both statically imported (for a
 * constant) and dynamically imported (`analyzeAudioBuffer`'s main-thread
 * fallback) is merged into the importer's chunk by Rollup. Import from
 * `@spotifyhero/onset-analysis/version`, never from the package root, unless you
 * are already paying for the analyser.
 */

/**
 * Bump when a change to the analysis pipeline would produce different
 * `BeatEvent`s for the same audio — retuned constants included. Callers that
 * persist charts key on it, so forgetting the bump means yesterday's chart is
 * replayed by today's analyser.
 */
export const ONSET_ANALYSIS_VERSION = "onset-1";
