/**
 * Hand-off of a decoded `AudioBuffer` from whoever prepared it to whoever
 * analyses it.
 *
 * Why a module-level registry and not React state or a hook argument: there is a
 * real race. `NavidromePlaybackSource.prepare()` emits `{ isPlaying: false,
 * positionMs: 0 }` — and so writes `playback` into the store — *before* its
 * promise resolves. An effect keyed on `playback.trackId` can therefore run a
 * frame or two before `App.tsx` has the buffer to give it. `waitForPreparedAudio`
 * lets the analysis hook start immediately and block on the buffer's arrival,
 * with no polling and no `setState` in a promise chain.
 *
 * A decoded 4-minute stereo track is ~84 MB, so there is only ever one entry
 * here. Holding it costs nothing extra: `NavidromePlaybackSource` keeps the same
 * `AudioBuffer` object alive for as long as it is the loaded track, and a new
 * `setPreparedAudio` replaces this one. Reads are therefore **non-destructive** —
 * a difficulty change or a cancelled-then-restarted analysis has to be able to
 * pick the same buffer up again, which a take-once registry made impossible.
 */

type Waiter = {
  trackId: string;
  resolve: (buffer: AudioBuffer) => void;
};

let prepared: { trackId: string; buffer: AudioBuffer } | null = null;
const waiters = new Set<Waiter>();

/** Called once the decode finishes, with the track it belongs to. */
export function setPreparedAudio(trackId: string, buffer: AudioBuffer): void {
  prepared = { trackId, buffer };
  for (const waiter of [...waiters]) {
    if (waiter.trackId !== trackId) continue;
    waiters.delete(waiter);
    waiter.resolve(buffer);
  }
}

/** The buffer if it is here, without claiming it. */
export function peekPreparedAudio(trackId: string): AudioBuffer | null {
  return prepared && prepared.trackId === trackId ? prepared.buffer : null;
}

/** Drops the reference — on a failed prepare, or when leaving a round. */
export function clearPreparedAudio(): void {
  prepared = null;
}

export class PreparedAudioAbortedError extends Error {
  constructor() {
    super("Waiting for decoded audio was cancelled");
    this.name = "PreparedAudioAbortedError";
  }
}

/**
 * Resolves with the buffer for `trackId` — immediately if the decode already
 * finished, otherwise when {@link setPreparedAudio} announces it.
 *
 * Rejects with {@link PreparedAudioAbortedError} if `signal` aborts first, which
 * is how a track change cancels a wait that would otherwise never be satisfied
 * (nothing ever announces a track the user has navigated away from).
 */
export function waitForPreparedAudio(
  trackId: string,
  signal?: AbortSignal
): Promise<AudioBuffer> {
  const already = peekPreparedAudio(trackId);
  if (already) return Promise.resolve(already);
  if (signal?.aborted) return Promise.reject(new PreparedAudioAbortedError());

  return new Promise<AudioBuffer>((resolve, reject) => {
    const waiter: Waiter = {
      trackId,
      resolve: (buffer) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(buffer);
      },
    };
    const onAbort = (): void => {
      waiters.delete(waiter);
      reject(new PreparedAudioAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.add(waiter);
  });
}
