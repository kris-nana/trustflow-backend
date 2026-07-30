import { RepinWorkerService } from './repin-worker.service';
import { IpfsPinningService } from './ipfs-pinning.service';
import { PinStatus } from './ipfs-pinning.types';

function makeRecord(cid: string, status: PinStatus) {
  return {
    cid,
    size: 1,
    replicationFactor: 2,
    status,
    providers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('RepinWorkerService', () => {
  const originalInterval = process.env.IPFS_REPIN_INTERVAL_MS;
  let pinningService: jest.Mocked<Pick<IpfsPinningService, 'findAll' | 'reconcile'>>;
  let worker: RepinWorkerService;

  beforeEach(() => {
    pinningService = {
      findAll: jest.fn().mockReturnValue([]),
      reconcile: jest.fn().mockResolvedValue(undefined),
    };
    worker = new RepinWorkerService(pinningService as unknown as IpfsPinningService);
  });

  afterEach(() => {
    worker.onModuleDestroy();
    jest.useRealTimers();
    if (originalInterval === undefined) delete process.env.IPFS_REPIN_INTERVAL_MS;
    else process.env.IPFS_REPIN_INTERVAL_MS = originalInterval;
  });

  describe('runOnce', () => {
    it('reconciles only DEGRADED and FAILED records', async () => {
      pinningService.findAll.mockReturnValue([
        makeRecord('cid-healthy', PinStatus.HEALTHY),
        makeRecord('cid-degraded', PinStatus.DEGRADED),
        makeRecord('cid-failed', PinStatus.FAILED),
        makeRecord('cid-unpinned', PinStatus.UNPINNED),
      ]);

      await worker.runOnce();

      expect(pinningService.reconcile).toHaveBeenCalledTimes(2);
      expect(pinningService.reconcile).toHaveBeenCalledWith('cid-degraded');
      expect(pinningService.reconcile).toHaveBeenCalledWith('cid-failed');
    });

    it('continues sweeping remaining records when one reconcile call throws', async () => {
      pinningService.findAll.mockReturnValue([
        makeRecord('cid-a', PinStatus.DEGRADED),
        makeRecord('cid-b', PinStatus.DEGRADED),
      ]);
      pinningService.reconcile.mockRejectedValueOnce(new Error('provider unreachable'));

      await expect(worker.runOnce()).resolves.not.toThrow();
      expect(pinningService.reconcile).toHaveBeenCalledWith('cid-a');
      expect(pinningService.reconcile).toHaveBeenCalledWith('cid-b');
    });
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('schedules periodic sweeps at the default interval', () => {
      jest.useFakeTimers();
      delete process.env.IPFS_REPIN_INTERVAL_MS;
      pinningService.findAll.mockReturnValue([makeRecord('cid-a', PinStatus.DEGRADED)]);

      worker.onModuleInit();
      expect(pinningService.reconcile).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5 * 60 * 1000);
      return Promise.resolve().then(() => {
        expect(pinningService.reconcile).toHaveBeenCalledWith('cid-a');
      });
    });

    it('honors a custom IPFS_REPIN_INTERVAL_MS', () => {
      jest.useFakeTimers();
      process.env.IPFS_REPIN_INTERVAL_MS = '1000';
      pinningService.findAll.mockReturnValue([makeRecord('cid-a', PinStatus.DEGRADED)]);

      worker.onModuleInit();
      jest.advanceTimersByTime(999);
      expect(pinningService.reconcile).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      return Promise.resolve().then(() => {
        expect(pinningService.reconcile).toHaveBeenCalledWith('cid-a');
      });
    });

    it('does not schedule a sweep when the interval is disabled', () => {
      jest.useFakeTimers();
      process.env.IPFS_REPIN_INTERVAL_MS = '0';

      worker.onModuleInit();
      jest.advanceTimersByTime(60 * 60 * 1000);

      expect(pinningService.findAll).not.toHaveBeenCalled();
    });

    it('stops sweeping once destroyed', () => {
      jest.useFakeTimers();
      process.env.IPFS_REPIN_INTERVAL_MS = '1000';
      pinningService.findAll.mockReturnValue([makeRecord('cid-a', PinStatus.DEGRADED)]);

      worker.onModuleInit();
      worker.onModuleDestroy();
      jest.advanceTimersByTime(10000);

      expect(pinningService.findAll).not.toHaveBeenCalled();
    });
  });
});
