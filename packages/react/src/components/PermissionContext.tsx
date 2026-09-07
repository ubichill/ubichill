/**
 * PermissionContext — mod権限をユーザー側で司るコンテキスト。
 *
 * 同意モデル:
 *  - **capability は「mod読み込み時」に一括承認**（`authorizeMod`）。実行時ではないので
 *    描画のような高頻度コマンドが承認待ちで保留＝RPC タイムアウトになることが無い。
 *  - 実行時ゲート（`authorizeCapability`）は**プロンプトを出さず即時に許可判定だけ**する
 *    （読み込み時に確定済みの grant / ティア既定を読むだけ）。
 *  - **外部通信はドメイン単位で on-demand 承認**（`authorizeExternalDomain`）。ドメインは読み込み時に
 *    不明なため。プロンプトは「今回だけ / 次回以降も許可 / 拒否」の 3 択（Claude Code 風）。
 *
 * 保存はこのパッケージの責務外。`initialPolicy` / `onPolicyChange` で consumer が永続化する。
 */
import {
    type CapabilityRisk,
    capabilityNeedsConsent,
    DEFAULT_PERMISSION_POLICY,
    getCapabilityRisk,
    isCapabilityGranted,
    type PermissionDecision,
    type PermissionPolicy,
    resolveExternalDomainDecision,
    type TierMode,
} from '@ubichill/shared';
import type React from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** 承認プロンプト。mod一括（capability 群）と外部通信ドメインの 2 種。 */
export type PermissionPromptRequest =
    | { kind: 'mod'; modId: string; capabilities: { capability: string; risk: CapabilityRisk }[] }
    | { kind: 'external'; modId: string; domain: string };

/** プロンプトへのユーザー応答。mod は allow/deny、fetch は once/always/deny。 */
export type PromptOutcome = 'allow' | 'deny' | 'once' | 'always';

export interface PermissionContextValue {
    /** 現在のポリシー（設定画面が参照）。 */
    policy: PermissionPolicy;
    /**
     * 実行時ゲート用の即時判定（プロンプトを出さない）。
     * net:fetch は常に true（外部通信はfetch・メディア共通でドメイン単位に別途承認）。
     * ask 未決や deny は false。
     */
    authorizeCapability(modId: string, capability: string): boolean;
    /**
     * mod読み込み時に、要求 capability のうち承認が要るものを 1 つのダイアログで一括承認する。
     * 承認が不要（safe/sensitive 既定許可・既決）なら即解決する。
     * **ユーザーが決定した時点で解決する**（許可でも拒否でも）。呼び出し側はこれを待って Worker の
     * 実行を開始する（＝確認前は実行しない。拒否した権限は実行時ゲートが個別に拒否するだけで、
     * mod自体は決定後に動く）。
     */
    authorizeMod(modId: string, capabilities: readonly string[]): Promise<void>;
    /**
     * fetch・動画・音声で共有する外部ドメイン承認。
     * ask のときはドメインごとにプロンプト（今回だけ/次回以降も許可/拒否）。
     */
    authorizeExternalDomain(modId: string, domain: string): boolean | Promise<boolean>;
    /** @deprecated `authorizeExternalDomain` を使用してください。 */
    authorizeFetchDomain(modId: string, domain: string): boolean | Promise<boolean>;
    /** 表示中の承認プロンプト（null = 無し）。UI が読む。 */
    pendingPrompt: PermissionPromptRequest | null;
    /** 表示中プロンプトへのユーザー応答。 */
    resolvePrompt(outcome: PromptOutcome): void;
    /** capability を許可として記録する（拒否トーストの「許可」ボタン等から。既存の deny を上書き）。 */
    grantCapability(modId: string, capability: string): void;
    /** 外部通信ドメインを許可として記録する（拒否トーストの「許可」ボタン等から）。 */
    grantExternalDomain(modId: string, domain: string): void;
    /** @deprecated `grantExternalDomain` を使用してください。 */
    grantFetchDomain(modId: string, domain: string): void;
    /** ティア既定モードをまとめて置き換える（設定画面のシールドレベル用）。 */
    setTierDefaults(defaults: Record<CapabilityRisk, TierMode>): void;
    /** 記憶済みの capability 判断を取り消す。capability 省略でmod全体。 */
    revokeGrant(modId: string, capability?: string): void;
    /** 記憶済みの外部通信ドメイン判断を取り消す。domain 省略でmod全体。 */
    revokeExternalGrant(modId: string, domain?: string): void;
    /** @deprecated `revokeExternalGrant` を使用してください。 */
    revokeFetchGrant(modId: string, domain?: string): void;
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
    const inFlightModRef = useRef(new Map<string, Promise<void>>());
    const inFlightExternalRef = useRef(new Map<string, Promise<boolean>>());
    const [pendingPrompt, setPendingPrompt] = useState<PermissionPromptRequest | null>(null);

