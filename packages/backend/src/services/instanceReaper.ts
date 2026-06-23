import { instanceRepository } from '@ubichill/db';
import { appConfig } from '../config';
import { logger } from '../utils/logger';
import { clearInstanceState } from './instanceState';
import { userManager } from './userManager';

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
 *   - reaper は「DB を定期スイープし、在席(userManager)で生存判定する」ステートレス方式。
 *     再起動してもインメモリ状態に依存しないので孤児が確実に回収される。
 *
 * 「作成直後の猶予 (birth grace)」:
 *   - createInstance した本人が join する前に消されると world:join が
 *     「インスタンスが見つかりません」で失敗する。これを防ぐため、作成から
 *     emptyTimeoutMs を過ぎるまでは在席0でも削除しない。
 *   - 生成時刻は **createInstance が markCreated() で記録したプロセス内の時刻**を最優先で使う。
 *     DB の created_at は `timestamp`(タイムゾーン無し) で、postgres-js の解釈次第で
 *     getTime() が実時刻からズレ得るため、作りたて instance の猶予判定をこれに頼ると
 *     誤って即削除してしまう（= join で not found）。プロセス内時刻なら確実。
 *   - markCreated 記録が無い instance（再起動前に作られた / warmup 対象）は DB の
 *     created_at にフォールバックする（それらは十分古いので判定ズレても実害が小さい）。
 */
class InstanceReaper {
    private timer: NodeJS.Timeout | null = null;
    /** instanceId → このプロセスで作成した時刻 (ms)。birth grace 判定に使う。 */
    private bornAt = new Map<string, number>();

    /** createInstance から呼ぶ: このプロセスでの生成時刻を記録する。 */
    markCreated(instanceId: string): void {
        this.bornAt.set(instanceId, Date.now());
    }

    /** 定期スイープを開始（多重起動はガード）。 */
    start(): void {
        if (this.timer) return;
        const intervalMs = appConfig.instance.reapIntervalMs;
        this.timer = setInterval(() => {
            void this.sweepOnce().catch((err) => {
                logger.error('インスタンス掃除中にエラー:', err);
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

    /**
     * 1 回分のスイープ。削除した件数を返す。
     * 「在席0」かつ「作成から emptyTimeoutMs 以上経過」の instance を削除する。
     */
    async sweepOnce(): Promise<number> {
        const graceMs = appConfig.instance.emptyTimeoutMs;
        const now = Date.now();
        const all = await instanceRepository.findAll({ includeFull: true });
        const liveIds = new Set(all.map((inst) => inst.id));

        // DB から消えた instance の生成時刻記録を掃除（メモリリーク防止）
        for (const id of this.bornAt.keys()) {
            if (!liveIds.has(id)) this.bornAt.delete(id);
        }

        const reapable = all.filter((inst) => {
            const isEmpty = userManager.getUsersByWorld(inst.id).length === 0;
            // 生成時刻はプロセス内記録を最優先。無ければ DB の created_at にフォールバック。
            const bornMs = this.bornAt.get(inst.id) ?? inst.createdAt.getTime();
            const isPastGrace = now - bornMs >= graceMs;
            return isEmpty && isPastGrace;
        });

        for (const inst of reapable) {
            await instanceRepository.delete(inst.id);
            clearInstanceState(inst.id);
            this.bornAt.delete(inst.id);
            logger.info(`インスタンス自動削除（在席0・猶予経過）: ${inst.id}`);
        }

        return reapable.length;
    }
}

export const instanceReaper = new InstanceReaper();
