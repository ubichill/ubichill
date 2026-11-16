import { type Dependency, lockedMods, type ModLock } from '@ubichill/shared';
import { displayedModVersion, type ModSelectionEntry } from './modSelection';

/** 一覧に出せる mod（取得元の一覧の 1 件）。 */
export interface ListableMod {
    id: string;
    name: string;
    version: string;
    baseUrl?: string;
    versions?: ReadonlyArray<{ version: string }>;
}

/** mod 管理の一覧の 1 行。 */
export type ModListRow<M extends ListableMod = ListableMod> =
    | {
          kind: 'available';
          key: string;
          mod: M;
          /** ワールドに入っている（確定済み） */
          installed: boolean;
          /** 入れる予定（選択中） */
          selected: boolean;
          /** 使う版（選択中でなければ最新版） */
          version: string;
          /** 選べる版（新しい順。使う版を必ず含む） */
          versions: string[];
          /** 最新版より古い版を使っている */
          outdated: boolean;
          /** 同じ ID の mod を別の取得元から入れている（同じワールドに同じ ID は 1 つだけ） */
          blocked: boolean;
      }
    /** 取得元の一覧に無い依存（作者参照で入れた mod など）。版は作品ページから入れ直す。 */
    | { kind: 'extra'; key: string; entry: ModSelectionEntry; installed: boolean };

const sameSource = (a?: string, b?: string) => (a ?? '').replace(/\/$/, '') === (b ?? '').replace(/\/$/, '');
const matches = (query: string, ...texts: Array<string | undefined>) =>
    !query || texts.some((text) => text?.toLowerCase().includes(query));

/**
 * 一覧の行。入っている mod を上にまとめ、名前順に並べる（選んでも並びが動かないよう、並びは確定済みの状態だけで決める）。
 * 検索は名前・ID・作者の部分一致。
 */
export function modListRows<M extends ListableMod>(input: {
    mods: readonly M[];
    selected: readonly ModSelectionEntry[];
    dependencies: readonly Dependency[];
    lock: ModLock | undefined;
    query: string;
}): ModListRow<M>[] {
    const query = input.query.trim().toLowerCase();
    const locked = lockedMods(input.lock);
    const isInstalled = (id: string, baseUrl?: string) =>
        input.dependencies.some((d) => d.name === id && sameSource(d.source.url, baseUrl));

    const available = input.mods
        .filter((mod) => matches(query, mod.name, mod.id))
        .map((mod): ModListRow<M> => {
            const entry = input.selected.find((e) => e.id === mod.id && sameSource(e.baseUrl, mod.baseUrl));
            const version = displayedModVersion(
                entry?.version,
                entry ? locked[mod.id]?.version : undefined,
                mod.version,
            );
            return {
                kind: 'available',
                key: `${mod.baseUrl ?? ''} ${mod.id}`,
                mod,
                installed: isInstalled(mod.id, mod.baseUrl),
                selected: !!entry,
                version,
                versions: [...new Set([mod.version, version, ...(mod.versions ?? []).map((v) => v.version)])].sort(
                    compareVersionDesc,
                ),
                outdated: !!entry && version !== mod.version,
                blocked: !entry && input.selected.some((e) => e.id === mod.id),
            };
        });
    const known = new Set(input.mods.map((mod) => `${mod.baseUrl ?? ''} ${mod.id}`));
    const extras = input.selected
        .filter((entry) => !known.has(`${entry.baseUrl ?? ''} ${entry.id}`) && matches(query, entry.id, entry.author))
        .map(
            (entry): ModListRow<M> => ({
                kind: 'extra',
                key: `extra ${entry.id}`,
                entry,
                installed: isInstalled(entry.id, entry.baseUrl),
            }),
        );
    const nameOf = (row: ModListRow<M>) => (row.kind === 'available' ? row.mod.name : row.entry.id);
    return [...available, ...extras].sort(
        (a, b) => Number(b.installed) - Number(a.installed) || nameOf(a).localeCompare(nameOf(b), 'ja'),
    );
}

function compareVersionDesc(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return [0, 1, 2].map((i) => (pb[i] ?? 0) - (pa[i] ?? 0)).find((d) => d !== 0) ?? 0;
}
