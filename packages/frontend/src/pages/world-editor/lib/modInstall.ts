/**
 * mod の追加・版の変更・外すを、ワールドの依存と lock へ反映する前の確認。
 * 通信（作者の確認・lock の解決・配布物の検証）は注入する。確認できないものがあれば何も変えない。
 */
import {
    assertPackageReplacement,
    type Dependency,
    displayAuthorAccount,
    lockedMods,
    type ModLock,
    type ModLockEntry,
} from '@ubichill/shared';
import type { ModInstallationCheck } from '../../../world/modInstallation';
import { describeModRejection } from '../../../world/modRejection';
import { computeModDiff, lockForSelection, selectionWithCheckedVersions } from './modSelection';

export interface ModInstallDeps {
    /** 選んだ版の作者を確かめる */
    check: (dependencies: Dependency[]) => Promise<ModInstallationCheck[]>;
    /** 依存すべての lock を解決する（取得元・作者・版が同じものは今の lock を使う） */
    resolveLock: (dependencies: Dependency[], previous: ModLock | undefined) => Promise<ModLock>;
    /** 変わった lock の 1 件の manifest と署名を確かめる */
    verify: (entry: ModLockEntry) => Promise<unknown>;
}

export type ModInstallProposal =
    | { kind: 'unchanged' }
    | { kind: 'rejected'; failures: ModInstallationCheck[] }
    | { kind: 'ready'; dependencies: Dependency[]; lock: ModLock | undefined };

/** 追加・更新した依存（外しただけなら空）。 */
export function changedDependencyNames(current: readonly Dependency[], next: readonly Dependency[]): Set<string> {
    const diff = computeModDiff(current, next);
    return new Set([...diff.added, ...diff.updated.map((change) => change.to)].map((dep) => dep.name));
}

export async function proposeModInstall(
    input: { current: readonly Dependency[]; next: Dependency[]; lock: ModLock | undefined },
    deps: ModInstallDeps,
): Promise<ModInstallProposal> {
    const { current, next, lock } = input;
    const changed = changedDependencyNames(current, next);
    if (changed.size === 0) {
        const removed = current.some((dep) => !next.some((n) => n.name === dep.name));
        // 外すだけなら通信しない。配置済みの Component が使う mod の lock は残す（lockForSelection と同じ）
        return removed ? { kind: 'ready', dependencies: next, lock } : { kind: 'unchanged' };
    }
    const locked = lockedMods(lock);
    const checks = await deps.check(next.filter((dep) => changed.has(dep.name) || !locked[dep.name]));
    const failures = checks.filter((check) => !check.allowed);
    if (failures.length > 0) return { kind: 'rejected', failures };

    const dependencies = selectionWithCheckedVersions(next, checks);
    const proposed = lockForSelection(dependencies, lock, await deps.resolveLock(dependencies, lock));
    const updated = Object.values(lockedMods(proposed)).filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(locked[entry.id]),
    );
    for (const entry of updated) assertPackageReplacement(locked[entry.id], entry);
    await Promise.all(updated.map(deps.verify));
    return { kind: 'ready', dependencies, lock: proposed };
}

/** 確かめられなかった理由と、次にすること。 */
export function installFailureText(check: ModInstallationCheck): string {
    const { result } = check;
    if (result.status === 'unsigned') return 'この版には作者の署名がなく、本番では使えません。別の版を選んでください';
    if (result.status === 'rejected') return `${describeModRejection(result.reason).message}。別の版を選んでください`;
    if (result.status === 'verified')
        return `署名した作者（${displayAuthorAccount(result.author)}）が、指定した作者と違います`;
    if (result.status === 'data-only') return '作者の署名を持たない mod なので、作者を指定して追加できません';
    return 'いまは確かめられません。時間をおいてもう一度試してください';
}
