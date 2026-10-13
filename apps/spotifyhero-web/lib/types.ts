export type { Chart, Difficulty, Note } from "@spotifyhero/shared-types";

/** Charts are cached per generator; bump either package's version and songs re-chart. */
export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
