/**
 * Minimal RFC 1321 MD5, hex output.
 *
 * Why hand-rolled: Subsonic authentication requires `t = md5(password + salt)`.
 * `crypto.subtle` does not implement MD5 (deliberately — it is broken for
 * signatures), and adding an npm dependency to a Tauri app for ~60 lines of
 * pure arithmetic is a worse trade. This is used *only* for the Subsonic
 * auth token; never for anything security-bearing.
 *
 * Input is UTF-8 encoded before hashing, so non-ASCII passwords work.
 */

/** Per-round left-rotation amounts (RFC 1321 §3.4). */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, // round 1
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, // round 2
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, // round 3
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, // round 4
] as const;

/** K[i] = floor(2^32 * abs(sin(i + 1))). */
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
}

const HEX = "0123456789abcdef";

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

/** Little-endian hex of a 32-bit word, as MD5 digests are serialized. */
function wordToHexLE(word: number): string {
  let out = "";
  for (let byte = 0; byte < 4; byte++) {
    const b = (word >>> (byte * 8)) & 0xff;
    out += HEX[(b >>> 4) & 0x0f]! + HEX[b & 0x0f]!;
  }
  return out;
}

/** MD5 of raw bytes, lowercase hex (32 chars). */
export function md5Bytes(input: Uint8Array): string {
  const bitLen = input.length * 8;

  // Pad: 0x80, then zeros until length ≡ 56 (mod 64), then 64-bit LE bit length.
  const paddedLen = (((input.length + 8) >>> 6) << 6) + 64;
  const msg = new Uint8Array(paddedLen);
  msg.set(input);
  msg[input.length] = 0x80;

  // Bit length as 64-bit little-endian. Lengths beyond 2^53 bits are not a
  // concern here (passwords), so the high word is derived by division.
  const lo = bitLen >>> 0;
  const hi = Math.floor(bitLen / 2 ** 32) >>> 0;
  for (let i = 0; i < 4; i++) {
    msg[paddedLen - 8 + i] = (lo >>> (i * 8)) & 0xff;
    msg[paddedLen - 4 + i] = (hi >>> (i * 8)) & 0xff;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const m = new Uint32Array(16);

  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    for (let j = 0; j < 16; j++) {
      const o = chunk + j * 4;
      m[j] =
        (msg[o]! |
          (msg[o + 1]! << 8) |
          (msg[o + 2]! << 16) |
          (msg[o + 3]! << 24)) >>>
        0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      // The 4-term sum peaks below 2^34 — exact in float64 — and `>>> 0`
      // reduces it mod 2^32, which is what MD5 specifies.
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i]! + m[g]!) >>> 0;
      b = (b + rotl(sum, SHIFTS[i]!)) >>> 0;
      a = tmp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return (
    wordToHexLE(a0) + wordToHexLE(b0) + wordToHexLE(c0) + wordToHexLE(d0)
  );
}

/** UTF-8 encodes `text` and returns its MD5 as lowercase hex (32 chars). */
export function md5(text: string): string {
  return md5Bytes(new TextEncoder().encode(text));
}
