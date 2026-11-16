import {
    buildWorldLock,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
    resolveLatestVersion,
} from '@ubichill/loader';
import type { Dependency, ModLock, WorldRequirements } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { confirmModUpdate } from '@/lib/mods/confirmUpdate';
import { HOST_MOD_SOURCE, MOD_CDN_URL } from '@/lib/mods/modCdn';
import { editorPackage } from '@/lib/mods/packages';
import { checkModInstallation, isUnsignedModAllowed, type ModInstallationCheck, modAuthorFetcher } from '@/world';
import { type ModInstallDeps, proposeModInstall } from '../lib/modInstall';

const installDeps: ModInstallDeps = {
    check: (dependencies) =>
        checkModInstallation(dependencies, {
            baseUrl: MOD_CDN_URL,
            resolveLatest: resolveLatestVersion,
            checkAuthor: modAuthorFetcher(HOST_MOD_SOURCE),
            allowUnsigned: (baseUrl) =>
                isUnsignedModAllowed({ devHost: HOST_MOD_SOURCE.devHost, baseUrl, origin: window.location.origin }),
        }),
    resolveLock: (dependencies, previous) =>
        buildWorldLock(
            dependencies.map((d) => d.name),
            createDependencyAwareLockEntryGetter(
                dependencies,
                createHttpLockEntryGetter(MOD_CDN_URL),
                undefined,
                previous,
            ),
        ),
    verify: editorPackage,
};

export interface ModCommit {
    dependencies: Dependency[];
    lock?: ModLock;
    requires?: WorldRequirements;
}

/** 反映できなかった理由（確かめられなかった mod・取得の失敗）。 */
export interface ModInstallProblem {
    failures: ModInstallationCheck[];
    error: string;
}

/**
 * mod の追加・版の変更・外すを、その場でワールドへ反映する。作者・配布物を確かめ、権限が増えるなら確認してから反映する。
 * 同時に 1 つだけ。確かめている間に画面を閉じたら反映しない。
 */
export function useModInstaller(input: {
    dependencies: Dependency[];
    lock?: ModLock;
    requires?: WorldRequirements;
    onCommit: (next: ModCommit) => void;
}) {
    const { dependencies, lock, requires, onCommit } = input;
    const confirm = useConfirm();
    const [busy, setBusy] = useState<string | null>(null);
    const [problem, setProblem] = useState<ModInstallProblem | null>(null);
    const busyRef = useRef(false);
    const attemptRef = useRef(0);
    useEffect(
        () => () => {
            attemptRef.current += 1;
        },
        [],
    );

    /** key は操作の名前（その行のボタンに「確認中」を出す）。成功したら true。 */
    const apply = useCallback(
        async (
            key: string,
            next: Dependency[],
            options: { requires?: WorldRequirements; confirmMessage?: string | null } = {},
        ): Promise<boolean> => {
            if (busyRef.current) return false;
            if (options.confirmMessage && !(await confirm(options.confirmMessage))) return false;
            busyRef.current = true;
            const attempt = ++attemptRef.current;
            setBusy(key);
            setProblem(null);
            try {
                const proposal = await proposeModInstall({ current: dependencies, next, lock }, installDeps);
                if (attemptRef.current !== attempt) return false;
                if (proposal.kind === 'rejected') {
                    setProblem({ failures: proposal.failures, error: '' });
                    return false;
                }
                const nextRequires = options.requires ?? requires;
                if (proposal.kind === 'unchanged') {
                    if (options.requires) onCommit({ dependencies, lock, requires: nextRequires });
                    return true;
                }
                if (proposal.lock && !(await confirmModUpdate(lock, proposal.lock, confirm))) return false;
                if (attemptRef.current !== attempt) return false;
                onCommit({ dependencies: proposal.dependencies, lock: proposal.lock, requires: nextRequires });
                return true;
            } catch (e) {
                if (attemptRef.current === attempt)
                    setProblem({ failures: [], error: e instanceof Error ? e.message : '反映できませんでした' });
                return false;
            } finally {
                if (attemptRef.current === attempt) {
                    busyRef.current = false;
                    setBusy(null);
                }
            }
        },
        [confirm, dependencies, lock, requires, onCommit],
    );

    return { apply, busy, problem, dismissProblem: () => setProblem(null) };
}
