import { createHash } from 'crypto';
import { computeCidV1Raw, isValidCidV1Raw, CIDV1_RAW_SHA256_LENGTH } from './cid.util';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Independent base32 decoder used only to verify computeCidV1Raw's encoding round-trips correctly. */
function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }

  return Buffer.from(bytes);
}

describe('computeCidV1Raw', () => {
  it('produces a CID with the expected multibase prefix and length', () => {
    const cid = computeCidV1Raw(Buffer.from('hello world'));
    expect(cid[0]).toBe('b');
    expect(cid).toHaveLength(CIDV1_RAW_SHA256_LENGTH);
  });

  it('is deterministic for identical content', () => {
    const content = Buffer.from('trustflow deliverable payload');
    expect(computeCidV1Raw(content)).toBe(computeCidV1Raw(content));
  });

  it('produces different CIDs for different content', () => {
    const a = computeCidV1Raw(Buffer.from('deliverable-a'));
    const b = computeCidV1Raw(Buffer.from('deliverable-b'));
    expect(a).not.toBe(b);
  });

  it('round-trips through base32 to the raw CIDv1 header + sha2-256 digest', () => {
    const content = Buffer.from('round trip check');
    const cid = computeCidV1Raw(content);
    const decoded = base32Decode(cid.slice(1));

    // [version=1, codec=raw(0x55), hash-fn=sha2-256(0x12), digest-size=32] + digest
    expect(decoded[0]).toBe(0x01);
    expect(decoded[1]).toBe(0x55);
    expect(decoded[2]).toBe(0x12);
    expect(decoded[3]).toBe(0x20);
    expect(decoded.subarray(4, 36)).toEqual(createHash('sha256').update(content).digest());
  });

  it('handles empty content', () => {
    const cid = computeCidV1Raw(Buffer.alloc(0));
    expect(isValidCidV1Raw(cid)).toBe(true);
  });
});

describe('isValidCidV1Raw', () => {
  it('accepts CIDs produced by computeCidV1Raw', () => {
    expect(isValidCidV1Raw(computeCidV1Raw(Buffer.from('valid')))).toBe(true);
  });

  it('rejects strings with the wrong prefix', () => {
    const cid = computeCidV1Raw(Buffer.from('valid'));
    expect(isValidCidV1Raw(`z${cid.slice(1)}`)).toBe(false);
  });

  it('rejects strings with invalid characters', () => {
    const cid = computeCidV1Raw(Buffer.from('valid'));
    expect(isValidCidV1Raw(`${cid.slice(0, -1)}1`)).toBe(false);
  });

  it('rejects strings of the wrong length', () => {
    expect(isValidCidV1Raw('bshort')).toBe(false);
  });
});
