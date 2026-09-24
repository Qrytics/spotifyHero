import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearCredentials,
  clearLoginHint,
  clearLoginHintPassword,
  deriveCredentials,
  loadCredentials,
  loadLoginHint,
  saveCredentials,
  saveLoginHint,
} from "./credentials.js";

const CREDENTIAL_KEY = "spotifyHero_navidrome_v1";
const HINT_KEY = "spotifyHero_navidrome_login_v1";

/**
 * vitest runs this app's tests in node, where `localStorage` does not exist, so
 * every persistence path would silently no-op. A `Map` is enough of a `Storage`:
 * `credentials` only calls `getItem`/`setItem`/`removeItem`. Same shim as
 * `lib/chartCache.test.ts`.
 */
class FakeStorage {
  private readonly entries = new Map<string, string>();
  /** Bytes allowed before `setItem` throws, mimicking a quota. */
  limit = Infinity;

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (value.length > this.limit) {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    this.entries.set(key, value);
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("login hint", () => {
  it("round-trips the server, username and password", () => {
    saveLoginHint({
      serverUrl: "music.example.com",
      username: "gamer",
      password: "sesame",
      rememberPassword: true,
    });
    expect(loadLoginHint()).toEqual({
      serverUrl: "music.example.com",
      username: "gamer",
      password: "sesame",
      rememberPassword: true,
    });
  });

  it("stores the server address as typed, so it goes back in the field verbatim", () => {
    // `normalizeServerUrl` is the credential's job, not the hint's.
    saveLoginHint({
      serverUrl: "music.example.com/app/#/album",
      username: "gamer",
      rememberPassword: false,
    });
    expect(loadLoginHint()?.serverUrl).toBe("music.example.com/app/#/album");
  });

  it("omits the password when the box was unchecked", () => {
    saveLoginHint({
      serverUrl: "music.example.com",
      username: "gamer",
      rememberPassword: false,
    });
    const hint = loadLoginHint();
    expect(hint?.password).toBeUndefined();
    expect(hint?.rememberPassword).toBe(false);
    expect(storage.getItem(HINT_KEY)).not.toContain("password");
  });

  it("defaults rememberPassword to true for a blob written before it existed", () => {
    storage.setItem(
      HINT_KEY,
      JSON.stringify({ serverUrl: "music.example.com", username: "gamer" })
    );
    expect(loadLoginHint()?.rememberPassword).toBe(true);
  });

  it("drops only the password on sign-out, keeping the rest", () => {
    saveLoginHint({
      serverUrl: "music.example.com",
      username: "gamer",
      password: "sesame",
      rememberPassword: true,
    });
    clearLoginHintPassword();
    expect(loadLoginHint()).toEqual({
      serverUrl: "music.example.com",
      username: "gamer",
      // Preference survives, so signing back in still offers to remember it.
      rememberPassword: true,
    });
  });

  it("is a no-op when there is nothing stored to strip", () => {
    clearLoginHintPassword();
    expect(loadLoginHint()).toBeNull();
  });

  it("returns null for a corrupt or half-written blob", () => {
    storage.setItem(HINT_KEY, "{not json");
    expect(loadLoginHint()).toBeNull();
    storage.setItem(HINT_KEY, JSON.stringify({ username: "gamer" }));
    expect(loadLoginHint()).toBeNull();
    storage.setItem(HINT_KEY, JSON.stringify({ serverUrl: "", username: "g" }));
    expect(loadLoginHint()).toBeNull();
  });

  it("survives a quota failure without throwing", () => {
    storage.limit = 4;
    expect(() =>
      saveLoginHint({
        serverUrl: "music.example.com",
        username: "gamer",
        rememberPassword: true,
      })
    ).not.toThrow();
    expect(loadLoginHint()).toBeNull();
  });

  it("clears completely on demand", () => {
    saveLoginHint({
      serverUrl: "music.example.com",
      username: "gamer",
      rememberPassword: true,
    });
    clearLoginHint();
    expect(loadLoginHint()).toBeNull();
  });
});

describe("hint and credential are independent", () => {
  it("keeps the hint when a rejected password clears the credential", () => {
    const creds = deriveCredentials("music.example.com", "gamer", "sesame");
    saveCredentials(creds);
    saveLoginHint({
      serverUrl: "music.example.com",
      username: "gamer",
      password: "sesame",
      rememberPassword: true,
    });

    // What `useNavidromeAuth` does on a `kind: "auth"` failure.
    clearCredentials();

    expect(loadCredentials()).toBeNull();
    expect(loadLoginHint()?.password).toBe("sesame");
  });

  it("does not store the plaintext password in the credential record", () => {
    saveCredentials(deriveCredentials("music.example.com", "gamer", "sesame"));
    expect(storage.getItem(CREDENTIAL_KEY)).not.toContain("sesame");
  });
});
