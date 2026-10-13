"use client";

import { useEffect } from "react";
import { NoteHighway, registerNoteHighwayPlaybackClock } from "@spotifyhero/note-highway";

/**
 * The desktop app's highway, unchanged. Loaded client-only (`next/dynamic`, `ssr: false`) because
 * it draws to a canvas on rAF and reads `window`/`matchMedia` as it mounts. It reads the chart,
 * phase and settings from the shared game store, and the song clock from the function we register.
 */
export default function Highway({ clock }: { clock: () => number }) {
  useEffect(() => {
    registerNoteHighwayPlaybackClock(clock);
  }, [clock]);
  return (
    <div className="sh-highway__canvas">
      <NoteHighway />
    </div>
  );
}
