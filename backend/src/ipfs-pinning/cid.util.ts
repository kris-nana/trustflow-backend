import { createHash } from 'crypto';

/**
 * Multibase 'b' prefix uses lowercase RFC4648 base32 without padding.
 * https://github.com/multiformats/multibase
 */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** CIDv1 varint header for a raw-leaf block hashed with sha2-256: [version, codec, hash-fn, digest-size]. */
const CIDV1_RAW_SHA256_PREFIX = Buffer.from([0x01, 0x55, 0x12, 0x20]);

/** Length of a CIDv1 raw/sha2-256 string: 1 ("b") + ceil((4 + 32) * 8 / 5) base32 chars. */
export const CIDV1_RAW_SHA256_LENGTH =
  1 + Math.ceil(((CIDV1_RAW_SHA256_PREFIX.length + 32) * 8) / 5);

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
    // Keep only the unconsumed low-order bits so `value` never grows unbounded.
    value &= (1 << bits) - 1;
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

/**
 * Computes the CIDv1 (raw multicodec, sha2-256, base32 multibase) content identifier
 * for a single-block payload — equivalent to `ipfs add --cid-version=1 --raw-leaves`
 * for content that fits in one block. This is what content-hash verification is
 * checked against: the CID is derived purely from the bytes, so any provider that
 * returns or ends up storing different bytes will fail verification.
 */
export function computeCidV1Raw(content: Buffer): string {
  const digest = createHash('sha256').update(content).digest();
  const prefixed = Buffer.concat([CIDV1_RAW_SHA256_PREFIX, digest]);
  return `b${base32Encode(prefixed)}`;
}

/** Structural validity check for a CIDv1 raw/sha2-256 string produced by {@link computeCidV1Raw}. */
export function isValidCidV1Raw(cid: string): boolean {
  if (cid.length !== CIDV1_RAW_SHA256_LENGTH) return false;
  return /^b[a-z2-7]+$/.test(cid);
}
