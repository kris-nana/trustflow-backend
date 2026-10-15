# Disaster Recovery and Point-in-Time Restoration

This document provides step-by-step procedures for recovering TrustFlow backend services from backup snapshots, including PostgreSQL database and Redis state restoration.

## Table of Contents

- [Overview](#overview)
- [Recovery Objectives](#recovery-objectives)
- [Prerequisites](#prerequisites)
- [PostgreSQL Restoration](#postgresql-restoration)
- [Redis Restoration](#redis-restoration)
- [Full System Recovery](#full-system-recovery)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Overview

TrustFlow backend uses two primary data stores that require backup and restoration capabilities:

1. **PostgreSQL** - Persistent relational data (escrows, milestones, gigs, audit logs)
2. **Redis** - In-memory state (sessions, nonces, refresh tokens, idempotency keys, outbox)

Both systems are backed up regularly using automated scripts located in `backend/scripts/`:

- `backup-postgres.sh` - Creates compressed PostgreSQL logical backups
- `backup-redis.sh` - Snapshots Redis RDB and AOF files

## Recovery Objectives

### Recovery Time Objective (RTO)

**Target RTO: 30-60 minutes**

The time required to restore service depends on:

- Database size (PostgreSQL restore is dominated by data load time)
- Network bandwidth (for pulling backups from remote storage)
- Redis snapshot size (typically faster than PostgreSQL)

Typical recovery times:

- **Small database** (<1GB): 10-15 minutes
- **Medium database** (1-10GB): 20-40 minutes
- **Large database** (>10GB): 45-90 minutes

### Recovery Point Objective (RPO)

**Target RPO: 24 hours (daily backups)**

- Backups run daily via cron or Kubernetes CronJob
- Maximum acceptable data loss is the interval between last successful backup and failure
- For critical production workloads, consider more frequent backups (hourly or every 6 hours)

**Recommendation**: For RPO < 1 hour, implement PostgreSQL streaming replication with WAL archiving and Redis AOF persistence with more frequent snapshots.

## Prerequisites

### Required Tools

Ensure the following tools are installed on the recovery host:

```bash
# PostgreSQL client
sudo apt-get install postgresql-client  # Ubuntu/Debian
brew install postgresql                 # macOS

# Redis client
sudo apt-get install redis-tools        # Ubuntu/Debian
brew install redis                      # macOS

# Verification tools
sha256sum  # Linux (usually pre-installed)
shasum     # macOS (usually pre-installed)
```

### Access Requirements

- Backup files location (local filesystem or cloud storage)
- Target database credentials and connection strings
- Appropriate permissions (backup files are chmod 600, directories are 700)

### Environment Variables

Set these before running restoration commands:

```bash
# PostgreSQL
export DATABASE_URL="postgresql://user:password@host:5432/database"

# Redis
export REDIS_URL="redis://localhost:6379"
```

## PostgreSQL Restoration

### Step 1: Locate the Backup

Backups are stored in the configured `BACKUP_DIR` (default: `/var/backups/trustflow/postgres`).

```bash
# List available backups
ls -lh /var/backups/trustflow/postgres/

# Example output:
# trustflow-20261015T083000Z.sql.gz
# trustflow-20261015T083000Z.sql.gz.sha256
# trustflow-20261015T083000Z.sql.gz.meta
```

Each backup includes:

- `.sql.gz` - Compressed PostgreSQL dump
- `.sha256` - Checksum for integrity verification
- `.meta` - Metadata (timestamp, database name, server version)

### Step 2: Verify Backup Integrity

Always verify the backup before attempting restoration:

```bash
./scripts/restore-postgres.sh \
  --file /var/backups/trustflow/postgres/trustflow-20261015T083000Z.sql.gz \
  --verify-only
```

Expected output:

```
[restore-postgres 2026-10-15T10:30:00Z] Verifying checksum
trustflow-20261015T083000Z.sql.gz: OK
[restore-postgres 2026-10-15T10:30:01Z] Verifying the dump decompresses and contains statements
[restore-postgres 2026-10-15T10:30:02Z] Dump verified; --verify-only set, nothing was written
```

### Step 3: Restore to Target Database

**⚠️ WARNING**: This operation will DROP existing tables. Always verify you're targeting the correct database.

#### Restore to Empty Database (Safe)

```bash
./scripts/restore-postgres.sh \
  --file /var/backups/trustflow/postgres/trustflow-20261015T083000Z.sql.gz \
  --target-url "postgresql://user:password@localhost:5432/trustflow_restored"
```

#### Restore Over Existing Database (Requires --force)

```bash
./scripts/restore-postgres.sh \
  --file /var/backups/trustflow/postgres/trustflow-20261015T083000Z.sql.gz \
  --target-url "postgresql://user:password@localhost:5432/trustflow_prod" \
  --force
```

The `--force` flag is required when the target database already contains tables. The script will:

1. Verify integrity
2. Drop existing objects (due to `--clean --if-exists` in the dump)
3. Restore all tables, indexes, and data
4. Run in a single transaction (all-or-nothing)

### Step 4: Verify Restoration

```bash
# Connect to restored database
psql "postgresql://user:password@localhost:5432/trustflow_restored" -c "
  SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

Check that critical tables exist and have expected row counts:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM escrow;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM gigs;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM audit_log;"
```

## Redis Restoration

### Step 1: Locate the Redis Snapshot

Redis snapshots are stored in timestamped directories:

```bash
ls -lh /var/backups/trustflow/redis/

# Example output:
# 20261015T083000Z/
#   ├── dump.rdb
#   ├── appendonlydir/
#   ├── manifest.sha256
#   └── meta
```

### Step 2: Stop Redis (if restoring to live instance)

```bash
# For Docker container
docker stop trustflow-redis

# For systemd service
sudo systemctl stop redis-server

# For manual Redis server
redis-cli SHUTDOWN SAVE
```

### Step 3: Replace Redis Data Files

```bash
# Backup current Redis data (optional but recommended)
cp /var/lib/redis/dump.rdb /var/lib/redis/dump.rdb.backup.$(date +%Y%m%d%H%M%S)

# Copy snapshot to Redis data directory
SNAPSHOT_DIR="/var/backups/trustflow/redis/20261015T083000Z"
REDIS_DATA_DIR="/var/lib/redis"

cp "${SNAPSHOT_DIR}/dump.rdb" "${REDIS_DATA_DIR}/dump.rdb"

# If AOF is enabled, also restore appendonly files
if [ -d "${SNAPSHOT_DIR}/appendonlydir" ]; then
  cp -r "${SNAPSHOT_DIR}/appendonlydir" "${REDIS_DATA_DIR}/"
fi

# Set proper permissions
chown redis:redis "${REDIS_DATA_DIR}/dump.rdb"
chmod 640 "${REDIS_DATA_DIR}/dump.rdb"
```

### Step 4: Start Redis

```bash
# For Docker container
docker start trustflow-redis

# For systemd service
sudo systemctl start redis-server

# Wait for Redis to load the snapshot
redis-cli -u "$REDIS_URL" PING
```

### Step 5: Verify Redis Data

```bash
# Check number of keys (compare with meta file)
redis-cli -u "$REDIS_URL" DBSIZE

# Inspect sample keys
redis-cli -u "$REDIS_URL" KEYS "escrow:*" | head -5
redis-cli -u "$REDIS_URL" KEYS "gig:*" | head -5

# Check TTL on temporary keys
redis-cli -u "$REDIS_URL" TTL "nonce:some-address"
```

## Full System Recovery

### Scenario: Complete Disaster Recovery

If both PostgreSQL and Redis are lost, follow this procedure:

#### 1. Provision Infrastructure

```bash
# Start fresh PostgreSQL and Redis instances
docker-compose up -d postgres redis

# Or use Kubernetes
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml

# Wait for services to be healthy
./scripts/wait-for-postgres.sh
./scripts/wait-for-redis.sh
```

#### 2. Restore PostgreSQL First

```bash
# Restore to empty database
export DATABASE_URL="postgresql://trustflow:trustflow@localhost:5432/trustflow"

./scripts/restore-postgres.sh \
  --file /var/backups/trustflow/postgres/trustflow-20261015T083000Z.sql.gz \
  --target-url "$DATABASE_URL"
```

#### 3. Restore Redis

```bash
# Stop Redis
docker stop trustflow-redis

# Restore snapshot
SNAPSHOT="/var/backups/trustflow/redis/20261015T083000Z"
docker cp "${SNAPSHOT}/dump.rdb" trustflow-redis:/data/dump.rdb

# Start Redis
docker start trustflow-redis
```

#### 4. Restart Application

```bash
# Backend application will connect to restored databases
docker-compose restart backend

# Or Kubernetes
kubectl rollout restart deployment/trustflow-backend
```

#### 5. Run Health Checks

```bash
# Check application health endpoint
curl http://localhost:3000/health

# Verify database connectivity
curl http://localhost:3000/health/postgres

# Verify Redis connectivity
curl http://localhost:3000/health/redis
```

### Scenario: Point-in-Time Recovery

To restore to a specific point in time:

1. **Identify the backup timestamp** closest to (but before) the desired recovery point
2. **Check backup metadata** to confirm the backup time:
   ```bash
   cat /var/backups/trustflow/postgres/trustflow-20261015T083000Z.sql.gz.meta
   ```
3. **Follow normal restoration procedure** using that backup file
4. **Accept data loss** for any transactions after the backup timestamp

**Note**: True point-in-time recovery (PITR) within the backup interval requires PostgreSQL WAL archiving, which is not currently implemented. Consider enabling WAL archiving for production deployments requiring finer-grained recovery.

## Verification

### Post-Restoration Checklist

After restoring from backup, verify the following:

#### PostgreSQL Verification

- [ ] All expected tables exist
- [ ] Row counts match expectations (compare with monitoring data)
- [ ] Indexes are present and valid
- [ ] Foreign key constraints are enforced
- [ ] Latest audit log entries are from backup timestamp
- [ ] Application can connect and query successfully

```bash
# Run verification queries
psql "$DATABASE_URL" <<EOF
\dt+
SELECT MAX(created_at) FROM audit_log;
SELECT COUNT(*) FROM escrow WHERE status = 'active';
SELECT pg_size_pretty(pg_database_size(current_database()));
EOF
```

#### Redis Verification

- [ ] Key count matches backup metadata
- [ ] Critical keys exist (sessions, nonces, outbox)
- [ ] TTL values are reasonable
- [ ] Application can connect and read/write successfully

```bash
# Run verification commands
redis-cli -u "$REDIS_URL" INFO stats
redis-cli -u "$REDIS_URL" DBSIZE
redis-cli -u "$REDIS_URL" --scan --pattern "outbox:*" | wc -l
```

#### Application Verification

- [ ] Health endpoint returns 200 OK
- [ ] Authentication works (login flow)
- [ ] Read operations succeed (list escrows, gigs)
- [ ] Write operations succeed (create test escrow)
- [ ] Background jobs resume (check logs for sweep/expiry workers)

### Smoke Test Script

```bash
#!/bin/bash
# smoke-test-after-restore.sh

set -e

API_URL="http://localhost:3000"

echo "Running post-restoration smoke tests..."

# Health checks
curl -f "$API_URL/health" || exit 1
curl -f "$API_URL/health/postgres" || exit 1
curl -f "$API_URL/health/redis" || exit 1

# Database connectivity
psql "$DATABASE_URL" -c "SELECT 1" >/dev/null || exit 1
redis-cli -u "$REDIS_URL" PING >/dev/null || exit 1

echo "✅ All smoke tests passed"
```

## Troubleshooting

### PostgreSQL Issues

#### "dump failed gzip integrity verification"

**Cause**: Backup file is corrupted or incomplete.

**Solution**:

1. Use a different backup file
2. Check backup logs for errors during creation
3. Verify the source backup wasn't taken during a disk-full condition

#### "target database has N table(s) in public"

**Cause**: Script refuses to overwrite existing data without explicit consent.

**Solution**:

- Add `--force` flag if you intend to replace the existing database
- Or restore to a different database name first, then switch connections

#### "psql failed during restore"

**Cause**: Incompatible PostgreSQL versions or missing extensions.

**Solution**:

1. Check server version: `psql "$DATABASE_URL" -c "SHOW server_version"`
2. Ensure extensions are available: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`
3. Review error messages in psql output

### Redis Issues

#### "Empty snapshot"

**Cause**: Redis was empty when backup was taken, or BGSAVE failed.

**Solution**:

- Check Redis logs at backup time
- Use a different snapshot
- Verify BGSAVE completes: `redis-cli INFO persistence`

#### "Permission denied"

**Cause**: Incorrect file ownership on restored dump.rdb.

**Solution**:

```bash
chown redis:redis /var/lib/redis/dump.rdb
chmod 640 /var/lib/redis/dump.rdb
```

#### "Keys missing after restore"

**Cause**:

- Backup was taken before recent writes
- TTL expired on keys
- AOF not restored alongside RDB

**Solution**:

- Accept RPO data loss for recent writes
- If AOF exists, restore it alongside dump.rdb
- Check backup metadata for dbsize at snapshot time

### Application Issues

#### "Cannot connect to database"

**Cause**: DATABASE_URL not set or pointing to wrong host.

**Solution**:

```bash
export DATABASE_URL="postgresql://trustflow:trustflow@localhost:5432/trustflow"
# Restart application
```

#### "Redis connection refused"

**Cause**: Redis not started after restoration.

**Solution**:

```bash
docker start trustflow-redis
# Or systemctl start redis-server
```

#### "Schema mismatch errors"

**Cause**: Application code version doesn't match restored database schema.

**Solution**:

1. Deploy application version that matches the backup timestamp
2. Or run pending migrations: `POST /migrations/:name/run`
3. Check migration status: `GET /migrations/runs`

## Backup Best Practices

### For Production Environments

1. **Test restores regularly** (monthly) to ensure backups are actually restorable
2. **Store backups off-site** (S3, GCS, Azure Blob) to survive regional failures
3. **Enable encryption** for backups at rest if they contain PII
4. **Monitor backup jobs** - alert on failures immediately
5. **Document runbooks** and keep them updated with infrastructure changes
6. **Implement PostgreSQL streaming replication** for high-availability scenarios
7. **Enable Redis persistence** (AOF + RDB) for better durability
8. **Consider WAL archiving** for PostgreSQL PITR within the backup interval

### Backup Retention Strategy

Default retention is 14 days. Adjust based on compliance and storage costs:

```bash
# Set retention for monthly backups
export BACKUP_RETENTION_DAYS=90

# For compliance (e.g., SOC 2, GDPR audit logs)
export BACKUP_RETENTION_DAYS=365
```

Consider tiered retention:

- **Daily backups**: 14 days
- **Weekly backups**: 90 days
- **Monthly backups**: 365 days

---

**Last Updated**: October 2026  
**Maintained By**: TrustFlow Infrastructure Team  
**Related Documentation**:

- [Backend Setup Instructions](../SETUP_INSTRUCTIONS.md)
- [Deployment Guide](../DEPLOYMENT_SPIKE.md)
- [Backup Scripts](../scripts/)
