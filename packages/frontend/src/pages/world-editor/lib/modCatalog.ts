/**
 * mod 管理の一覧（使用中・ローカル・グローバル・レジストリ）の純粋な計算。
 * 取得元の違い（本体の index.json・レジストリ・作者のカタログ）を ModCandidate にそろえ、
 * ワールドの依存と見比べて「追加できる・使用中・更新できる・同じ ID が入っている」を決める。
 */
import {
    type Dependency,
    type InitialEntity,
    lockedMods,
    type ModLock,
    type PackageDescriptor,
} from '@ubichill/shared';

/** 一覧の 1 件（どの取得元から来たかを問わない形）。 */
export interface ModCandidate {
    /** 取得元・作者・ID で一意 */
    key: string;
    id: string;
    /** 一覧が申告する名前（カタログは名前を持たないので ID）。表示は確かめた manifest の名前を優先する */
    name: string;
    /** 一覧の最新版 */
    version: string;
    /** 選べる版（新しい順。最新版を含む） */
    versions: string[];
    /** 取得元（無ければ本体の mods） */
    baseUrl?: string;
    /** 作者参照で入れる mod の作者（追加するときに署名で確かめる） */
    author?: string;
}

/** index.json（本体の mods・レジストリ）の 1 件。 */
export interface IndexMod {
    id: string;
    name: string;
    version: string;
    versions?: ReadonlyArray<{ version: string }>;
    baseUrl?: string;
}

const trimSlash = (url?: string) => (url ?? '').replace(/\/$/, '');
const candidateKey = (id: string, baseUrl?: string, author?: string) => `${author ?? ''} ${trimSlash(baseUrl)} ${id}`;

export function candidateFromIndex(mod: IndexMod): ModCandidate {
    return {
        key: candidateKey(mod.id, mod.baseUrl),
        id: mod.id,
        name: mod.name,
        version: mod.version,
        versions: sortVersions([mod.version, ...(mod.versions ?? []).map((v) => v.version)]),
        ...(mod.baseUrl ? { baseUrl: mod.baseUrl } : {}),
    };
}

export function candidateFromPackage(pkg: PackageDescriptor): ModCandidate {
    return {
        key: candidateKey(pkg.id, pkg.baseUrl, pkg.author),
        id: pkg.id,
        name: pkg.id,
        version: pkg.version,
        versions: [pkg.version],
        baseUrl: pkg.baseUrl,
        author: pkg.author,
    };
}

/** 依存として書く形。版は常に固定する。 */
export function candidateDependency(candidate: ModCandidate, version: string = candidate.version): Dependency {
    return {
        name: candidate.id,
        source: {
            version,
            ...(candidate.baseUrl ? { url: candidate.baseUrl } : {}),
            ...(candidate.author ? { author: candidate.author } : {}),
        },
    };
}

/** 同じ配布物か。取得元と ID で決める（作者は追加するときに署名で確かめる）。 */
const sameDistribution = (dependency: Dependency, candidate: ModCandidate) =>
    dependency.name === candidate.id && trimSlash(dependency.source.url) === trimSlash(candidate.baseUrl);

/** 使っている版。'latest' のままの依存は lock が固定している版。 */
export function usedVersion(dependency: Dependency, lock: ModLock | undefined): string | undefined {
    return dependency.source.version === 'latest'
        ? lockedMods(lock)[dependency.name]?.version
        : dependency.source.version;
}

export type CandidateStatus =
    | { kind: 'available' }
    | { kind: 'installed'; version?: string; outdated: boolean }
    /** 同じ ID の mod を別の取得元から入れている（1 つのワールドに同じ ID は 1 つだけ） */
    | { kind: 'conflict' };

export function candidateStatus(
    candidate: ModCandidate,
    dependencies: readonly Dependency[],
    lock: ModLock | undefined,
): CandidateStatus {
    const installed = dependencies.find((dep) => dep.name === candidate.id);
    if (!installed) return { kind: 'available' };
    if (!sameDistribution(installed, candidate)) return { kind: 'conflict' };
    const version = usedVersion(installed, lock);
    return { kind: 'installed', version, outdated: !!version && compareVersions(candidate.version, version) > 0 };
}

/** 名前・ID・作者の部分一致（大文字小文字を区別しない）。 */
export function matchesCandidate(candidate: ModCandidate, query: string): boolean {
    const q = query.trim().toLowerCase();
    return !q || [candidate.name, candidate.id, candidate.author].some((text) => text?.toLowerCase().includes(q));
}

/** 同じ候補を 2 回並べない（複数の取得元の一覧をつなげたとき）。最初のものを残す。 */
export function uniqueCandidates(candidates: readonly ModCandidate[]): ModCandidate[] {
    return candidates.filter((candidate, index) => candidates.findIndex((c) => c.key === candidate.key) === index);
}

