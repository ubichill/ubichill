import type { Entity, Query } from './types';

/**
 * コンポーネント名でエンティティを絞り込むクエリ。
 *
 * 鮮度の契約:
 * - `_allEntities` は world.query() 呼び出し時点のスナップショット。新規エンティティは
 *   再クエリ（world.query()）まで反映されない。
 * - 既存エンティティの component 追加/削除は、`execute()` のたびに再フィルタするため
 *   保持した Query からでも反映される（結果キャッシュを持たない）。
 */
export class QueryImpl implements Query {
    private _allEntities: Entity[];
    private _componentNames: string[];

    constructor(entities: Entity[], componentNames: string[]) {
        this._allEntities = entities;
        this._componentNames = componentNames;
    }

    execute(): Entity[] {
        return this._allEntities.filter((entity) => this._componentNames.every((name) => entity.hasComponent(name)));
    }

    changed(): Entity[] {
        return this.execute();
    }
}
