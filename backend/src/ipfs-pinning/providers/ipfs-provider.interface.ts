/** DI token for the ordered list of registered IPFS pin providers. */
export const PIN_PROVIDERS = 'PIN_PROVIDERS';

export enum PinProviderName {
  PINATA = 'pinata',
  WEB3_STORAGE = 'web3.storage',
  INFURA = 'infura',
}

/**
 * Contract every IPFS pinning backend must implement. `pin` uploads/pins the exact
 * bytes for `cid` (the caller has already verified `cid` matches the content hash);
 * `verify` re-checks that the provider still holds the pin, which both confirms a
 * successful pin and lets the re-pin worker detect silent data loss later on.
 */
export abstract class IpfsPinProvider {
  abstract readonly name: PinProviderName;

  /** Whether real credentials are configured for this provider (vs. running in local/simulated mode). */
  abstract readonly isConfigured: boolean;

  abstract pin(cid: string, content: Buffer): Promise<void>;
  abstract unpin(cid: string): Promise<void>;
  abstract verify(cid: string): Promise<boolean>;
}
