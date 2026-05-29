/**
 * HeldEntityPositionRegistry — 持っているエンティティの位置を
 * React state を介さずに DOM ノードへ直接適用するシングルトン。
 *
 * 設計の狙い:
 *  - cursor:moved イベントは頻繁に届く（50ms throttle）
 *  - React state で受けると EntityRenderer が毎回 re-render される
 *  - 代わりに div.style.xxx を直接書き換える（ゲームループ的アプローチ）
 *  - これで「カーソルと同化する」滑らかな追従を実現しつつ React の負荷を最小化する
 *
 * 使い方:
 *  1. EntityRenderer の useEffect 内で subscribe(entityId, div) を呼ぶ
 *  2. socket cursor:moved イベントで notify(entityId, x, y) を呼ぶ
 *  3. subscribe は cleanup 時に返却された unsubscribe を呼ぶ
 */

type PositionListener = (viewportX: number, viewportY: number) => void;

class HeldEntityPositionRegistryImpl {
    /** entityId → リスナー（DOM 更新関数）の Map */
    private readonly listeners = new Map<string, Set<PositionListener>>();

    /**
     * エンティティ div を登録する。
     * EntityRenderer の useEffect で呼ぶ。
     * @returns unsubscribe 関数（cleanup で呼ぶ）
     */
    subscribe(entityId: string, listener: PositionListener): () => void {
        let set = this.listeners.get(entityId);
        if (!set) {
            set = new Set();
            this.listeners.set(entityId, set);
        }
        set.add(listener);
        return () => {
            const cur = this.listeners.get(entityId);
            if (!cur) return;
            cur.delete(listener);
            if (cur.size === 0) this.listeners.delete(entityId);
        };
    }

    /**
     * エンティティの viewport 座標を更新する。
     * cursor:moved イベントや pointermove から呼ぶ。
     * オフセット計算は呼び出し側が行う。
     */
    notify(entityId: string, viewportX: number, viewportY: number): void {
        const set = this.listeners.get(entityId);
        if (!set) return;
        for (const fn of set) {
            fn(viewportX, viewportY);
        }
    }
}

/** モジュールシングルトン — React ツリーの外から参照可能 */
export const HeldEntityPositionRegistry = new HeldEntityPositionRegistryImpl();
