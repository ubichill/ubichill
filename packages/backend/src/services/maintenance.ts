import { appConfig } from '../config';
import { redis } from '../lib/redis';
import { logger } from '../utils/logger';
import { leaseFor } from './lease';
import { createLeaseGate } from './leaseGate';

// 処理中は LeaseGate.run が TTL の 1/3 ごとに更新し、失効したら次の副作用を止める。
const ttlMs = Math.max(appConfig.instance.reapIntervalMs * 5, 15_000);

/**
 * 定期の掃除（空インスタンス・期限切れの CLI 認可）を動かす backend を 1 台に絞るリース（`ubi:lease:reaper`）。
 * Redis なしならプロセス内のリース（常に自分）。
 */
export const maintenanceGate = createLeaseGate(leaseFor(redis ?? undefined), 'reaper', ttlMs, logger);
