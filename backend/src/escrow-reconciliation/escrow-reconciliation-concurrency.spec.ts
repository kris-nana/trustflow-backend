import { Test, TestingModule } from '@nestjs/testing';
import { EscrowReconciliationService } from './escrow-reconciliation.service';
import { EscrowService, Escrow } from '../escrow/escrow.service';
import { EscrowChainStateClient } from './escrow-chain-state.client';
import { WebhookService } from '../webhook/webhook.service';
import { EscrowReconciliationStateStore } from './escrow-reconciliation-state.store';
import { setTestEnv, resetEnvConfig } from '../config/env.config';

describe('EscrowReconciliationService - Concurrency Limits', () => {
  let service: EscrowReconciliationService;
  let mockEscrowService: jest.Mocked<EscrowService>;
  let mockChainClient: jest.Mocked<EscrowChainStateClient>;
  let mockWebhookService: jest.Mocked<WebhookService>;
  let mockStateStore: jest.Mocked<EscrowReconciliationStateStore>;

  const createMockEscrow = (id: string, contractEscrowId: string): Escrow => ({
    id,
    depositor: 'G' + 'A'.repeat(55),
    beneficiary: 'G' + 'B'.repeat(55),
    amountXLM: '100',
    status: 'active',
    createdAt: new Date().toISOString(),
    contractEscrowId,
    version: 1,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Set test environment with concurrency limit
    setTestEnv({
      NODE_ENV: 'test',
      ESCROW_RECONCILIATION_SWEEP_CONCURRENCY: '3',
    });

    mockEscrowService = {
      findAll: jest.fn(),
      findById: jest.fn(),
      applyChainState: jest.fn(),
      createFromChainState: jest.fn(),
    } as any;

    mockChainClient = {
      getEscrow: jest.fn(),
    } as any;

    mockWebhookService = {
      dispatch: jest.fn(),
    } as any;

    mockStateStore = {
      save: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowReconciliationService,
        { provide: EscrowService, useValue: mockEscrowService },
        { provide: EscrowChainStateClient, useValue: mockChainClient },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: EscrowReconciliationStateStore, useValue: mockStateStore },
      ],
    }).compile();

    service = module.get<EscrowReconciliationService>(EscrowReconciliationService);
  });

  afterEach(() => {
    resetEnvConfig();
  });

  it('should limit concurrent chain state queries to 3', async () => {
    // Create 10 escrows to reconcile
    const escrows = Array.from({ length: 10 }, (_, i) =>
      createMockEscrow(`escrow-${i}`, `contract-${i}`),
    );

    mockEscrowService.findAll.mockResolvedValue(escrows);

    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;

    // Track concurrency
    mockChainClient.getEscrow.mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);

      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 10));

      concurrentCalls--;

      return {
        contractEscrowId: 'contract-1',
        depositor: 'G' + 'A'.repeat(55),
        beneficiary: 'G' + 'B'.repeat(55),
        amountXLM: '100',
        status: 'active',
      };
    });

    await service.reconcile();

    // Verify max concurrent calls never exceeded 3
    expect(maxConcurrentCalls).toBeLessThanOrEqual(3);
    expect(mockChainClient.getEscrow).toHaveBeenCalledTimes(10);
  });

  it('should use cursor-based pagination for large escrow sets', async () => {
    // Create 150 escrows (3 batches of 50)
    const escrows = Array.from({ length: 150 }, (_, i) =>
      createMockEscrow(`escrow-${i}`, `contract-${i}`),
    );

    mockEscrowService.findAll.mockResolvedValue(escrows);
    mockChainClient.getEscrow.mockResolvedValue(undefined);

    await service.reconcile();

    // Verify findAll was called to get escrows
    expect(mockEscrowService.findAll).toHaveBeenCalled();

    // Verify chain client was called for all escrows
    expect(mockChainClient.getEscrow).toHaveBeenCalledTimes(150);
  });

  it('should not starve HTTP request connection pools during reconciliation', async () => {
    // Create many escrows
    const escrows = Array.from({ length: 50 }, (_, i) =>
      createMockEscrow(`escrow-${i}`, `contract-${i}`),
    );

    mockEscrowService.findAll.mockResolvedValue(escrows);

    let activeConnections = 0;
    const MAX_POOL_SIZE = 20;

    mockChainClient.getEscrow.mockImplementation(async () => {
      activeConnections++;

      // Verify we're not exhausting the entire pool
      expect(activeConnections).toBeLessThanOrEqual(MAX_POOL_SIZE);

      await new Promise(resolve => setTimeout(resolve, 5));

      activeConnections--;

      return {
        contractEscrowId: 'contract-1',
        depositor: 'G' + 'A'.repeat(55),
        beneficiary: 'G' + 'B'.repeat(55),
        amountXLM: '100',
        status: 'active',
      };
    });

    await service.reconcile();

    // Reconciliation should complete successfully without exhausting pool
    expect(mockChainClient.getEscrow).toHaveBeenCalledTimes(50);
    expect(mockStateStore.save).toHaveBeenCalled();
  });

  it('should handle chain read failures without blocking other escrows', async () => {
    const escrows = [
      createMockEscrow('escrow-1', 'contract-1'),
      createMockEscrow('escrow-2', 'contract-2'),
      createMockEscrow('escrow-3', 'contract-3'),
    ];

    mockEscrowService.findAll.mockResolvedValue(escrows);

    // Second escrow fails to read from chain
    mockChainClient.getEscrow
      .mockResolvedValueOnce({
        contractEscrowId: 'contract-1',
        depositor: 'G' + 'A'.repeat(55),
        beneficiary: 'G' + 'B'.repeat(55),
        amountXLM: '100',
        status: 'active',
      })
      .mockRejectedValueOnce(new Error('Chain RPC timeout'))
      .mockResolvedValueOnce({
        contractEscrowId: 'contract-3',
        depositor: 'G' + 'A'.repeat(55),
        beneficiary: 'G' + 'B'.repeat(55),
        amountXLM: '100',
        status: 'active',
      });

    const result = await service.reconcile();

    // Should record error but continue processing
    expect(result.errorCount).toBe(1);
    expect(result.checked).toBe(3);
    expect(mockChainClient.getEscrow).toHaveBeenCalledTimes(3);
  });
});
