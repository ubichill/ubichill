/**
 * PermissionContext — プラグイン権限の on-demand 承認をユーザー側で司るコンテキスト。
 *
 * 責務:
 *  - ユーザー所有の権限ポリシー (PermissionPolicy) を保持する。
 *  - `authorizeCapability(pluginId, capability)` … capability 単位の on-demand 承認。
 *    PluginHostManager のゲートから呼ばれる。safe/sensitive は既定で許可、dangerous(ask) は
 *    承認プロンプトをキューして待つ。決定は grants に記憶し次回から無音にする。
 *  - `authorizeFetchDomain(pluginId, domain)` … fetch は「どのドメインへ通信するか」が本質的な
 *    リスクなので capability ではなくドメイン単位で承認する。dangerous ティアの既定
 *    （シールドレベル）に従い、ask ならドメインごとにプロンプトして fetchGrants に記憶する。
 *  - `pendingPrompt` / `resolvePrompt` で UI 層（PandaCSS モーダル）とやり取りする。
 *
 * 保存 (localStorage 等) はこのパッケージの責務外。`initialPolicy` で初期値を受け取り、
 * `onPolicyChange` で変更を通知するので、consumer (frontend) が settings 層で永続化する。
 */
import {
    type CapabilityRisk,
    DEFAULT_PERMISSION_POLICY,
    getCapabilityRisk,
    type PermissionDecision,
    type PermissionPolicy,
    type TierMode,
} from '@ubichill/sandbox';
import type React from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** 承認プロンプト 1 件の要求内容（UI が表示する）。 */
export type PermissionPromptRequest =
    | { kind: 'capability'; pluginId: string; capability: string }
    | { kind: 'fetch'; pluginId: string; domain: string };

export interface PermissionContextValue {
    /** 現在のポリシー（設定画面が参照）。 */
    policy: PermissionPolicy;
    /**
     * capability を認可してよいか判定する。PluginHostManager の on-demand ゲートに渡す。
     * ask のときは承認プロンプトを出し、ユーザー応答まで解決しない Promise を返す。
     * `net:fetch` は常に true（fetch の承認はドメイン単位で authorizeFetchDomain が行う）。
     */
    authorizeCapability(pluginId: string, capability: string): boolean | Promise<boolean>;
    /**
     * fetch 先ドメインを認可してよいか判定する。dangerous ティアの既定（シールドレベル）に従い、
     * ask ならドメインごとに承認プロンプトを出す。決定は fetchGrants に記憶する。
     */
    authorizeFetchDomain(pluginId: string, domain: string): boolean | Promise<boolean>;
    /** 表示中の承認プロンプト（null = 無し）。UI が読む。 */
    pendingPrompt: PermissionPromptRequest | null;
    /** 表示中プロンプトへのユーザー応答。UI が呼ぶ。 */
    resolvePrompt(decision: PermissionDecision): void;
    /** ティア既定モードをまとめて置き換える（設定画面のシールドレベル用）。 */
    setTierDefaults(defaults: Record<CapabilityRisk, TierMode>): void;
    /** 記憶済みの capability 判断を取り消す（設定画面用）。capability 省略でプラグイン全体。 */
    revokeGrant(pluginId: string, capability?: string): void;
    /** 記憶済みの fetch ドメイン判断を取り消す（設定画面用）。domain 省略でプラグイン全体。 */
    revokeFetchGrant(pluginId: string, domain?: string): void;
}

type PromptItem = PermissionPromptRequest & { resolve(allow: boolean): void };

const PermissionContext = createContext<PermissionContextValue | null>(null);

export interface PermissionProviderProps {
    children: React.ReactNode;
    /** 永続化された初期ポリシー（無ければ既定）。 */
    initialPolicy?: PermissionPolicy;
    /** ポリシー変更時に呼ばれる（consumer が永続化する）。 */
    onPolicyChange?: (policy: PermissionPolicy) => void;
}

