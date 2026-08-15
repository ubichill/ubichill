import type { Dependency } from '@ubichill/shared';

/** mod セレクタが扱う最小限の mod 表現（`AvailableMod` の構造部分集合）。 */
export interface SelectableMod {
    id: string;
    name: string;
    version: string;
    /** リモートレジストリ由来の場合に設定される取得元 URL。 */
    baseUrl?: string;
}

/** ユーザーが選択した mod（チェック状態 + バージョン）。まだ dependencies には反映されない。 */
export interface ModSelectionEntry {
    id: string;
    version: string;
    baseUrl?: string;
}

/**
 * 選択中の mod を dependencies エントリへ変換する。
 * `baseUrl` があれば外部 URL 由来、無ければローカル mod として扱う。
 */
export function selectionToDependencies(entries: readonly ModSelectionEntry[]): Dependency[] {
    return entries.map((entry) =>
        entry.baseUrl
            ? { name: entry.id, source: { type: 'url' as const, url: entry.baseUrl, version: entry.version } }
            : { name: entry.id, source: { type: 'local' as const, version: entry.version } },
    );
}

/** 単一の mod を dependencies エントリへ変換する（ローカル/URL を判別）。 */
export function modToDependency(mod: SelectableMod, version: string = 'latest'): Dependency {
    return selectionToDependencies([{ id: mod.id, version, baseUrl: mod.baseUrl }])[0];
}

export interface ModDiffUpdated {
    from: Dependency;
    to: Dependency;
}

export interface ModDiff {
    added: Dependency[];
    removed: Dependency[];
    /** 同一 mod のバージョン/取得元が変わったもの。 */
    updated: ModDiffUpdated[];
}

const dependencyEquals = (a: Dependency, b: Dependency): boolean =>
    a.source.type === b.source.type &&
    (a.source.url ?? undefined) === (b.source.url ?? undefined) &&
    a.source.version === b.source.version;

/** 現在の依存と次の依存の差分（追加/削除/更新）を計算する。 */
export function computeModDiff(current: readonly Dependency[], next: readonly Dependency[]): ModDiff {
    const currentByName = new Map(current.map((d) => [d.name, d]));
    const nextByName = new Map(next.map((d) => [d.name, d]));

    const added: Dependency[] = [];
    const removed: Dependency[] = [];
    const updated: ModDiffUpdated[] = [];

    for (const dep of next) {
        const prev = currentByName.get(dep.name);
        if (!prev) {
            added.push(dep);
        } else if (!dependencyEquals(prev, dep)) {
            updated.push({ from: prev, to: dep });
        }
    }
    for (const dep of current) {
        if (!nextByName.has(dep.name)) removed.push(dep);
    }

    return { added, removed, updated };
}
