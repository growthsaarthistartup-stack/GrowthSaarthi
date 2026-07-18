/**
 * generateULID — generates a Universally Unique Lexicographically Sortable Identifier.
 *
 * Used as the primary key for every knowledge-graph entity.
 * ULIDs are time-sortable and safe to generate client-side without a DB round-trip.
 *
 * Implementation: pure TypeScript, no external dependency.
 * Based on the ULID spec: https://github.com/ulid/spec
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number, len: number): string {
  let str = "";
  for (let i = len; i > 0; i--) {
    const mod = now % ENCODING_LEN;
    str = ENCODING[mod] + str;
    now = Math.floor(now / ENCODING_LEN);
  }
  return str;
}

function encodeRandom(len: number): string {
  let str = "";
  for (let i = 0; i < len; i++) {
    str += ENCODING[Math.floor(Math.random() * ENCODING_LEN)];
  }
  return str;
}

export function generateULID(): string {
  return encodeTime(Date.now(), TIME_LEN) + encodeRandom(RANDOM_LEN);
}
