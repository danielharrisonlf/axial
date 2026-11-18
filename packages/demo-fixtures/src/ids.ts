import { createHash } from "node:crypto";

/** Fixed namespace of the demonstration scenario. Changing it changes every seeded id. */
export const DEMO_NAMESPACE = "6f1d2c3e-8a4b-5c6d-9e7f-0a1b2c3d4e5f";

const namespaceBytes = Buffer.from(DEMO_NAMESPACE.replaceAll("-", ""), "hex");

/**
 * Deterministic UUID (RFC 9562 version 5: SHA-1 of namespace + name) for a legacy prototype id
 * such as `u1`, `prj-pcl` or `tsk12`. Every service seed and the identity seed derive the same
 * id from the same legacy id, so the records line up across schemas without lookups.
 */
export function demoId(legacyId: string): string {
  const hash = createHash("sha1").update(namespaceBytes).update(legacyId, "utf8").digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
