import { createHash } from "node:crypto";
import type { Sha256Hex } from "../../../shared/nutrition";

/** Node's SHA-256 as the shared fingerprint expects it: hex of the UTF-8 bytes. */
export const nodeSha256Hex: Sha256Hex = async (text) => createHash("sha256").update(text, "utf8").digest("hex");
