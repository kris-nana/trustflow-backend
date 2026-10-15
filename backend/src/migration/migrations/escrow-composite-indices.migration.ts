import { Injectable, Inject } from '@nestjs/common';
import { BackfillBatchResult, SchemaMigration } from '../migration.types';
import { DatabaseService } from '../../common/database/database.service';

/**
 * Expand/contract migration for the escrow and milestone tables: adds composite
 * B-tree indices on (depositor, status), (beneficiary, status), and createdAt
 * to optimize user dashboard queries.
 *
 * - expand: creates the composite indices with CONCURRENTLY to avoid table locks
 * - backfill: no-op (indices are built during creation)
 * - contract: no-op (indices are retained)
 */
@Injectable()
export class EscrowCompositeIndicesMigration extends SchemaMigration {
  readonly name = 'escrow-add-composite-indices';
  readonly targetTable = 'escrow';
  readonly description =
    'Adds composite B-tree indices on (depositor, status), (beneficiary, status), and createdAt for optimized dashboard queries.';

  constructor(private readonly db: DatabaseService) {
    super();
  }

  async expand(): Promise<void> {
    // Create composite indices with CONCURRENTLY to avoid locking the table
    await this.db.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escrow_depositor_status 
      ON escrow (depositor, status)
    `);

    await this.db.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escrow_beneficiary_status 
      ON escrow (beneficiary, status)
    `);

    await this.db.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escrow_created_at 
      ON escrow (createdAt)
    `);

    // Also add indices for milestone table if it exists
    const milestoneTableExists = await this.db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'milestone'
      ) as exists
    `);

    if (milestoneTableExists.rows[0]?.exists) {
      await this.db.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_milestone_depositor_status 
        ON milestone (depositor, status)
      `);

      await this.db.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_milestone_beneficiary_status 
        ON milestone (beneficiary, status)
      `);

      await this.db.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_milestone_created_at 
        ON milestone (createdAt)
      `);
    }
  }

  async countPending(): Promise<number> {
    // No rows to backfill — indices are built during creation
    return 0;
  }

  async backfillBatch(
    cursor: string | undefined,
    batchSize: number,
  ): Promise<BackfillBatchResult> {
    // No backfill needed
    return { processed: 0, failed: 0, nextCursor: cursor, done: true };
  }

  async contract(): Promise<void> {
    // Keep the indices — this is a pure expansion migration
  }

  async rollbackExpand(): Promise<void> {
    // Drop the indices created during expand
    await this.db.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_escrow_depositor_status`);
    await this.db.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_escrow_beneficiary_status`);
    await this.db.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_escrow_created_at`);
    await this.db.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_milestone_depositor_status`);
    await this.db.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_milestone_beneficiary_status`);
    await this.db.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_milestone_created_at`);
  }

  async rollbackContract(): Promise<void> {
    // No-op — contract doesn't do anything
  }
}
