import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql } from "./db";

const AUTH_COOKIE = "sh_auth";
const enc = new TextEncoder();

function authSecret(): Uint8Array {
  const secret = process.env.SH_AUTH_SECRET;
  if (!secret) throw new Error("Missing SH_AUTH_SECRET");
  return enc.encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function issueSession(player: { id: string; email: string; displayName: string }) {
  const token = await new SignJWT({
    sub: player.id,
    email: player.email,
    displayName: player.displayName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(authSecret());

  cookies().set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession() {
  cookies().delete(AUTH_COOKIE);
}

export async function getSessionPlayer() {
  const token = cookies().get(AUTH_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, authSecret());
    const playerId = String(payload.sub ?? "");
    if (!playerId) return null;
    const { rows } =
      await sql`SELECT id, email, display_name FROM sh_players WHERE id = ${playerId} LIMIT 1`;
    const row = rows[0] as
      | { id: string; email: string; display_name: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
    };
  } catch {
    return null;
  }
}