    const showNext = useCallback(() => {
        const next = queueRef.current[0];
        if (!next) {
            setPendingPrompt(null);
            return;
        }
        setPendingPrompt(
            next.kind === 'mod'
                ? { kind: 'mod', modId: next.modId, capabilities: next.capabilities }
                : { kind: 'external', modId: next.modId, domain: next.domain },
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

    // 実行時ゲート: プロンプトを出さず即時判定のみ（純粋関数に委譲）。
    const authorizeCapability = useCallback(
        (modId: string, capability: string): boolean => isCapabilityGranted(policyRef.current, modId, capability),
        [],
    );

    // 読み込み時の一括承認。ユーザーが決定した時点で解決する（許可でも拒否でも）。
    const authorizeMod = useCallback(
        (modId: string, capabilities: readonly string[]): Promise<void> => {
            const current = policyRef.current;
            // 承認が必要な capability（純粋関数で判定）。
            const pending = [...new Set(capabilities)].filter((cap) => capabilityNeedsConsent(current, modId, cap));
            if (pending.length === 0) return Promise.resolve(); // 承認不要 → 即実行可

            const key = `mod::${modId}`;
            const existing = inFlightModRef.current.get(key);
            if (existing) return existing;

            const promise = new Promise<void>((resolve) => {
                queueRef.current.push({
                    kind: 'mod',
                    modId,
                    capabilities: pending.map((cap) => ({ capability: cap, risk: getCapabilityRisk(cap) })),
                    resolve: (outcome) => {
                        // 拒否した権限は実行時ゲートが個別に拒否する。mod自体は決定後に動く。
                        const decision: PermissionDecision = outcome === 'allow' ? 'allow' : 'deny';
                        setPolicy((prev) => ({
                            ...prev,
                            grants: {
                                ...prev.grants,
                                [modId]: {
                                    ...(prev.grants[modId] ?? {}),
                                    ...Object.fromEntries(pending.map((cap) => [cap, decision])),
                                },
                            },
                        }));
                        resolve();
                    },
                });
                if (queueRef.current.length === 1) showNext();
            }).finally(() => inFlightModRef.current.delete(key));

            inFlightModRef.current.set(key, promise);
            return promise;
        },
        [setPolicy, showNext],
    );

    const authorizeExternalDomain = useCallback(
        (modId: string, domain: string): boolean | Promise<boolean> => {
            // 確定判定は純粋関数に委譲。ask のときだけプロンプトを出す。
            const decision = resolveExternalDomainDecision(policyRef.current, modId, domain);
            if (decision === 'allow') return true;
            if (decision === 'deny') return false;

            const key = `${modId}::${domain}`;
            const existing = inFlightExternalRef.current.get(key);
            if (existing) return existing;

            const persist = (d: PermissionDecision) =>
                setPolicy((prev) => ({
                    ...prev,
                    fetchGrants: {
                        ...prev.fetchGrants,
                        [modId]: { ...(prev.fetchGrants[modId] ?? {}), [domain]: d },
                    },
                }));

            const promise = new Promise<boolean>((resolve) => {
                queueRef.current.push({
                    kind: 'external',
                    modId,
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
            }).finally(() => inFlightExternalRef.current.delete(key));

            inFlightExternalRef.current.set(key, promise);
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

    const grantCapability = useCallback(
        (modId: string, capability: string) => {
            setPolicy((prev) => ({
                ...prev,
                grants: { ...prev.grants, [modId]: { ...(prev.grants[modId] ?? {}), [capability]: 'allow' } },
            }));
        },
        [setPolicy],
    );

    const grantExternalDomain = useCallback(
        (modId: string, domain: string) => {
            setPolicy((prev) => ({
                ...prev,
                fetchGrants: {
                    ...prev.fetchGrants,
                    [modId]: { ...(prev.fetchGrants[modId] ?? {}), [domain]: 'allow' },
                },
            }));
        },
        [setPolicy],
    );

    const setTierDefaults = useCallback(
        (defaults: Record<CapabilityRisk, TierMode>) => {
            setPolicy((prev) => ({ ...prev, tierDefaults: defaults }));
        },
        [setPolicy],
    );

    const revokeGrant = useCallback(
        (modId: string, capability?: string) => {
            setPolicy((prev) => {
                const modGrants = prev.grants[modId];
                if (!modGrants) return prev;
                const nextGrants = { ...prev.grants };
                if (capability === undefined) {
                    delete nextGrants[modId];
                } else {
                    const { [capability]: _removed, ...rest } = modGrants;
                    nextGrants[modId] = rest;
                }
                return { ...prev, grants: nextGrants };
            });
        },
        [setPolicy],
    );

    const revokeExternalGrant = useCallback(
        (modId: string, domain?: string) => {
            setPolicy((prev) => {
                const modFetch = prev.fetchGrants[modId];
                if (!modFetch) return prev;
                const nextFetch = { ...prev.fetchGrants };
                if (domain === undefined) {
                    delete nextFetch[modId];
                } else {
                    const { [domain]: _removed, ...rest } = modFetch;
                    nextFetch[modId] = rest;
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
            authorizeMod,
            authorizeExternalDomain,
            authorizeFetchDomain: authorizeExternalDomain,
            pendingPrompt,
            resolvePrompt,
            grantCapability,
            grantExternalDomain,
            grantFetchDomain: grantExternalDomain,
            setTierDefaults,
            revokeGrant,
            revokeExternalGrant,
            revokeFetchGrant: revokeExternalGrant,
        }),
        [
            policy,
            authorizeCapability,
            authorizeMod,
            authorizeExternalDomain,
            pendingPrompt,
            resolvePrompt,
            grantCapability,
            grantExternalDomain,
            setTierDefaults,
            revokeGrant,
            revokeExternalGrant,
        ],
    );

    return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
};

/**
 * 権限コンテキストを取得する。Provider が無い環境（エディタ Preview 等）では null を返し、
 * その場合 WorkerModHost は on-demand を使わず宣言 capability の静的判定にフォールバックする。
 */
export function useUbiPermissions(): PermissionContextValue | null {
    return useContext(PermissionContext);
}
