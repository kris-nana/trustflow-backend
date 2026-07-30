import { PinataProvider } from './pinata.provider';
import { PinProviderName } from './ipfs-provider.interface';

describe('PinataProvider', () => {
  const originalJwt = process.env.PINATA_JWT;
  let provider: PinataProvider;

  beforeEach(() => {
    delete process.env.PINATA_JWT;
    provider = new PinataProvider();
  });

  afterEach(() => {
    if (originalJwt === undefined) delete process.env.PINATA_JWT;
    else process.env.PINATA_JWT = originalJwt;
  });

  it('exposes its provider name', () => {
    expect(provider.name).toBe(PinProviderName.PINATA);
  });

  it('is not configured without PINATA_JWT', () => {
    expect(provider.isConfigured).toBe(false);
  });

  it('is configured once PINATA_JWT is set', () => {
    process.env.PINATA_JWT = 'test-jwt';
    expect(new PinataProvider().isConfigured).toBe(true);
  });

  describe('simulated mode (no credentials)', () => {
    it('pins, verifies, and unpins content in-memory', async () => {
      const cid = 'bafkreitest';
      const content = Buffer.from('deliverable bytes');

      expect(await provider.verify(cid)).toBe(false);

      await provider.pin(cid, content);
      expect(await provider.verify(cid)).toBe(true);

      await provider.unpin(cid);
      expect(await provider.verify(cid)).toBe(false);
    });
  });
});
