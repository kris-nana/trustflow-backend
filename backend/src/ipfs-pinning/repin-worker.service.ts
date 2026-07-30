import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IpfsPinningService } from './ipfs-pinning.service';
import { DEFAULT_REPIN_INTERVAL_MS, PinStatus } from './ipfs-pinning.types';

/**
 * Periodically sweeps every pin record that isn't fully healthy and re-reconciles it,
 * restoring replication once a previously-failed provider recovers or by promoting a
 * spare provider to replace one that permanently dropped the pin. This is what
 * guarantees CID durability over time rather than only at initial upload time.
 *
 * Interval is configurable via IPFS_REPIN_INTERVAL_MS (milliseconds); set to 0 or a
 * negative value to disable the background sweep entirely (e.g. in tests).
 */
@Injectable()
export class RepinWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RepinWorkerService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly pinningService: IpfsPinningService) {}

  onModuleInit(): void {
    const intervalMs = this.getIntervalMs();
    if (intervalMs <= 0) {
      this.logger.log('Re-pin worker disabled (IPFS_REPIN_INTERVAL_MS <= 0)');
      return;
    }

    this.timer = setInterval(() => {
      this.runOnce().catch(error => this.logger.error('Re-pin sweep failed', error));
    }, intervalMs);
    this.timer.unref?.();

    this.logger.log(`Re-pin worker started — sweeping every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs a single sweep. Exposed so it can also be triggered manually (e.g. from tests or an admin endpoint). */
  async runOnce(): Promise<void> {
    const targets = this.pinningService
      .findAll()
      .filter(record => record.status === PinStatus.DEGRADED || record.status === PinStatus.FAILED);

    for (const record of targets) {
      try {
        await this.pinningService.reconcile(record.cid);
      } catch (error) {
        this.logger.warn(
          `Re-pin sweep: could not reconcile ${record.cid}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private getIntervalMs(): number {
    const raw = Number(process.env.IPFS_REPIN_INTERVAL_MS);
    return Number.isFinite(raw) && process.env.IPFS_REPIN_INTERVAL_MS !== undefined
      ? raw
      : DEFAULT_REPIN_INTERVAL_MS;
  }
}
