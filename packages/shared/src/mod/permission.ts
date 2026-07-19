/**
 * permissionPolicy — ユーザー所有のmod権限ポリシーと、その解決ロジック。
 *
 * 設計方針:
 *  - ポリシーは「ワールド」ではなく「ユーザー」が持つ。匿名/アナーキーなインスタンスでも
 *    自己防衛できるようにするため（保存先は localStorage を想定 = クライアント側）。
 *  - modが mod.json で宣言する capability は「発行者の自己申告」に過ぎない。
 *    最終的に付与される権限は `宣言 ∩ ユーザー承認` に絞り込む（最小権限の原則）。
 *  - このモジュールは純粋関数のみ（React/DOM/Network 非依存）。単一の enforcement 経路
 *    （ModHostManager の capability ゲート）に食わせる allowlist の素を計算する。
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
    /** mod別に記憶済みの確定判断: modId -> capability -> decision。tierDefaults を上書きする。 */
    readonly grants: Readonly<Record<string, Readonly<Record<string, PermissionDecision>>>>;
    /** mod別に記憶済みの fetch ドメイン判断: modId -> hostname -> decision。 */
    readonly fetchGrants: Readonly<Record<string, Readonly<Record<string, PermissionDecision>>>>;
}

/**
 * 既定ポリシー。
 * safe=常に許可 / sensitive=既定許可（設定で ask に変更可）/ dangerous=承認必須。
 */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
    tierDefaults: { safe: 'allow', sensitive: 'allow', dangerous: 'ask' },
    grants: {},
    fetchGrants: {},
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
 * modが宣言した capability を、ユーザーポリシーで解決する。
 *
 * 優先順位: mod別の確定判断 (grants) > ティア既定 (tierDefaults)。
 * `granted` のみが実際に付与され、`pending` は承認されるまで付与されない（default-deny）。
 */
export function resolveCapabilities(
    declared: readonly string[],
    policy: PermissionPolicy,
    modId: string,
): ResolvedCapabilities {
    const modGrants = policy.grants[modId] ?? {};
    const granted: string[] = [];
    const pending: string[] = [];
    const denied: string[] = [];

    for (const capability of declared) {
        const recorded = modGrants[capability];
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
 * capability が「今この瞬間」許可されているか（純粋・即時判定。実行時ゲート用）。
 * - `net:fetch` は capability レベルでは常に許可（外部通信の可否はドメイン単位で別途判定する）。
 * - mod別の確定判断 (grants) > ティア既定。ask 未決 / deny は false（＝未付与）。
 */
export function isCapabilityGranted(policy: PermissionPolicy, modId: string, capability: string): boolean {
    if (capability === 'net:fetch') return true;
    const recorded = policy.grants[modId]?.[capability];
    if (recorded === 'allow') return true;
    if (recorded === 'deny') return false;
    return policy.tierDefaults[getCapabilityRisk(capability)] === 'allow';
}

/** capability が読み込み時の一括承認で「確認が必要」か（純粋）。ask 未決のもの。 */
export function capabilityNeedsConsent(policy: PermissionPolicy, modId: string, capability: string): boolean {
    if (capability === 'net:fetch') return false; // fetch はドメイン単位で別途
    if (policy.grants[modId]?.[capability]) return false; // 既決 (allow/deny)
    return policy.tierDefaults[getCapabilityRisk(capability)] === 'ask';
}

/** fetch ドメイン判定の結果。allow/deny は確定、ask はユーザー承認が必要。 */
export type FetchDecision = 'allow' | 'deny' | 'ask';

/**
 * fetch 先ドメインの「今この瞬間」の判定（純粋）。
 * - mod別の記憶 (fetchGrants) > dangerous ティア既定（＝シールドレベル）。
 * - none(allow) は全許可、拒否(deny) は全拒否、確認(ask) はドメインごとにユーザー承認が必要。
 */
export function resolveFetchDecision(policy: PermissionPolicy, modId: string, domain: string): FetchDecision {
    const recorded = policy.fetchGrants[modId]?.[domain];
    if (recorded === 'allow') return 'allow';
    if (recorded === 'deny') return 'deny';
    const mode = policy.tierDefaults[getCapabilityRisk('net:fetch')];
    if (mode === 'allow') return 'allow';
    if (mode === 'deny') return 'deny';
    return 'ask';
}
