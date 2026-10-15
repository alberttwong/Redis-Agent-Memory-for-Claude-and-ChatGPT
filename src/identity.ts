import { createHash } from "node:crypto";
import { hostname, userInfo } from "node:os";

// Provider account identities are not a shared cross-client identity API.
// Include the host so the same OS username on different machines is distinct.
export function defaultOwnerId(): string {
  return `user-${createHash("sha256").update(`${hostname()}\0${userInfo().username}`).digest("hex").slice(0, 32)}`;
}
