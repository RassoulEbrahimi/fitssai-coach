import type { Sha256Hex } from "@shared/nutrition";

/**
 * Web Crypto's SHA-256 as the shared fingerprint expects it: hex of the UTF-8
 * bytes. The platform digest — the server computes the same with Node's.
 */
export const webSha256Hex: Sha256Hex = async (text) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
