import { AuditService } from './audit.service';
import { DatabaseService } from '../common/database/database.service';
import { Pool } from 'pg';

describe('AuditService - Transaction Isolation', () => {
  let service: AuditService;
  let mockPool: jest.Mocked<Pool>;
  let mockDb: jest.Mocked<DatabaseService>;

  beforeEach(() => {
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as any;

    mockDb = {
      isConfigured: true,
      getPool: jest.fn().mockReturnValue(mockPool),
      query: jest.fn(),
    } as any;

    service = new AuditService(mockDb);
  });

  it('should use independent connection pool for audit writes', async () => {
    const auditEntry = {
      operation: 'ESCROW_RELEASE',
      user: 'alice',
      entityId: 'escrow-1',
      entityType: 'escrow',
      beforeState: { status: 'disputed' },
      afterState: { status: 'released' },
    };

    await service.logOperation(auditEntry);

    // Verify getPool() was called to get independent connection
    expect(mockDb.getPool).toHaveBeenCalled();
    
    // Verify pool.query() was called directly (not db.query())
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining(['ESCROW_RELEASE', 'alice', 'escrow-1', 'escrow']),
    );

    // Verify db.query() was NOT called (would participate in ambient transaction)
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('should persist audit log even if called within a transaction context', async () => {
    // Simulate being called within a transaction that later rolls back
    const auditEntry = {
      operation: 'ESCROW_DISPUTE',
      user: 'bob',
      entityId: 'escrow-2',
      entityType: 'escrow',
      beforeState: { status: 'active' },
      afterState: { status: 'disputed' },
      metadata: { reason: 'Non-payment' },
    };

    await service.logOperation(auditEntry);

    // Audit log should use independent pool connection
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [query, params] = mockPool.query.mock.calls[0];
    
    expect(query).toContain('INSERT INTO audit_logs');
    expect(params).toEqual([
      'ESCROW_DISPUTE',
      'bob',
      'escrow-2',
      'escrow',
      JSON.stringify({ status: 'active' }),
      JSON.stringify({ status: 'disputed' }),
      JSON.stringify({ reason: 'Non-payment' }),
    ]);
  });

  it('should not throw if audit write fails', async () => {
    mockPool.query.mockRejectedValue(new Error('Database connection lost'));

    const auditEntry = {
      operation: 'TEST_OP',
      user: 'system',
      entityId: 'test-1',
      entityType: 'test',
    };

    // Should not throw - audit failures are logged but don't break business logic
    await expect(service.logOperation(auditEntry)).resolves.toBeUndefined();
  });

  it('should handle JSON serialization of complex state objects', async () => {
    const complexBefore = {
      status: 'active',
      nested: { value: 123, array: [1, 2, 3] },
    };

    const complexAfter = {
      status: 'released',
      nested: { value: 456, array: [4, 5, 6] },
    };

    await service.logOperation({
      operation: 'UPDATE',
      user: 'admin',
      entityId: 'entity-1',
      entityType: 'test',
      beforeState: complexBefore,
      afterState: complexAfter,
    });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        JSON.stringify(complexBefore),
        JSON.stringify(complexAfter),
        null,
      ]),
    );
  });
});
