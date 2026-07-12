/**
 * PermissionRoot — 権限コンテキストと承認モーダルをアプリ全体に供給するラッパー。
 *
 * ポリシーは settings 層 (localStorage) で永続化する。@ubichill/react の
 * PermissionProvider は保存に非依存なので、初期値の読み込みと変更時の保存をここで橋渡しする。
 */
import {
    DEFAULT_PERMISSION_POLICY,
    type PermissionPolicy,
    PermissionProvider,
    resetDiagnosticHandler,
    setDiagnosticHandler,
} from '@ubichill/react';
import { UbiErrorCode } from '@ubichill/shared';
import type React from 'react';
import { useCallback, useEffect, useMemo } from 'react';
import { ToastHost } from '@/components/ui/ToastHost';
import { readSetting, SETTINGS_KEYS, writeSetting } from '@/lib/settings';
import { pushToast } from '@/lib/toast';
import { PermissionPromptModal } from './PermissionPromptModal';

/** ユーザーに見せる価値のある拒否コード（権限系）。 */
const USER_FACING_DENIAL = new Set<UbiErrorCode>([
    UbiErrorCode.CAPABILITY_DENIED,
    UbiErrorCode.FETCH_DOMAIN_NOT_ALLOWED,
]);

/** localStorage から読んだ値が PermissionPolicy の形をしているかの緩い検証。 */
function isPermissionPolicy(value: unknown): value is PermissionPolicy {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.tierDefaults === 'object' &&
        v.tierDefaults !== null &&
        typeof v.grants === 'object' &&
        v.grants !== null &&
        typeof v.fetchGrants === 'object' &&
        v.fetchGrants !== null
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

    // 診断（権限拒否など）を console 出力（既定維持）＋ユーザー向けトーストに橋渡しする。
    // 拒否が沈黙しないための可視化。
    useEffect(() => {
        setDiagnosticHandler(({ level, pluginId, code, message }) => {
            console[level](`[Plugin:${pluginId}] [${code}] ${message}`);
            if (USER_FACING_DENIAL.has(code)) {
                pushToast(message, 'warn');
            }
        });
        return () => resetDiagnosticHandler();
    }, []);

    return (
        <PermissionProvider initialPolicy={initialPolicy} onPolicyChange={handlePolicyChange}>
            {children}
            <PermissionPromptModal />
            <ToastHost />
        </PermissionProvider>
    );
};
