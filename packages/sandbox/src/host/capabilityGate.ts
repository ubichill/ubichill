/**
 * capabilityGate — Worker コマンドを許可してよいか判定する capability ゲート。
 *
 * ModHostManager から分離した純粋なロジック（Worker/DOM 非依存）。単体テスト可能。
 *
 * モードは 3 つ:
 *  - allowAll  : 全コマンド許可（信頼済み first-party / 開発用エスケープハッチ）。
 *  - dynamic   : allowlist（lock が許す天井）**かつ** authorizeCapability（ユーザーの許可）。
 *                ユーザー設定の既定で許される権限でも、lock に無ければ拒否する。
 *                コールバックは**毎回評価する（キャッシュしない）**。承認はmod読み込み時に別途まとめて確定するため、
 *                ここは即時の許可判定だけを行い、プロンプトや保留はしない（＝RPC タイムアウトを招かない）。
 *  - static    : 構築時の allowlist（Set）で判定。
 *
 * コアコマンド（ALWAYS_ALLOWED_COMMANDS）は capability 宣言なしで常に許可する。
 */
import { ALWAYS_ALLOWED_COMMANDS, COMMAND_TO_CAPABILITY } from '@ubichill/shared';

export interface CapabilityGate {
    /** コマンドを許可してよいか即時判定する（同期・高頻度コマンドでもオーバーヘッドなし）。 */
    authorize(commandType: string): boolean;
}

export interface CapabilityGateOptions {
    /** 全コマンドを許可する（他の判定を一切行わない）。 */
    allowAll?: boolean;
    /** lock が許すコマンド（天井）。authorizeCapability があってもこれを超えては許可しない。未指定は全拒否。 */
    allowedCommands?: ReadonlySet<string>;
    /**
     * 認可コールバック（指定時は静的 allowlist より優先）。同期で即時判定する。
     * 承認状態は後から変わりうる（読み込み時の一括承認で deny→allow）ため、**キャッシュせず毎回呼ぶ**。
     */
    authorizeCapability?: (capability: string) => boolean;
}

const ALWAYS_ALLOWED = new Set<string>(ALWAYS_ALLOWED_COMMANDS);

export function createCapabilityGate(options: CapabilityGateOptions): CapabilityGate {
    return {
        authorize(commandType): boolean {
            if (options.allowAll) return true;
            if (ALWAYS_ALLOWED.has(commandType)) return true;
            if (!options.allowedCommands?.has(commandType)) return false;

            if (options.authorizeCapability) {
                const capability = COMMAND_TO_CAPABILITY[commandType];
                if (!capability) return false; // どの capability にも属さない未知コマンド
                try {
                    return options.authorizeCapability(capability);
                } catch {
                    return false; // コールバックが throw したら安全側（拒否）
                }
            }

            return true;
        },
    };
}
