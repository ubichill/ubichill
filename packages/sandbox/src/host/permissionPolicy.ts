/**
 * permissionPolicy — ユーザー所有のプラグイン権限ポリシーと、その解決ロジック。
 *
 * 設計方針:
 *  - ポリシーは「ワールド」ではなく「ユーザー」が持つ。匿名/アナーキーなインスタンスでも
 *    自己防衛できるようにするため（保存先は localStorage を想定 = クライアント側）。
 *  - プラグインが plugin.json で宣言する capability は「発行者の自己申告」に過ぎない。
 *    最終的に付与される権限は `宣言 ∩ ユーザー承認` に絞り込む（最小権限の原則）。
 *  - このモジュールは純粋関数のみ（React/DOM/Network 非依存）。単一の enforcement 経路
 *    （PluginHostManager の capability ゲート）に食わせる allowlist の素を計算する。
 */
import { type CapabilityRisk, getCapabilityRisk } from './capability';

/** ある capability に対してユーザーが下した確定判断。 */
export type PermissionDecision = 'allow' | 'deny';

/**
 * 危険度ティアごとの既定モード。
 * - allow : 宣言されていれば承認なしで許可
 * - ask   : 未判断ならユーザーに承認を求める（承認されるまでは付与しない）
 * - deny  : 常に拒否
 */
export type TierMode = 'allow' | 'ask' | 'deny';

/** ユーザーが保持する権限ポリシー全体。 */
export interface PermissionPolicy {
    /** 危険度ティアごとの既定モード。 */
    readonly tierDefaults: Readonly<Record<CapabilityRisk, TierMode>>;
    /** プラグイン別に記憶済みの確定判断: pluginId -> capability -> decision。tierDefaults を上書きする。 */
    readonly grants: Readonly<Record<string, Readonly<Record<string, PermissionDecision>>>>;
    /** ユーザーがグローバルに許可した fetch ドメイン（suffix マッチ）。 */
    readonly allowedFetchDomains: readonly string[];
}

/**
 * 既定ポリシー。
 * safe=常に許可 / sensitive=既定許可（設定で ask に変更可）/ dangerous=承認必須。
 */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
    tierDefaults: { safe: 'allow', sensitive: 'allow', dangerous: 'ask' },
    grants: {},
    allowedFetchDomains: [],
};

/** capability 解決の結果。 */
export interface ResolvedCapabilities {
    /** 今すぐ付与してよい capability（enforcement に渡す）。 */
    readonly granted: readonly string[];
    /** ユーザーの承認待ち（未判断 かつ ティアが ask）。UI で allow/deny を促す対象。 */
    readonly pending: readonly string[];
    /** 明示的に拒否された capability。 */
    readonly denied: readonly string[];
}

/**
 * プラグインが宣言した capability を、ユーザーポリシーで解決する。
 *
 * 優先順位: プラグイン別の確定判断 (grants) > ティア既定 (tierDefaults)。
 * `granted` のみが実際に付与され、`pending` は承認されるまで付与されない（default-deny）。
 */
export function resolveCapabilities(
    declared: readonly string[],
    policy: PermissionPolicy,
    pluginId: string,
): ResolvedCapabilities {
    const pluginGrants = policy.grants[pluginId] ?? {};
    const granted: string[] = [];
    const pending: string[] = [];
    const denied: string[] = [];

    for (const capability of declared) {
        const recorded = pluginGrants[capability];
        if (recorded === 'allow') {
            granted.push(capability);
            continue;
        }
        if (recorded === 'deny') {
            denied.push(capability);
            continue;
        }
        const mode = policy.tierDefaults[getCapabilityRisk(capability)];
        if (mode === 'allow') granted.push(capability);
        else if (mode === 'deny') denied.push(capability);
        else pending.push(capability);
    }

    return { granted, pending, denied };
}

/**
 * fetch の実効許可ドメインを解決する。
 *
 * 候補ドメイン（plugin.json の fetchDomains + ワールド設定）のうち、
 * ユーザーがグローバルに許可済み (allowedFetchDomains) または
 * プラグイン別に `net:fetch` を allow したものだけを通す。
 *
 * `net:fetch` capability 自体がプラグイン別に deny されている場合は空を返す（一切許可しない）。
 */
export function resolveFetchDomains(
    candidateDomains: readonly string[],
    policy: PermissionPolicy,
    pluginId: string,
): string[] {
    const fetchDecision = policy.grants[pluginId]?.['net:fetch'];
    if (fetchDecision === 'deny') return [];

    // プラグイン別に net:fetch が allow されているなら、候補ドメインを全面的に信頼する。
    // そうでなければユーザーがグローバル許可したドメインとの積集合に絞る。
    if (fetchDecision === 'allow') {
        return dedupe(candidateDomains);
    }

    const allowed = new Set(policy.allowedFetchDomains);
    return dedupe(candidateDomains.filter((d) => allowed.has(d)));
}

function dedupe(items: readonly string[]): string[] {
    return [...new Set(items)];
}
