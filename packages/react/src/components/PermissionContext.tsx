/**
 * PermissionContext — プラグイン権限をユーザー側で司るコンテキスト。
 *
 * 同意モデル:
 *  - **capability は「プラグイン読み込み時」に一括承認**（`authorizePlugin`）。実行時ではないので
 *    描画のような高頻度コマンドが承認待ちで保留＝RPC タイムアウトになることが無い。
 *  - 実行時ゲート（`authorizeCapability`）は**プロンプトを出さず即時に許可判定だけ**する
 *    （読み込み時に確定済みの grant / ティア既定を読むだけ）。
 *  - **fetch はドメイン単位で on-demand 承認**（`authorizeFetchDomain`）。ドメインは読み込み時に
 *    不明なため。プロンプトは「今回だけ / 次回以降も許可 / 拒否」の 3 択（Claude Code 風）。
 *
 * 保存はこのパッケージの責務外。`initialPolicy` / `onPolicyChange` で consumer が永続化する。
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

/** 承認プロンプト。プラグイン一括（capability 群）と fetch ドメインの 2 種。 */
export type PermissionPromptRequest =
    | { kind: 'plugin'; pluginId: string; capabilities: { capability: string; risk: CapabilityRisk }[] }
    | { kind: 'fetch'; pluginId: string; domain: string };

/** プロンプトへのユーザー応答。plugin は allow/deny、fetch は once/always/deny。 */
export type PromptOutcome = 'allow' | 'deny' | 'once' | 'always';

export interface PermissionContextValue {
    /** 現在のポリシー（設定画面が参照）。 */
    policy: PermissionPolicy;
    /**
     * 実行時ゲート用の即時判定（プロンプトを出さない）。
     * net:fetch は常に true（fetch はドメイン単位で別途承認）。ask 未決や deny は false。
     */
    authorizeCapability(pluginId: string, capability: string): boolean;
    /**
     * プラグイン読み込み時に、要求 capability のうち承認が要るものを 1 つのダイアログで一括承認する。
     * 承認が不要（safe/sensitive 既定許可・既決）なら即解決する。
     * **ユーザーが決定した時点で解決する**（許可でも拒否でも）。呼び出し側はこれを待って Worker の
     * 実行を開始する（＝確認前は実行しない。拒否した権限は実行時ゲートが個別に拒否するだけで、
     * プラグイン自体は決定後に動く）。
     */
    authorizePlugin(pluginId: string, capabilities: readonly string[]): Promise<void>;
    /**
     * fetch 先ドメインの承認。ask のときはドメインごとにプロンプト（今回だけ/次回以降も許可/拒否）。
     */
    authorizeFetchDomain(pluginId: string, domain: string): boolean | Promise<boolean>;
    /** 表示中の承認プロンプト（null = 無し）。UI が読む。 */
    pendingPrompt: PermissionPromptRequest | null;
    /** 表示中プロンプトへのユーザー応答。 */
    resolvePrompt(outcome: PromptOutcome): void;
    /** ティア既定モードをまとめて置き換える（設定画面のシールドレベル用）。 */
    setTierDefaults(defaults: Record<CapabilityRisk, TierMode>): void;
    /** 記憶済みの capability 判断を取り消す。capability 省略でプラグイン全体。 */
    revokeGrant(pluginId: string, capability?: string): void;
    /** 記憶済みの fetch ドメイン判断を取り消す。domain 省略でプラグイン全体。 */
    revokeFetchGrant(pluginId: string, domain?: string): void;
}

type PromptItem = PermissionPromptRequest & { resolve(outcome: PromptOutcome): void };

const PermissionContext = createContext<PermissionContextValue | null>(null);

export interface PermissionProviderProps {
    children: React.ReactNode;
    initialPolicy?: PermissionPolicy;
    onPolicyChange?: (policy: PermissionPolicy) => void;
}

