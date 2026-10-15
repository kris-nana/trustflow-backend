import { DistributedLockService } from './distributed-lock.service';

/** Minimal in-memory stand-in for the subset of ioredis used by the lock service. */
class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    flag: 'NX',
  ): Promise<'OK' | null> {
    void mode;
    void flag;
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return null; // NX: key already held and not yet expired
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async eval(
    script: string,
    numKeys: number,
    key: string,
    token: string,
    ttlMs?: number,
  ): Promise<number> {
    void numKeys;
    const existing = this.store.get(key);
    
    // RENEW_LUA script: check token and renew expiry
    if (script.includes('PEXPIRE')) {
      if (existing && existing.value === token && existing.expiresAt > Date.now()) {
        this.store.set(key, { value: token, expiresAt: Date.now() + (ttlMs || 0) });
        return 1;
      }
      return 0;
    }
    
    // RELEASE_LUA script: check token and delete
    if (existing && existing.value === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

describe('DistributedLockService', () => {
  it('grants the lock to only one of several instances racing for the same key', async () => {
    const redis = new FakeRedis();
    const instanceA = new DistributedLockService(redis as any);
    const instanceB = new DistributedLockService(redis as any);
    const instanceC = new DistributedLockService(redis as any);

    const results = await Promise.all([
      instanceA.tryAcquire('lock:sweep', 5000),
      instanceB.tryAcquire('lock:sweep', 5000),
      instanceC.tryAcquire('lock:sweep', 5000),
    ]);

    const winners = results.filter(token => token !== null);
    expect(winners).toHaveLength(1);
  });

  it('allows re-acquiring once the lock is released', async () => {
    const redis = new FakeRedis();
    const service = new DistributedLockService(redis as any);

    const token = await service.tryAcquire('lock:sweep', 5000);
    expect(token).not.toBeNull();
    expect(await service.tryAcquire('lock:sweep', 5000)).toBeNull();

    await service.release('lock:sweep', token as string);
    expect(await service.tryAcquire('lock:sweep', 5000)).not.toBeNull();
  });

  it('does not release a lock it does not hold (compare-and-delete)', async () => {
    const redis = new FakeRedis();
    const holder = new DistributedLockService(redis as any);
    const impostor = new DistributedLockService(redis as any);

    const token = await holder.tryAcquire('lock:sweep', 5000);
    expect(token).not.toBeNull();

    await impostor.release('lock:sweep', 'not-the-real-token');

    // Still held by the original owner.
    expect(await impostor.tryAcquire('lock:sweep', 5000)).toBeNull();
  });

  it('fails open (grants a token) when Redis is unavailable', async () => {
    const service = new DistributedLockService(null);
    const token = await service.tryAcquire('lock:sweep', 5000);
    expect(token).not.toBeNull();
    await expect(service.release('lock:sweep', token as string)).resolves.toBeUndefined();
  });

  describe('renewIfOwned', () => {
    it('renews the lock when the caller still holds the token', async () => {
      const redis = new FakeRedis();
      const service = new DistributedLockService(redis as any);

      const token = await service.tryAcquire('lock:sweep', 5000);
      expect(token).not.toBeNull();

      const renewed = await service.renewIfOwned('lock:sweep', token as string, 10000);
      expect(renewed).toBe(true);
    });

    it('returns false when the key is held by a different token', async () => {
      const redis = new FakeRedis();
      const holder = new DistributedLockService(redis as any);
      const impostor = new DistributedLockService(redis as any);

      const token = await holder.tryAcquire('lock:sweep', 5000);
      expect(token).not.toBeNull();

      const renewed = await impostor.renewIfOwned('lock:sweep', 'wrong-token', 10000);
      expect(renewed).toBe(false);
    });

    it('returns false when the key has expired or does not exist', async () => {
      const redis = new FakeRedis();
      const service = new DistributedLockService(redis as any);

      const renewed = await service.renewIfOwned('lock:nonexistent', 'some-token', 10000);
      expect(renewed).toBe(false);
    });

    it('returns true unconditionally when Redis is unavailable (no-Redis branch)', async () => {
      const service = new DistributedLockService(null);

      const renewed = await service.renewIfOwned('lock:sweep', 'any-token', 5000);
      expect(renewed).toBe(true);
    });

    it('throws when Redis eval fails (error path)', async () => {
      const redis = {
        eval: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
      };
      const service = new DistributedLockService(redis as any);

      await expect(service.renewIfOwned('lock:sweep', 'token', 5000)).rejects.toThrow(
        'Failed to renew lock "lock:sweep": Redis connection lost',
      );
    });
  });
});
