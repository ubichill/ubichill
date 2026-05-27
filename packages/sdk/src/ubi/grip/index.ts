/**
 * Ubi.grip — 自エンティティを「掴める / 持てるオブジェクト」として宣言する SDK プリミティブ。
 *
 * Pure ECS 上で「ユーザーが今このエンティティを掴んでいる」状態を扱うのは多くの
 * プラグイン (pen / ペット / ホワイトボードのカードなど) に共通する関心事。
 * 各プラグインが lockedBy + 1 ユーザー 1 本ルールを毎回書くのは冗長で、しかも
 * 競合条件 (query → update の隙に同時 click) を取りこぼしやすい。
 *
 * このモジュールは:
 *  - 占有者を ComponentInstance.lockedBy (top-level) として永続同期する
 *  - acquire() 時に「同じ Component type の全 worker」(scope='world') に内部 emit で
 *    「離せ」を伝える。兄弟階層に依らない世界横断ルール ("1 ユーザー = 同種 1 つ") を実現
 *  - 同時取得は acquireEpoch (Date.now) の新しい方が勝つ調停を SDK 側で完結
 *  - 受け手側プラグインは ev.type を意識しなくていい (event 名前空間は予約済み)
 */

import type { EventModule } from '../event';
import type { StateModule } from '../state';

const GRIP_CLAIM_EVENT = '__ubi__:grip:claim';

interface GripClaim {
    userId: string;
    senderId: string;
    epoch: number;
}

export interface Grip {
    /** 現在掴んでいるユーザー (`null` = 誰も掴んでない) */
    readonly holder: string | null;
    /** 自分が掴んでいるか */
    readonly isMine: boolean;
    /** 掴む。1 ユーザー 1 つの制約を SDK が同タブ siblings に対して enforce する。 */
    acquire(): void;
    /** 離す */
    release(): void;
    /** 占有者の変化を監視。戻り関数で unregister。 */
    onChange(listener: (next: string | null, prev: string | null) => void): () => void;
}

export type GripModuleDeps = {
    state: StateModule;
    event: EventModule;
    getMyUserId(): string | undefined;
    getComponentInstanceId(): string | undefined;
    getComponentType(): string | undefined;
};

export type GripModule = {
    /**
     * 自エンティティを「同じ Component type の中で 1 ユーザー 1 つだけ掴める」
     * 排他オブジェクトとして公開する。
     *
     * ```ts
     * // pen.worker
     * const grip = Ubi.grip.exclusive();
     * onUbiClick={() => grip.isMine ? grip.release() : grip.acquire()}
     * grip.onChange(renderPen);
     * ```
     *
     * **スコープ**: 同じ Component type のエンティティであれば、世界中どの subtree に
     * いても 1 つだけ。たとえばペンが複数 tray に分散していても「ユーザー A は
     * 同時に 1 本しか持てない」という制約が SDK 側で enforce される。
     * 古い hold は acquire() の emit (scope='world') で自動的に解放される。
     * プラグイン側に「1 本だけ」のコードを書く必要はない。
     */
    exclusive(): Grip;
};

export function createGripModule(deps: GripModuleDeps): GripModule {
    return {
        exclusive: (): Grip => {
            // 占有者は top-level lockedBy として永続同期 (既存の state.sync mechanism を利用)
            const inner = deps.state.define({
                holder: deps.state.sync<string | null>(null, { topLevel: 'lockedBy' }),
            });

            // ローカルでだけ持つ取得時刻。同時 click の調停に使う (お互いキャンセル防止)。
            let acquireEpoch = 0;

            // Grip.onChange は inner.onChange を素通し
            const listeners = new Set<(next: string | null, prev: string | null) => void>();
            inner.onChange('holder', (next, prev) => {
                for (const fn of listeners) fn(next as string | null, prev as string | null);
            });

            // 同タブ siblings からの「占有を奪った」通知を受け取る
            const gripEvents = deps.event.define<{ '__ubi__:grip:claim': GripClaim }>();
            gripEvents.on(GRIP_CLAIM_EVENT, ({ userId, senderId, epoch }) => {
                if (senderId === deps.getComponentInstanceId()) return; // 自分の echo は無視
                if (inner.local.holder !== userId) return; // 別ユーザーが掴んでるならスルー
                if (acquireEpoch > epoch) return; // 自分の方が新しく取った
                inner.local.holder = null;
            });

            return {
                get holder() {
                    return inner.local.holder;
                },
                get isMine() {
                    const me = deps.getMyUserId();
                    return me !== undefined && inner.local.holder === me;
                },
                acquire(): void {
                    const me = deps.getMyUserId();
                    const self = deps.getComponentInstanceId();
                    const type = deps.getComponentType();
                    if (!me || !self || !type) return;
                    const epoch = Date.now();
                    acquireEpoch = epoch;
                    inner.local.holder = me;
                    // 1 ユーザー = 同種 1 つ ルールはエンティティ階層に依存しない。
                    // 別 tray / 別 subtree にあるペンも同じ componentType なら release 対象。
                    gripEvents.emit(
                        GRIP_CLAIM_EVENT,
                        { userId: me, senderId: self, epoch },
                        { scope: 'world', targetType: type },
                    );
                },
                release(): void {
                    inner.local.holder = null;
                },
                onChange(listener): () => void {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
            };
        },
    };
}
