import { type ModLock, PROTOCOL_VERSION, type WorldDefinition, worldRequirementsFor } from '@ubichill/shared';
import { pinDependencies } from './modSelection';

/** 保存のたびにエディタが決める項目。作者は書かない。 */
export interface SavedFields {
    lock: ModLock;
    version: string;
}

/**
 * 保存する定義にエディタが決める項目を埋める。保存後に、保存を待つ間の編集を残したまま同じ項目だけを差し替えるのにも使う。
 * - 依存の版: 'latest' を lock が固定している版にする
 * - requires: ubichill の版（無ければ今の版で固定する。上げるのは作者が選んだとき）
 */
export function withSavedFields(
    definition: WorldDefinition,
    { lock, version }: SavedFields,
    hostProtocol: number = PROTOCOL_VERSION,
): WorldDefinition {
    const dependencies = definition.spec.dependencies;
    return {
        ...definition,
        metadata: { ...definition.metadata, version },
        spec: {
            ...definition.spec,
            ...(dependencies ? { dependencies: pinDependencies(dependencies, lock) } : {}),
            requires: worldRequirementsFor(definition.spec.requires, hostProtocol),
            lock,
        },
    };
}

/** 保存すると、利用者が触っていなくても中身が変わるか（latest や ubichill の版をまだ固定していない）。 */
export function savingChangesDefinition(definition: WorldDefinition): boolean {
    return (
        definition.spec.requires === undefined ||
        (definition.spec.dependencies ?? []).some((dep) => dep.source.version === 'latest')
    );
}
