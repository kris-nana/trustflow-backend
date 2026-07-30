import { PinProviderName } from './providers/ipfs-provider.interface';

export { PinProviderName };

/** Overall durability status of a pinned CID across all registered providers. */
export enum PinStatus {
  /** Pinned on at least `replicationFactor` providers. */
  HEALTHY = 'HEALTHY',
  /** Pinned on at least one, but fewer than `replicationFactor`, providers. */
  DEGRADED = 'DEGRADED',
  /** Not currently pinned on any provider. */
  FAILED = 'FAILED',
  /** Explicitly unpinned by the caller. */
  UNPINNED = 'UNPINNED',
}

export enum ProviderPinStatus {
  PINNED = 'PINNED',
  FAILED = 'FAILED',
  UNPINNED = 'UNPINNED',
}

/** Webhook events emitted by the pinning service and re-pin worker. */
export const IPFS_EVENTS = {
  PIN_CREATED: 'ipfs.pin.created',
  PIN_DEGRADED: 'ipfs.pin.degraded',
  PIN_RESTORED: 'ipfs.pin.restored',
  PIN_LOST: 'ipfs.pin.lost',
  PIN_FAILED: 'ipfs.pin.failed',
  PIN_REMOVED: 'ipfs.pin.removed',
} as const;

export const DEFAULT_REPLICATION_FACTOR = 2;
export const DEFAULT_REPIN_INTERVAL_MS = 5 * 60 * 1000;

export interface ProviderPinRecord {
  provider: PinProviderName;
  status: ProviderPinStatus;
  attempts: number;
  pinnedAt?: string;
  lastVerifiedAt?: string;
  lastError?: string;
}

export interface PinRecord {
  cid: string;
  size: number;
  filename?: string;
  replicationFactor: number;
  status: PinStatus;
  providers: ProviderPinRecord[];
  createdAt: string;
  updatedAt: string;
}
