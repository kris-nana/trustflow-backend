import { Web3StorageProvider } from './web3-storage.provider';
import { PinProviderName } from './ipfs-provider.interface';

describe('Web3StorageProvider', () => {
  const originalToken = process.env.WEB3_STORAGE_TOKEN;
  let provider: Web3StorageProvider;

  beforeEach(() => {
    delete process.env.WEB3_STORAGE_TOKEN;
    provider = new Web3StorageProvider();
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.WEB3_STORAGE_TOKEN;
    else process.env.WEB3_STORAGE_TOKEN = originalToken;
  });

  it('exposes its provider name', () => {
    expect(provider.name).toBe(PinProviderName.WEB3_STORAGE);
  });

  it('is not configured without WEB3_STORAGE_TOKEN', () => {
    expect(provider.isConfigured).toBe(false);
  });

  it('is configured once WEB3_STORAGE_TOKEN is set', () => {
    process.env.WEB3_STORAGE_TOKEN = 'test-token';
    expect(new Web3StorageProvider().isConfigured).toBe(true);
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