export const PermissionProvider: React.FC<PermissionProviderProps> = ({ children, initialPolicy, onPolicyChange }) => {
    const [policy, setPolicyState] = useState<PermissionPolicy>(initialPolicy ?? DEFAULT_PERMISSION_POLICY);
    const policyRef = useRef(policy);
    policyRef.current = policy;

    const onPolicyChangeRef = useRef(onPolicyChange);
    onPolicyChangeRef.current = onPolicyChange;

    // 承認待ちキュー（1 件ずつ表示）と、同一要求の同時発生を束ねる in-flight マップ。
    const queueRef = useRef<PromptItem[]>([]);
    const inFlightRef = useRef(new Map<string, Promise<boolean>>());
    const [pendingPrompt, setPendingPrompt] = useState<PermissionPromptRequest | null>(null);

    const showNext = useCallback(() => {
        const next = queueRef.current[0];
        if (!next) {
            setPendingPrompt(null);
            return;
        }
        setPendingPrompt(
            next.kind === 'capability'
                ? { kind: 'capability', pluginId: next.pluginId, capability: next.capability }
                : { kind: 'fetch', pluginId: next.pluginId, domain: next.domain },
        );
    }, []);

    const setPolicy = useCallback((updater: (prev: PermissionPolicy) => PermissionPolicy) => {
        setPolicyState((prev) => {
            const next = updater(prev);
            policyRef.current = next;
            onPolicyChangeRef.current?.(next);
            return next;
        });
    }, []);

    /** プロンプトをキューに積み、応答を待つ Promise を返す（同一 key は 1 本に集約）。 */
    const enqueuePrompt = useCallback(
        (key: string, request: PermissionPromptRequest, onDecide: (allow: boolean) => void): Promise<boolean> => {
            const existing = inFlightRef.current.get(key);
            if (existing) return existing;

            const promise = new Promise<boolean>((resolve) => {
                queueRef.current.push({
                    ...request,
                    resolve: (allow) => {
                        onDecide(allow);
                        resolve(allow);
                    },
                });
                if (queueRef.current.length === 1) showNext();
            }).finally(() => inFlightRef.current.delete(key));

            inFlightRef.current.set(key, promise);
            return promise;
        },
        [showNext],
    );

    const authorizeCapability = useCallback(
        (pluginId: string, capability: string): boolean | Promise<boolean> => {
            // fetch は capability ではなくドメイン単位で承認する（authorizeFetchDomain）。
            // よって net:fetch は capability ゲートを常に通す。
            if (capability === 'net:fetch') return true;

            const current = policyRef.current;
            const recorded = current.grants[pluginId]?.[capability];
            if (recorded === 'allow') return true;
            if (recorded === 'deny') return false;

            const mode = current.tierDefaults[getCapabilityRisk(capability)];
            if (mode === 'allow') return true;
            if (mode === 'deny') return false;

            return enqueuePrompt(
                `cap::${pluginId}::${capability}`,
                { kind: 'capability', pluginId, capability },
                (allow) =>
                    setPolicy((prev) => ({
                        ...prev,
                        grants: {
                            ...prev.grants,
                            [pluginId]: { ...(prev.grants[pluginId] ?? {}), [capability]: allow ? 'allow' : 'deny' },
                        },
                    })),
            );
        },
        [enqueuePrompt, setPolicy],
    );

    const authorizeFetchDomain = useCallback(
        (pluginId: string, domain: string): boolean | Promise<boolean> => {
            const current = policyRef.current;
            const recorded = current.fetchGrants[pluginId]?.[domain];
            if (recorded === 'allow') return true;
            if (recorded === 'deny') return false;

            // fetch の危険度は dangerous ティア（シールドレベル）で決まる。
            const mode = current.tierDefaults[getCapabilityRisk('net:fetch')];
            if (mode === 'allow') return true; // シールド「なし」
            if (mode === 'deny') return false; // シールド「拒否」

            return enqueuePrompt(`fetch::${pluginId}::${domain}`, { kind: 'fetch', pluginId, domain }, (allow) =>
                setPolicy((prev) => ({
                    ...prev,
                    fetchGrants: {
                        ...prev.fetchGrants,
                        [pluginId]: { ...(prev.fetchGrants[pluginId] ?? {}), [domain]: allow ? 'allow' : 'deny' },
                    },
                })),
            );
        },
        [enqueuePrompt, setPolicy],
    );

    const resolvePrompt = useCallback(
        (decision: PermissionDecision) => {
            const item = queueRef.current.shift();
            item?.resolve(decision === 'allow');
            showNext();
        },
        [showNext],
    );

    const setTierDefaults = useCallback(
        (defaults: Record<CapabilityRisk, TierMode>) => {
            setPolicy((prev) => ({ ...prev, tierDefaults: defaults }));
        },
        [setPolicy],
    );

    const revokeGrant = useCallback(
        (pluginId: string, capability?: string) => {
            setPolicy((prev) => {
                const pluginGrants = prev.grants[pluginId];
                if (!pluginGrants) return prev;
                const nextGrants = { ...prev.grants };
                if (capability === undefined) {
                    delete nextGrants[pluginId];
                } else {
                    const { [capability]: _removed, ...rest } = pluginGrants;
                    nextGrants[pluginId] = rest;
                }
                return { ...prev, grants: nextGrants };
            });
        },
        [setPolicy],
    );

    const revokeFetchGrant = useCallback(
        (pluginId: string, domain?: string) => {
            setPolicy((prev) => {
                const pluginFetch = prev.fetchGrants[pluginId];
                if (!pluginFetch) return prev;
                const nextFetch = { ...prev.fetchGrants };
                if (domain === undefined) {
                    delete nextFetch[pluginId];
                } else {
                    const { [domain]: _removed, ...rest } = pluginFetch;
                    nextFetch[pluginId] = rest;
                }
                return { ...prev, fetchGrants: nextFetch };
            });
        },
        [setPolicy],
    );

    const value = useMemo<PermissionContextValue>(
        () => ({
            policy,
            authorizeCapability,
            authorizeFetchDomain,
            pendingPrompt,
            resolvePrompt,
            setTierDefaults,
            revokeGrant,
            revokeFetchGrant,
        }),
        [
            policy,
            authorizeCapability,
            authorizeFetchDomain,
            pendingPrompt,
            resolvePrompt,
            setTierDefaults,
            revokeGrant,
            revokeFetchGrant,
        ],
    );

    return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
};

/**
 * 権限コンテキストを取得する。Provider が無い環境（例: エディタ Preview）では null を返し、
 * その場合 WorkerPluginHost は on-demand を使わず宣言 capability の静的判定にフォールバックする。
 */
export function useUbiPermissions(): PermissionContextValue | null {
    return useContext(PermissionContext);
}
