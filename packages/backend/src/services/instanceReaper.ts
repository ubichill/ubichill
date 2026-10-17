import { instanceRepository } from '@ubichill/db';
import { appConfig } from '../config';
import { redis } from '../lib/redis';
import { logger } from '../utils/logger';
import { type AbsenceClock, absenceClockFor } from './absenceClock';
import { instanceRuntime } from './instanceRuntime';
import type { LeaseGate } from './leaseGate';
import { maintenanceGate } from './maintenance';

/**
 * 空インスタンスの掃除（reaper）。
 *
 * 責務はただ一つ:「誰も居ない & 作成から十分経った instance を DB から消す」。
 * InstanceManager（CRUD）からライフタイム管理を分離することで、神クラス化を防ぐ。
 *
 * 設計（なぜインメモリ setTimeout を使わないか）:
 *   - 旧実装は instance ごとに setTimeout を Map で抱えていた。これは
 *       1. nodemon / Pod 再起動でタイマーが全部消え、孤児 instance が永久に残る
 *       2. プロセス単位なので、作成したプロセスが死ぬと誰も削除しない
 *     という二重の脆さがあった。
 *   - reaper は「DB を定期スイープし、Go側の在席で生存判定する」ステートレス方式。
 *     再起動してもインメモリ状態に依存しないので孤児が確実に回収される。
 *   - 複数の backend では、リース（{@link LeaseGate}）を持つ 1 台だけが掃除する。
 *     Go に部屋が無いと最初に観測した時刻（復旧猶予の起点）は {@link AbsenceClock} で共有する。
 *
 * 「作成直後の猶予 (birth grace)」:
 *   - createInstance した本人が join する前に消されると world:join が
 *     「インスタンスが見つかりません」で失敗する。これを防ぐため、作成から
 *     emptyTimeoutMs（Goに部屋が無ければrecoveryGraceMs）を過ぎるまでは在席0でも削除しない。
 *   - 作成時刻は DB の created_at（timestamptz）だけを使う。プロセス内に持つと、backend が
 *     複数あるとき作成した Pod 以外では猶予が効かない。timestamptz は瞬間を保存するので、
 *     DB のセッションの TimeZone に関係なく getTime() は実時刻と一致する。
 */
export class InstanceReaper {
    private timer: NodeJS.Timeout | null = null;
    private sweeping = false;
    constructor(private readonly deps: { gate: LeaseGate; absence: AbsenceClock }) {}

    /** 定期スイープを開始（多重起動はガード）。 */
    start(): void {
        if (this.timer) return;
        const intervalMs = appConfig.instance.reapIntervalMs;
        this.timer = setInterval(() => {
            if (this.sweeping) return;
            this.sweeping = true;
            void this.runOnce()
                .catch((err) => {
                    logger.error('インスタンス掃除中にエラー:', err);
                })
                .finally(() => {
                    this.sweeping = false;
                });
        }, intervalMs);
        // スイープ自体は Node の終了を妨げない
        this.timer.unref?.();
        logger.info(
            `🧹 インスタンス reaper 起動: ${intervalMs / 1000}秒ごとにスイープ（猶予 ${appConfig.instance.emptyTimeoutMs / 1000}秒）`,
        );
    }

    /** 定期スイープを停止（テスト/シャットダウン用）。 */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** リースを持っていればスイープして削除件数を返す。持っていなければ（ほかの backend が担当・Redis 障害）null。 */
    async runOnce(): Promise<number | null> {
        return this.deps.gate.run((checkpoint) => this.sweepOnce(checkpoint));
    }

    /**
     * 1 回分のスイープ。削除した件数を返す。
     * Go側の空室時刻と生成時刻から猶予を過ぎた instance を削除する。
     * Goに部屋が無い場合は復元待ちの猶予を使う。
     */
    async sweepOnce(checkpoint: () => Promise<boolean> = async () => true): Promise<number> {
        const graceMs = appConfig.instance.emptyTimeoutMs;
        const now = Date.now();
        const all = await instanceRepository.findAll({ includeFull: true });
        const presence = await instanceRuntime.presence();

        if (!(await checkpoint())) return 0;
        const ids = all.map((inst) => inst.id);
        await this.deps.absence.forget(ids.filter((id) => presence.has(id)));
        const absentSince = await this.deps.absence.since(
            ids.filter((id) => !presence.has(id)),
            now,
        );

        const reapable = all.filter((inst) => {
            const runtime = presence.get(inst.id);
            const isEmpty = !runtime || runtime.memberIds.length === 0;
            const bornMs = inst.createdAt.getTime();
            const emptySince = runtime ? runtime.emptySince : (absentSince.get(inst.id) ?? now);
            const requiredGraceMs = runtime ? graceMs : appConfig.instance.recoveryGraceMs;
            const isPastGrace = now - Math.max(bornMs, emptySince) >= requiredGraceMs;
            return isEmpty && isPastGrace;
        });

        const removed: string[] = [];
        for (const inst of reapable) {
            if (!(await checkpoint())) break;
            if (!(await instanceRuntime.close(inst.id, now - graceMs))) continue;
            if (!(await checkpoint())) break;
            await instanceRepository.delete(inst.id);
            removed.push(inst.id);
            logger.info(`インスタンス自動削除（在席0・猶予経過）: ${inst.id}`);
        }
        if (await checkpoint()) await this.deps.absence.forget(removed);

        return removed.length;
    }
}

// 消し忘れ（reaper 以外で消えたインスタンス）の記録が残り続けないための期限。過ぎても数え直すだけ（消し過ぎない）
const ABSENCE_TTL_MS = appConfig.instance.recoveryGraceMs + 24 * 60 * 60 * 1000;

export const instanceReaper = new InstanceReaper({
    gate: maintenanceGate,
    absence: absenceClockFor(redis ?? undefined, ABSENCE_TTL_MS),
});
