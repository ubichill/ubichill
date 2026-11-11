import { addedModCapabilities, describeCapabilityAdditions, type ModLock } from '@ubichill/shared';

/** エディタの追加・更新経路で共用する。拒否した場合は依存も lock も変更しない。 */
export async function confirmModUpdate(
    previous: ModLock | undefined,
    next: ModLock,
    confirm: (message: string) => Promise<boolean>,
): Promise<boolean> {
    const added = addedModCapabilities(previous, next);
    return (
        added.length === 0 ||
        (await confirm(`この更新で使用できる権限が増えます。追加しますか？\n${describeCapabilityAdditions(added)}`))
    );
}
