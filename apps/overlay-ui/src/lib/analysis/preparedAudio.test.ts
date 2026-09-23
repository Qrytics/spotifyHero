import { describe, it, expect, beforeEach } from "vitest";
import {
  clearPreparedAudio,
  peekPreparedAudio,
  PreparedAudioAbortedError,
  setPreparedAudio,
  waitForPreparedAudio,
} from "./preparedAudio.js";

/**
 * The registry only ever stores and compares the buffer by identity, so a
 * labelled stand-in is enough — constructing a real `AudioBuffer` would need an
 * `AudioContext`, which node does not have.
 */
function fakeBuffer(label: string): AudioBuffer {
  return { label } as unknown as AudioBuffer;
}

beforeEach(() => {
  clearPreparedAudio();
});

describe("preparedAudio", () => {
  it("resolves immediately when the decode already finished", async () => {
    const buffer = fakeBuffer("a");
    setPreparedAudio("nd:a", buffer);
    await expect(waitForPreparedAudio("nd:a")).resolves.toBe(buffer);
  });

  it("resolves a waiter registered before the decode finished", async () => {
    // The race the registry exists for: the analysis hook runs first because
    // `prepare()` writes `playback` into the store before it resolves.
    const pending = waitForPreparedAudio("nd:a");
    const buffer = fakeBuffer("a");
    setPreparedAudio("nd:a", buffer);
    await expect(pending).resolves.toBe(buffer);
  });

  it("does not consume the buffer, so a second read still hits", async () => {
    // A difficulty change re-runs the pipeline against the same loaded track.
    const buffer = fakeBuffer("a");
    setPreparedAudio("nd:a", buffer);
    await expect(waitForPreparedAudio("nd:a")).resolves.toBe(buffer);
    await expect(waitForPreparedAudio("nd:a")).resolves.toBe(buffer);
    expect(peekPreparedAudio("nd:a")).toBe(buffer);
  });

  it("ignores a buffer announced for a different track", async () => {
    let settled = false;
    const pending = waitForPreparedAudio("nd:a").finally(() => {
      settled = true;
    });

    setPreparedAudio("nd:b", fakeBuffer("b"));
    // A macrotask, so every microtask a resolution would have queued has run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(peekPreparedAudio("nd:a")).toBeNull();

    const wanted = fakeBuffer("a");
    setPreparedAudio("nd:a", wanted);
    await expect(pending).resolves.toBe(wanted);
  });

  it("rejects on abort, and on a signal that is already aborted", async () => {
    const controller = new AbortController();
    const pending = waitForPreparedAudio("nd:a", controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(PreparedAudioAbortedError);

    await expect(
      waitForPreparedAudio("nd:a", AbortSignal.abort())
    ).rejects.toBeInstanceOf(PreparedAudioAbortedError);
  });

  it("prefers an already-prepared buffer over an aborted signal", async () => {
    // Order matters: the fast path runs first, so a track that is already
    // decoded is handed over even if the caller's signal has since aborted.
    const buffer = fakeBuffer("a");
    setPreparedAudio("nd:a", buffer);
    await expect(
      waitForPreparedAudio("nd:a", AbortSignal.abort())
    ).resolves.toBe(buffer);
  });

  it("forgets the buffer on clear", () => {
    setPreparedAudio("nd:a", fakeBuffer("a"));
    clearPreparedAudio();
    expect(peekPreparedAudio("nd:a")).toBeNull();
  });
});
