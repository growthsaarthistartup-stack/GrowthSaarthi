/**
 * src/lib/url-guard.ts
 *
 * SSRF (Server-Side Request Forgery) guard for user-supplied URLs.
 *
 * Attack vector: a malicious user submits a URL like:
 *   http://169.254.169.254/latest/meta-data/  (AWS instance metadata)
 *   http://127.0.0.1:6379/                    (Redis on localhost)
 *   file:///etc/passwd                        (local file read)
 *   http://192.168.1.1/                       (internal router)
 *
 * This module validates a URL before the website scraper fetches it.
 */

/** Private/reserved IP CIDR ranges that should never be fetched */
const BLOCKED_IP_PATTERNS = [
  // Loopback
  /^127\./,
  /^::1$/,
  // Link-local (AWS metadata endpoint: 169.254.169.254)
  /^169\.254\./,
  /^fe80:/i,
  // Private ranges
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  // Cloud metadata services
  /^100\.64\./,           // Carrier-grade NAT
  /^fd[0-9a-f]{2}:/i,    // IPv6 ULA
];

/** Blocked hostnames regardless of IP resolution */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",        // GCP metadata
  "169.254.169.254",                 // AWS/Azure metadata
  "metadata",                        // ECS internal
]);

export interface UrlGuardResult {
  ok: boolean;
  error?: string;
  normalizedUrl?: string;
}

/**
 * validateWebsiteUrl — sanitize and validate a user-supplied website URL.
 *
 * Rules:
 * 1. Must be a valid URL parseable by the WHATWG URL API.
 * 2. Protocol must be http: or https: only.
 * 3. Hostname must not be in the blocked list.
 * 4. Hostname must not resolve to a private/reserved IP (checked lexically —
 *    a full DNS pre-resolution would require an async call we can't do here
 *    in the synchronous validation path, so we block known patterns).
 * 5. Max URL length: 2048 characters.
 * 6. Returns a clean normalized URL (lowercased scheme + host, original path).
 */
export function validateWebsiteUrl(raw: string): UrlGuardResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "URL is required" };
  }

  const trimmed = raw.trim();

  if (trimmed.length > 2048) {
    return { ok: false, error: "URL is too long (max 2048 characters)" };
  }

  // Prepend https:// if no protocol supplied
  const withProtocol = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  // Protocol check — only http/https allowed
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// URLs are allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostname check
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: "URL points to a restricted or internal host" };
  }

  // Private IP pattern check (lexical)
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { ok: false, error: "URL points to a private or reserved IP address" };
    }
  }

  // Block port numbers for well-known internal services
  const port = parsed.port ? parseInt(parsed.port, 10) : null;
  if (port !== null && (port < 80 || (port > 443 && port < 1024))) {
    return { ok: false, error: "URL port is in a restricted range" };
  }

  // Return normalized URL: lowercase scheme + host, preserve path/query
  const normalizedUrl = `${parsed.protocol}//${hostname}${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/$/, "") || `${parsed.protocol}//${hostname}`;

  return { ok: true, normalizedUrl };
}
