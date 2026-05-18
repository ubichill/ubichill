import type { PluginGuestCommand, WorldEntity } from '@ubichill/shared';
import type { OmitId } from '../types';

export interface EntityModule {
    /** 自 Entity 上の他 Component (自分自身は除く)。 */
    getSiblings<T = unknown>(): Promise<WorldEntity<T>[]>;
    /** 自 Entity 上で指定 type の最初の他 Component。なければ null。 */
    getSibling<T = unknown>(type: string): Promise<WorldEntity<T> | null>;
    /** 親 Entity 上の Component 一覧 (type 指定で絞り込み)。 */
    getParent<T = unknown>(type?: string): Promise<WorldEntity<T>[]>;
    /** 親 Entity 上で type 指定の最初の Component。 */
    getParentComponent<T = unknown>(type: string): Promise<WorldEntity<T> | null>;
    /** 直接の子 Entity 上の Component 一覧 (type 指定で絞り込み)。 */
    getChildren<T = unknown>(type?: string): Promise<WorldEntity<T>[]>;
    /** 自 Entity + 子孫の Component から type 一致を集める。 */
    queryInSubtree<T = unknown>(type: string): Promise<WorldEntity<T>[]>;
}

export function createEntityModule(rpc: <T>(cmd: OmitId<PluginGuestCommand>) => Promise<T>): EntityModule {
    const getSiblings = <T>() => rpc<WorldEntity<T>[]>({ type: 'ENTITY_GET_SIBLINGS', payload: {} });
    const getParentList = <T>(entityType?: string) =>
        rpc<WorldEntity<T>[]>({ type: 'ENTITY_GET_PARENT', payload: { entityType } });
    const getChildrenList = <T>(entityType?: string) =>
        rpc<WorldEntity<T>[]>({ type: 'ENTITY_GET_CHILDREN', payload: { entityType } });

    return {
        getSiblings,
        async getSibling<T>(type: string) {
            const all = await getSiblings<T>();
            return all.find((e) => e.type === type) ?? null;
        },
        getParent: getParentList,
        async getParentComponent<T>(type: string) {
            const all = await getParentList<T>(type);
            return all[0] ?? null;
        },
        getChildren: getChildrenList,
        queryInSubtree: <T>(type: string) =>
            rpc<WorldEntity<T>[]>({ type: 'ENTITY_QUERY_SUBTREE', payload: { entityType: type } }),
    };
}
