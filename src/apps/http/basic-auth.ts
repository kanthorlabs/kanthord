import { createHash, timingSafeEqual } from "node:crypto";

export const BASIC_CHALLENGE = 'Basic realm="kanthord"';

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** RFC 7617 check against one shared secret. Returns true only on an exact match. */
export function checkBasicAuth(
  header: string | undefined,
  apiKey: string,
): boolean {
  if (!header) {
    return false;
  }

  const spaceIndex = header.indexOf(" ");
  if (spaceIndex === -1) {
    return false;
  }
  const scheme = header.slice(0, spaceIndex);
  const payload = header.slice(spaceIndex + 1);
  if (
    scheme.toLowerCase() !== "basic" ||
    payload === "" ||
    payload.includes(" ")
  ) {
    return false;
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(payload, "base64");
  } catch {
    return false;
  }
  if (decoded.toString("base64") !== payload) {
    return false;
  }

  const text = decoded.toString("utf8");
  const colonIndex = text.indexOf(":");
  if (colonIndex === -1) {
    return false;
  }
  const password = text.slice(colonIndex + 1);
  if (password === "") {
    return false;
  }

  return timingSafeEqual(sha256(password), sha256(apiKey));
}
