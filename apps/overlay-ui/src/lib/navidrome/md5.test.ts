import { describe, it, expect } from "vitest";
import { md5, md5Bytes } from "./md5.js";

describe("md5 — RFC 1321 §A.5 test suite", () => {
  const vectors: Array<[string, string]> = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      "d174ab98d277d9f5a5611c2c9f419d9f",
    ],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ];

  for (const [input, expected] of vectors) {
    it(`md5(${JSON.stringify(input.slice(0, 24))}${input.length > 24 ? "…" : ""})`, () => {
      expect(md5(input)).toBe(expected);
    });
  }
});

describe("md5 — block-boundary lengths", () => {
  // Padding is the classic place to get MD5 wrong: 55/56 and 63/64/65 bytes
  // each land in a different padding branch.
  const cases: Array<[number, string]> = [
    [55, "ef1772b6dff9a122358552954ad0df65"],
    [56, "3b0c8ac703f828b04c6c197006d17218"],
    [63, "b06521f39153d618550606be297466d5"],
    [64, "014842d480b571495a4a0363793f7367"],
    [65, "c743a45e0d2e6a95cb859adae0248435"],
  ];

  for (const [len, expected] of cases) {
    it(`${len} bytes of "a"`, () => {
      expect(md5("a".repeat(len))).toBe(expected);
    });
  }
});

describe("md5 — encoding", () => {
  it("hashes UTF-8 bytes, not UTF-16 code units", () => {
    // "é" is 2 bytes in UTF-8 (0xC3 0xA9), 1 UTF-16 code unit.
    expect(md5("é")).toBe("66ddcd97cfdeabb2f6fb8a999b4bc76f");
    expect(md5("é")).toBe(md5Bytes(new Uint8Array([0xc3, 0xa9])));
  });

  it("always returns 32 lowercase hex chars", () => {
    for (const s of ["", "a", "subsonic-salt", "π≈3.14"]) {
      expect(md5(s)).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

describe("md5 — Subsonic token shape", () => {
  it("matches the documented Subsonic example (sesame + c19b2d)", () => {
    // From the Subsonic API docs: password "sesame", salt "c19b2d",
    // token "26719a1196d2a940705a59634eb18eab".
    expect(md5("sesame" + "c19b2d")).toBe("26719a1196d2a940705a59634eb18eab");
  });
});
