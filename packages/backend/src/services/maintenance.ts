import { appConfig } from '../config';
import { redis } from '../lib/redis';
import { logger } from '../utils/logger';
import { leaseFor } from './lease';
import { createLeaseGate } from './leaseGate';

// 掃除の間隔の数倍。ただし 1 回の掃除が Go の応答待ちで延びても、途中でほかの backend に移らない長さは取る
const ttlMs = Math.max(appConfig.instance.reapIntervalMs * 5, 15_000);

/**
 * 定期の掃除（空インスタンス・期限切れの CLI 認可）を動かす backend を 1 台に絞るリース（`ubi:lease:reaper`）。
 * Redis なしならプロセス内のリース（常に自分）。
 */
export const maintenanceGate = createLeaseGate(leaseFor(redis ?? undefined), 'reaper', ttlMs, logger);
