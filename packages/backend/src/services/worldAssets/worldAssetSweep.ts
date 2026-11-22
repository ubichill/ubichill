/**
 * 使われていないワールドの画像の掃除。このサーバーのどのワールド（下書き・版）からも指されず、上げて（上げ直して）から
 * 猶予を過ぎた画像を消す。猶予は、エディタで上げてまだ保存していない画像を守る。何を「使われている」とするかは repository。
 */
import type { LeaseGate } from '../cluster/leaseGate';

const HOUR_MS = 60 * 60 * 1000;
const MB = 1024 * 1024;

export const WORLD_ASSET_SWEEP = {
    graceMs: 7 * 24 * HOUR_MS,
    intervalMs: 6 * HOUR_MS,
    /** 起動の少し後にも回す（再起動が続いても間隔のぶん待たせない） */
    startDelayMs: 60 * 1000,
    /** 1 回の DELETE で消す数（長いトランザクションにしない） */
    batch: 500,
} as const;

export interface WorldAssetSweepSummary {
    count: number;
    bytes: number;
}

export interface WorldAssetSweepDeps {
    repository: {
        removeUnreferenced(cutoff: Date, limit: number): Promise<ReadonlyArray<{ byteSize: number }>>;
    };
    /** 複数の backend のうち 1 台だけで回す */
    gate: Pick<LeaseGate, 'run'>;
    log(message: string): void;
}

export function createWorldAssetSweep(deps: WorldAssetSweepDeps) {
    const sweep = async (at: Date, checkpoint: () => Promise<boolean>): Promise<WorldAssetSweepSummary> => {
        const cutoff = new Date(at.getTime() - WORLD_ASSET_SWEEP.graceMs);
        const removeFrom = async (total: WorldAssetSweepSummary): Promise<WorldAssetSweepSummary> => {
            if (!(await checkpoint())) return total;
            const removed = await deps.repository.removeUnreferenced(cutoff, WORLD_ASSET_SWEEP.batch);
            const next = {
                count: total.count + removed.length,
                bytes: total.bytes + removed.reduce((sum, row) => sum + row.byteSize, 0),
            };
            return removed.length < WORLD_ASSET_SWEEP.batch ? next : removeFrom(next);
        };
        const total = await removeFrom({ count: 0, bytes: 0 });
        if (total.count > 0) {
            deps.log(
                `使われていないワールドの画像を ${total.count} 枚（${(total.bytes / MB).toFixed(1)} MB）消しました`,
            );
        }
        return total;
    };

    return {
        /** リースを持っていれば掃除する。持っていなければ（ほかの backend が担当・Redis 障害）null。 */
        runOnce: (at = new Date()): Promise<WorldAssetSweepSummary | null> =>
            deps.gate.run((checkpoint) => sweep(at, checkpoint)),
    };
}