/** チェックできるか。追加・更新できるものだけで、同じ ID の別の候補をすでにチェックしていればできない。 */
export function checkable(candidate: ModCandidate, status: CandidateStatus, checked: readonly ModCandidate[]): boolean {
    const actionable = status.kind === 'available' || (status.kind === 'installed' && status.outdated);
    return actionable && !checked.some((c) => c.id === candidate.id && c.key !== candidate.key);
}

/** すべて選択で選ぶ候補。チェックできるものだけで、同じ ID の候補が並んでいれば先のものだけ。 */
export function selectableCandidates(
    rows: ReadonlyArray<{ candidate: ModCandidate; status: CandidateStatus }>,
    checked: readonly ModCandidate[],
): ModCandidate[] {
    const open = rows.filter(({ candidate, status }) => checkable(candidate, status, checked));
    return open
        .filter(({ candidate }, index) => open.findIndex((r) => r.candidate.id === candidate.id) === index)
        .map(({ candidate }) => candidate);
}

/** チェックした候補を依存に足す（入っているものは最新版に上げる）。追加・更新できないものは飛ばす。 */
export function withCandidates(
    dependencies: readonly Dependency[],
    lock: ModLock | undefined,
    candidates: readonly ModCandidate[],
): Dependency[] {
    const targets = candidates
        .filter((candidate) => {
            const status = candidateStatus(candidate, dependencies, lock);
            return status.kind === 'available' || (status.kind === 'installed' && status.outdated);
        })
        .filter((candidate, index, all) => all.findIndex((c) => c.id === candidate.id) === index)
        .map((candidate) => candidateDependency(candidate));
    return withDependencies(dependencies, targets);
}

/** 依存を差し替える（同じ名前は同じ位置で置き換え、新しいものは末尾に足す）。 */
export function withDependencies(dependencies: readonly Dependency[], next: readonly Dependency[]): Dependency[] {
    const byName = new Map(next.map((dep) => [dep.name, dep] as const));
    const replaced = dependencies.map((dep) => byName.get(dep.name) ?? dep);
    const known = new Set(dependencies.map((dep) => dep.name));
    return [...replaced, ...next.filter((dep) => !known.has(dep.name))];
}

export function withoutDependencies(dependencies: readonly Dependency[], names: ReadonlySet<string>): Dependency[] {
    return dependencies.filter((dep) => !names.has(dep.name));
}

/** 使用中の 1 件。一覧に同じ配布物があれば、版の選択と更新に使う。 */
export interface InstalledMod {
    dependency: Dependency;
    /** 使っている版（'latest' のままで lock にも無ければ undefined） */
    version?: string;
    candidate?: ModCandidate;
    /** 選べる版（新しい順。使っている版を含む）。一覧に無い mod は空 */
    versions: string[];
    outdated: boolean;
}

export function installedMods(
    dependencies: readonly Dependency[],
    lock: ModLock | undefined,
    candidates: readonly ModCandidate[],
): InstalledMod[] {
    return dependencies.map((dependency) => {
        const version = usedVersion(dependency, lock);
        const candidate = candidates.find(
            (c) =>
                sameDistribution(dependency, c) && (!dependency.source.author || c.author === dependency.source.author),
        );
        return {
            dependency,
            version,
            candidate,
            versions: candidate ? sortVersions([...candidate.versions, ...(version ? [version] : [])]) : [],
            outdated: !!candidate && !!version && compareVersions(candidate.version, version) > 0,
        };
    });
}

/** mod ごとの、その mod の Component を使っている Entity の数（子の Entity も数える）。 */
export function modUsage(entities: readonly InitialEntity[]): Map<string, number> {
    const walk = (list: readonly InitialEntity[]): string[] =>
        list.flatMap((entity) => [
            ...new Set(
                entity.components
                    .map((component) => component.type.split(':')[0])
                    .filter((modId) => modId && modId !== 'core'),
            ),
            ...walk(entity.children),
        ]);
    return walk(entities).reduce(
        (counts, modId) => counts.set(modId, (counts.get(modId) ?? 0) + 1),
        new Map<string, number>(),
    );
}

/** 外す前の確認の文。配置済みの Component が無ければ確認しない（null）。 */
export function removalWarning(names: readonly string[], usage: ReadonlyMap<string, number>): string | null {
    const used = names.filter((name) => (usage.get(name) ?? 0) > 0);
    if (used.length === 0) return null;
    const lines = used.map((name) => `${name}: ${usage.get(name)} 個の Entity`);
    return `外す mod の Component を使っている Entity があります。外すと、その Component は動かなくなります。外しますか？\n${lines.join('\n')}`;
}

export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return [0, 1, 2].map((i) => (pa[i] ?? 0) - (pb[i] ?? 0)).find((d) => d !== 0) ?? 0;
}

/** 新しい順で重複なし。 */
export function sortVersions(versions: readonly string[]): string[] {
    return [...new Set(versions)].sort((a, b) => compareVersions(b, a));
}
