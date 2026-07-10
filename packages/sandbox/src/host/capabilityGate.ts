/**
 * capabilityGate — Worker コマンドを許可してよいか判定する capability ゲート。
 *
 * PluginHostManager から分離した純粋なロジック（Worker/DOM 非依存）。単体テスト可能。
 *
 * モードは 3 つ:
 *  - allowAll         : 全コマンド許可（信頼済み first-party / 開発用エスケープハッチ）。
 *  - on-demand (動的) : authorizeCapability コールバックが判断源。初回アクセス時に問い合わせ、
 *                        結果は capability 単位でキャッシュして二重問い合わせ（= 二重プロンプト）を防ぐ。
 *  - static (静的)    : 構築時の allowlist（Set）で判定。
 *
 * コアコマンド（ALWAYS_ALLOWED_COMMANDS）は capability 宣言なしで常に許可する。
 */
import { ALWAYS_ALLOWED_COMMANDS, COMMAND_TO_CAPABILITY } from './capability';

export interface CapabilityGate {
    /**
     * コマンドを許可してよいか判定する。
     * on-demand モードでユーザー承認待ちのときは Promise を返す。
     */
    authorize(commandType: string): boolean | Promise<boolean>;
}

export interface CapabilityGateOptions {
    /** 全コマンドを許可する（他の判定を一切行わない）。 */
    allowAll?: boolean;
    /** 静的 allowlist（authorizeCapability 未指定時の判断源）。 */
    allowedCommands?: ReadonlySet<string>;
    /** on-demand 認可コールバック（指定時は静的 allowlist より優先）。 */
    authorizeCapability?: (capability: string) => boolean | Promise<boolean>;
}

const ALWAYS_ALLOWED = new Set<string>(ALWAYS_ALLOWED_COMMANDS);

export function createCapabilityGate(options: CapabilityGateOptions): CapabilityGate {
    // capability 単位の認可結果キャッシュ（Promise も保持し、承認待ち中の同時アクセスを 1 本化）。
    const decisions = new Map<string, boolean | Promise<boolean>>();

    const resolveCapability = (
        capability: string,
        authorize: (capability: string) => boolean | Promise<boolean>,
    ): boolean | Promise<boolean> => {
        const cached = decisions.get(capability);
        if (cached !== undefined) return cached;

        const decision = Promise.resolve()
            .then(() => authorize(capability))
            .then(
                (ok) => {
                    decisions.set(capability, ok);
                    return ok;
                },
                () => {
                    // コールバックが throw したら安全側（拒否）に倒す
                    decisions.set(capability, false);
                    return false;
                },
            );
        decisions.set(capability, decision);
        return decision;
    };

    return {
        authorize(commandType) {
            if (options.allowAll) return true;
            if (ALWAYS_ALLOWED.has(commandType)) return true;

            if (options.authorizeCapability) {
                const capability = COMMAND_TO_CAPABILITY[commandType];
                if (!capability) return false; // どの capability にも属さない未知コマンド
                return resolveCapability(capability, options.authorizeCapability);
            }

            return options.allowedCommands?.has(commandType) ?? false;
        },
    };
}
