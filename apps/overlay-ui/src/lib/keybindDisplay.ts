/** Normalize keys for comparison with KeyboardEvent (Space is special). */
export function eventMatchesPlayKey(ev: KeyboardEvent, playKeybind: string): boolean {
  const want = playKeybind.trim().toLowerCase();
  const target = want === "space" || want === " " ? "space" : want;
  if (ev.code === "Space" || ev.key === " ") {
    return target === "space";
  }
  return ev.key.toLowerCase() === target;
}

/** Short label for HUD (e.g. Space). */
export function formatKeybindLabel(keybind: string): string {
  const k = keybind.trim();
  if (!k) return "?";
  if (k.length === 1) return k.toUpperCase();
  const lower = k.toLowerCase();
  if (lower === "space" || lower === " ") return "Space";
  return k;
}
