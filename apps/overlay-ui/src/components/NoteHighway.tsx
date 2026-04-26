/**
 * Re-export NoteHighway from the @spotifyhero/note-highway package and
 * register the calibrated playback clock used by the highway's render loop.
 *
 * All components inside overlay-ui continue to import NoteHighway from this
 * file — the path is unchanged.
 */
export { NoteHighway } from "@spotifyhero/note-highway";

import { registerNoteHighwayPlaybackClock } from "@spotifyhero/note-highway";
import { calibratedPlaybackMs } from "../lib/playbackPosition.js";

// Register the playback clock once at module load time.
registerNoteHighwayPlaybackClock(calibratedPlaybackMs);
