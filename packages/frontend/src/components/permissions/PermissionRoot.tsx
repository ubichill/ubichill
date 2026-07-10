/**
 * PermissionRoot — 権限コンテキストと承認モーダルをアプリ全体に供給するラッパー。
 *
 * ポリシーは settings 層 (localStorage) で永続化する。@ubichill/react の
 * PermissionProvider は保存に非依存なので、初期値の読み込みと変更時の保存をここで橋渡しする。
 */
import { DEFAULT_PERMISSION_POLICY, type PermissionPolicy, PermissionProvider } from '@ubichill/react';
import type React from 'react';
import { useCallback, useMemo } from 'react';
import { readSetting, SETTINGS_KEYS, writeSetting } from '@/lib/settings';
import { PermissionPromptModal } from './PermissionPromptModal';

/** localStorage から読んだ値が PermissionPolicy の形をしているかの緩い検証。 */
function isPermissionPolicy(value: unknown): value is PermissionPolicy {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.tierDefaults === 'object' &&
        v.tierDefaults !== null &&
        typeof v.grants === 'object' &&
        v.grants !== null &&
        Array.isArray(v.allowedFetchDomains)
    );
}

export const PermissionRoot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const initialPolicy = useMemo(
        () =>
            readSetting<PermissionPolicy>(
                SETTINGS_KEYS.permissionPolicy,
                DEFAULT_PERMISSION_POLICY,
                isPermissionPolicy,
            ),
        [],
    );
    const handlePolicyChange = useCallback((policy: PermissionPolicy) => {
        writeSetting(SETTINGS_KEYS.permissionPolicy, policy);
    }, []);

    return (
        <PermissionProvider initialPolicy={initialPolicy} onPolicyChange={handlePolicyChange}>
            {children}
            <PermissionPromptModal />
        </PermissionProvider>
    );
};
