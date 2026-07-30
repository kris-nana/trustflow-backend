import { InfuraProvider } from './infura.provider';
import { PinProviderName } from './ipfs-provider.interface';

describe('InfuraProvider', () => {
  const originalProjectId = process.env.INFURA_IPFS_PROJECT_ID;
  const originalSecret = process.env.INFURA_IPFS_PROJECT_SECRET;
  let provider: InfuraProvider;

  beforeEach(() => {
    delete process.env.INFURA_IPFS_PROJECT_ID;
    delete process.env.INFURA_IPFS_PROJECT_SECRET;
    provider = new InfuraProvider();
  });

  afterEach(() => {
    if (originalProjectId === undefined) delete process.env.INFURA_IPFS_PROJECT_ID;
    else process.env.INFURA_IPFS_PROJECT_ID = originalProjectId;
    if (originalSecret === undefined) delete process.env.INFURA_IPFS_PROJECT_SECRET;
    else process.env.INFURA_IPFS_PROJECT_SECRET = originalSecret;
  });

  it('exposes its provider name', () => {
    expect(provider.name).toBe(PinProviderName.INFURA);
  });

  it('is not configured without project id and secret', () => {
    expect(provider.isConfigured).toBe(false);
  });

  it('is not configured with only a project id', () => {
    process.env.INFURA_IPFS_PROJECT_ID = 'test-id';
    expect(new InfuraProvider().isConfigured).toBe(false);
  });

  it('is configured once both project id and secret are set', () => {
    process.env.INFURA_IPFS_PROJECT_ID = 'test-id';
    process.env.INFURA_IPFS_PROJECT_SECRET = 'test-secret';
    expect(new InfuraProvider().isConfigured).toBe(true);
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