export const PermissionProvider: React.FC<PermissionProviderProps> = ({ children, initialPolicy, onPolicyChange }) => {
    const [policy, setPolicyState] = useState<PermissionPolicy>(initialPolicy ?? DEFAULT_PERMISSION_POLICY);
    const policyRef = useRef(policy);
    policyRef.current = policy;

    const onPolicyChangeRef = useRef(onPolicyChange);
    onPolicyChangeRef.current = onPolicyChange;

    const queueRef = useRef<PromptItem[]>([]);
    const inFlightPluginRef = useRef(new Map<string, Promise<void>>());
    const inFlightFetchRef = useRef(new Map<string, Promise<boolean>>());
    const [pendingPrompt, setPendingPrompt] = useState<PermissionPromptRequest | null>(null);

    const showNext = useCallback(() => {
        const next = queueRef.current[0];
        if (!next) {
            setPendingPrompt(null);
            return;
        }
        setPendingPrompt(
            next.kind === 'plugin'
                ? { kind: 'plugin', pluginId: next.pluginId, capabilities: next.capabilities }
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

    // 実行時ゲート: プロンプトを出さず即時判定のみ。
    const authorizeCapability = useCallback((pluginId: string, capability: string): boolean => {
        if (capability === 'net:fetch') return true; // fetch はドメイン単位で別途承認
        const current = policyRef.current;
        const recorded = current.grants[pluginId]?.[capability];
        if (recorded === 'allow') return true;
        if (recorded === 'deny') return false;
        // ask 未決 / deny は false（承認は読み込み時の authorizePlugin で確定する）
        return current.tierDefaults[getCapabilityRisk(capability)] === 'allow';
    }, []);

    // 読み込み時の一括承認。ユーザーが決定した時点で解決する（許可でも拒否でも）。
    const authorizePlugin = useCallback(
        (pluginId: string, capabilities: readonly string[]): Promise<void> => {
            const current = policyRef.current;
            const pluginGrants = current.grants[pluginId] ?? {};
            // 承認が必要 = fetch 以外・未決・ティアが ask のもの。
            const pending = [...new Set(capabilities)].filter(
                (cap) =>
                    cap !== 'net:fetch' && !pluginGrants[cap] && current.tierDefaults[getCapabilityRisk(cap)] === 'ask',
            );
            if (pending.length === 0) return Promise.resolve(); // 承認不要 → 即実行可

            const key = `plugin::${pluginId}`;
            const existing = inFlightPluginRef.current.get(key);
            if (existing) return existing;

            const promise = new Promise<void>((resolve) => {
                queueRef.current.push({
                    kind: 'plugin',
                    pluginId,
                    capabilities: pending.map((cap) => ({ capability: cap, risk: getCapabilityRisk(cap) })),
                    resolve: (outcome) => {
                        // 拒否した権限は実行時ゲートが個別に拒否する。プラグイン自体は決定後に動く。
                        const decision: PermissionDecision = outcome === 'allow' ? 'allow' : 'deny';
                        setPolicy((prev) => ({
                            ...prev,
                            grants: {
                                ...prev.grants,
                                [pluginId]: {
                                    ...(prev.grants[pluginId] ?? {}),
                                    ...Object.fromEntries(pending.map((cap) => [cap, decision])),
                                },
                            },
                        }));
                        resolve();
                    },
                });
                if (queueRef.current.length === 1) showNext();
            }).finally(() => inFlightPluginRef.current.delete(key));

            inFlightPluginRef.current.set(key, promise);
            return promise;
        },
        [setPolicy, showNext],
    );

    const authorizeFetchDomain = useCallback(
        (pluginId: string, domain: string): boolean | Promise<boolean> => {
            const current = policyRef.current;
            const recorded = current.fetchGrants[pluginId]?.[domain];
            if (recorded === 'allow') return true;
            if (recorded === 'deny') return false;

            const mode = current.tierDefaults[getCapabilityRisk('net:fetch')];
            if (mode === 'allow') return true; // シールド「なし」
            if (mode === 'deny') return false; // シールド「拒否」

            const key = `${pluginId}::${domain}`;
            const existing = inFlightFetchRef.current.get(key);
            if (existing) return existing;

            const persist = (d: PermissionDecision) =>
                setPolicy((prev) => ({
                    ...prev,
                    fetchGrants: {
                        ...prev.fetchGrants,
                        [pluginId]: { ...(prev.fetchGrants[pluginId] ?? {}), [domain]: d },
                    },
                }));

            const promise = new Promise<boolean>((resolve) => {
                queueRef.current.push({
                    kind: 'fetch',
                    pluginId,
                    domain,
                    resolve: (outcome) => {
                        if (outcome === 'always') {
                            persist('allow');
                            resolve(true);
                        } else if (outcome === 'deny') {
                            persist('deny');
                            resolve(false);
                        } else {
                            resolve(true); // 'once' / 'allow' → 今回だけ許可（記憶しない）
                        }
                    },
                });
                if (queueRef.current.length === 1) showNext();
            }).finally(() => inFlightFetchRef.current.delete(key));

            inFlightFetchRef.current.set(key, promise);
            return promise;
        },
        [setPolicy, showNext],
    );

    const resolvePrompt = useCallback(
        (outcome: PromptOutcome) => {
            const item = queueRef.current.shift();
            item?.resolve(outcome);
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
            authorizePlugin,
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
            authorizePlugin,
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
 * 権限コンテキストを取得する。Provider が無い環境（エディタ Preview 等）では null を返し、
 * その場合 WorkerPluginHost は on-demand を使わず宣言 capability の静的判定にフォールバックする。
 */
export function useUbiPermissions(): PermissionContextValue | null {
    return useContext(PermissionContext);
}
