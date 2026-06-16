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
 *     「インスタンスが見つかりません」で失敗する。これを防ぐため
 *     `createdAt + emptyTimeoutMs` を過ぎるまでは在席0でも削除しない。
 *   - createdAt は DB の値なので再起動をまたいでも grace が正しく効く。
 */
class InstanceReaper {
    private timer: NodeJS.Timeout | null = null;

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

        const reapable = all.filter((inst) => {
            const isEmpty = userManager.getUsersByWorld(inst.id).length === 0;
            const isPastGrace = now - inst.createdAt.getTime() >= graceMs;
            return isEmpty && isPastGrace;
        });

        for (const inst of reapable) {
            await instanceRepository.delete(inst.id);
            clearInstanceState(inst.id);
            logger.info(`インスタンス自動削除（在席0・猶予経過）: ${inst.id}`);
        }

        return reapable.length;
    }
}

export const instanceReaper = new InstanceReaper();
