import { EscrowCompositeIndicesMigration } from './escrow-composite-indices.migration';

describe('EscrowCompositeIndicesMigration', () => {
  let migration: EscrowCompositeIndicesMigration;
  let mockDb: any;
  let queryCalls: Array<{ sql: string }>;

  beforeEach(() => {
    queryCalls = [];
    mockDb = {
      query: jest.fn().mockImplementation((sql: string) => {
        queryCalls.push({ sql: sql.trim() });
        // Mock response for table existence check
        if (sql.includes('information_schema.tables')) {
          return Promise.resolve({ rows: [{ exists: true }] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };
    migration = new EscrowCompositeIndicesMigration(mockDb);
  });

  it('has the correct migration name and description', () => {
    expect(migration.name).toBe('escrow-add-composite-indices');
    expect(migration.targetTable).toBe('escrow');
    expect(migration.description).toContain('composite B-tree indices');
  });

  describe('expand', () => {
    it('creates all required composite indices on escrow table', async () => {
      await migration.expand();

      const indexCreations = queryCalls.filter(c => c.sql.includes('CREATE INDEX'));
      expect(indexCreations).toHaveLength(6); // 3 for escrow, 3 for milestone

      expect(indexCreations[0].sql).toContain('idx_escrow_depositor_status');
      expect(indexCreations[0].sql).toContain('ON escrow (depositor, status)');

      expect(indexCreations[1].sql).toContain('idx_escrow_beneficiary_status');
      expect(indexCreations[1].sql).toContain('ON escrow (beneficiary, status)');

      expect(indexCreations[2].sql).toContain('idx_escrow_created_at');
      expect(indexCreations[2].sql).toContain('ON escrow (createdAt)');
    });

    it('creates indices with CONCURRENTLY to avoid table locks', async () => {
      await migration.expand();

      const indexCreations = queryCalls.filter(c => c.sql.includes('CREATE INDEX'));
      indexCreations.forEach(call => {
        expect(call.sql).toContain('CONCURRENTLY');
      });
    });

    it('uses IF NOT EXISTS to make expand idempotent', async () => {
      await migration.expand();

      const indexCreations = queryCalls.filter(c => c.sql.includes('CREATE INDEX'));
      indexCreations.forEach(call => {
        expect(call.sql).toContain('IF NOT EXISTS');
      });
    });
  });

  describe('countPending', () => {
    it('returns 0 since no backfill is needed', async () => {
      const count = await migration.countPending();
      expect(count).toBe(0);
    });
  });

  describe('backfillBatch', () => {
    it('immediately reports done with no processing', async () => {
      const result = await migration.backfillBatch(undefined, 100);
      expect(result).toEqual({
        processed: 0,
        failed: 0,
        nextCursor: undefined,
        done: true,
      });
    });
  });

  describe('contract', () => {
    it('is a no-op', async () => {
      await migration.contract();
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });

  describe('rollbackExpand', () => {
    it('drops all created indices', async () => {
      await migration.rollbackExpand();

      const indexDrops = queryCalls.filter(c => c.sql.includes('DROP INDEX'));
      expect(indexDrops).toHaveLength(6);

      expect(indexDrops[0].sql).toContain('DROP INDEX CONCURRENTLY');
      expect(indexDrops[0].sql).toContain('idx_escrow_depositor_status');
      expect(indexDrops[1].sql).toContain('idx_escrow_beneficiary_status');
      expect(indexDrops[2].sql).toContain('idx_escrow_created_at');
    });
  });

  describe('rollbackContract', () => {
    it('is a no-op', async () => {
      await migration.rollbackContract();
      expect(mockDb.query).not.toHaveBeenCalled();
    });
  });
});
