/**
 * ボット対策（新規登録で、ボットでないことを Turnstile・hCaptcha で確かめる）。管理者がコントロールパネルで
 * サービスと鍵を決める。保存の前に、その鍵の組で実際に確かめて通ることを求める（誤った鍵で登録を全部止めないように）。
 * 保存先・暗号化・検証 API は注入する（本番は botProtectionService.ts）。
 */
import {
    BOT_CHECK_ACTIONS,
    BOT_CHECK_ERRORS,
    BOT_PROTECTION_PROVIDERS,
    type BotCheckAction,
    type BotCheckError,
    type BotProtectionConfig,
    type BotProtectionSettings,
    isBotProtectionProvider,
} from '@ubichill/shared';
import { z } from 'zod';
import { type BotCheckVerdict, judgeSiteVerify, type SiteVerifyInput, type SiteVerifyResult } from './providers';

export interface StoredBotProtection {
    provider: string;
    siteKey: string;
    /** 暗号化したシークレットキー */
    secret: string;
    updatedAt: Date;
}

export interface BotProtectionDeps {
    /** 登録のたびに読む設定（本番は 30 秒覚えたもの） */
    cached(): Promise<StoredBotProtection | null>;
    repository: {
        /** 覚えたものを通さずに読む（管理者の画面・設定の保存） */
        get(): Promise<StoredBotProtection | null>;
        put(input: { provider: string; siteKey: string; secret: string }): Promise<void>;
        clear(): Promise<void>;
    };
    box: {
        seal(plain: Uint8Array, context: string): string;
        open(sealed: string, context: string): Uint8Array | null;
    };
    /** 検証 API を呼ぶ。つながらない・応答が壊れているときは投げる */
    siteVerify(provider: BotProtectionConfig['provider'], input: SiteVerifyInput): Promise<SiteVerifyResult>;
    hostnames: ReadonlySet<string>;
    allowTestingKeys: boolean;
    /** 設定が変わった（覚えた設定を捨て、ほかの backend に知らせる） */
    changed(): void;
    warn(message: string): void;
}

export type BotCheckOutcome = { ok: true } | { ok: false; status: 400 | 503; code: BotCheckError };

export type BotProtectionUpdateOutcome =
    | { ok: true; value: BotProtectionSettings }
    | { ok: false; status: 400 | 503; error: string };

/** 保存した設定。知らないサービスなら config は null、シークレットキーを開けなければ secret は null（どちらも登録を止める）。 */
interface Active {
    config: BotProtectionConfig | null;
    secret: string | null;
    updatedAt: Date;
}

/** トークンの長さの上限（Turnstile は 2048 文字まで。hCaptcha はもう少し長いことがある） */
const MAX_TOKEN_LENGTH = 8192;

const Key = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\x21-\x7e]+$/);

/** 使うときの設定。使わないときは `{ provider: null }` だけ */
const EnableSchema = z.object({
    provider: z.enum(BOT_PROTECTION_PROVIDERS),
    siteKey: Key,
    secret: Key.optional(),
    token: z.string().min(1).max(MAX_TOKEN_LENGTH),
});

const UPDATE_FIELD_ERRORS: Readonly<Record<string, string>> = {
    siteKey: 'サイトキーが正しくありません',
    secret: 'シークレットキーが正しくありません',
    token: BOT_CHECK_ERRORS['bot-check-required'],
};

const sealContext = (config: BotProtectionConfig) => `bot-protection\n${config.provider}\n${config.siteKey}`;

/** 設定を保存する前の確認が通らなかった理由（管理者向け）。 */
function updateError(verdict: Exclude<BotCheckVerdict, { ok: true }>, hostnames: ReadonlySet<string>): string {
    switch (verdict.reason) {
        case 'failed':
            return '確認が通りませんでした。サイトキーとシークレットキーが組になっているかを確かめて、もう一度確かめてください';
        case 'misconfigured':
            return 'シークレットキーが正しくないか、サイトキーと組になっていません';
        case 'unavailable':
            return BOT_CHECK_ERRORS['bot-check-unavailable'];
        case 'testing-key':
            return 'テスト用の鍵は本番では使えません（ボットを止めません）';
        case 'wrong-action':
            return '確認が通りませんでした。もう一度確かめてください';
        case 'wrong-hostname':
            return `確かめたページのホスト名（${verdict.hostname ?? '無し'}）が、Ubichill の公開 URL（${[...hostnames].join('・')}）と違います`;
    }
}

export function createBotProtection(deps: BotProtectionDeps) {
    /** `fresh` は覚えた設定を通さない（保存済みのシークレットキーを使い回すときに、古いものを使わない） */
    const active = async (fresh = false): Promise<Active | null> => {
        const stored = await (fresh ? deps.repository.get() : deps.cached());
        if (!stored) return null;
        if (!isBotProtectionProvider(stored.provider))
            return { config: null, secret: null, updatedAt: stored.updatedAt };
        const config: BotProtectionConfig = { provider: stored.provider, siteKey: stored.siteKey };
        const opened = deps.box.open(stored.secret, sealContext(config));
        return { config, secret: opened ? new TextDecoder().decode(opened) : null, updatedAt: stored.updatedAt };
    };

    const verify = async (
        config: BotProtectionConfig,
        secret: string,
        token: string,
        action: BotCheckAction,
        remoteIp: string | undefined,
    ): Promise<BotCheckVerdict> => {
        const result = await deps
            .siteVerify(config.provider, { secret, token, siteKey: config.siteKey, remoteIp })
            .catch((error: unknown) => {
                // タイムアウト・HTTP の状態・壊れた応答のどれかを運用で見分けられるように残す（シークレットは含まない）
                deps.warn(
                    `ボット対策: 検証 API に問い合わせられない（${error instanceof Error ? error.message : String(error)}）`,
                );
                return null;
            });
        if (!result) return { ok: false, reason: 'unavailable' };
        return judgeSiteVerify(config.provider, result, {
            action,
            hostnames: deps.hostnames,
            allowTestingKeys: deps.allowTestingKeys,
        });
    };

    const settings = async (): Promise<BotProtectionSettings> => {
        const current = await active(true);
        return {
            config: current?.config ?? null,
            secretReadable: current === null || current.secret !== null,
            updatedAt: current?.updatedAt.toISOString() ?? null,
        };
    };

    return {
        /** 画面に渡す設定（使わないなら null）。 */
        async config(): Promise<BotProtectionConfig | null> {
            return (await active())?.config ?? null;
        },

        /** 守る操作の前に呼ぶ。使っていなければ通す。 */
        async check(input: {
            token: string | undefined;
            action: BotCheckAction;
            remoteIp: string | undefined;
        }): Promise<BotCheckOutcome> {
            const current = await active();
            if (!current) return { ok: true };
            if (current.config === null || current.secret === null) {
                deps.warn(
                    'ボット対策: 保存した設定を読めない（サーバーの秘密の入れ替え・知らないサービス）。登録を止めている',
                );
                return { ok: false, status: 503, code: 'bot-check-misconfigured' };
            }
            const token = input.token?.trim() ?? '';
            if (!token) return { ok: false, status: 400, code: 'bot-check-required' };
            if (token.length > MAX_TOKEN_LENGTH) return { ok: false, status: 400, code: 'bot-check-failed' };
            const verdict = await verify(current.config, current.secret, token, input.action, input.remoteIp);
            if (verdict.ok) return { ok: true };
            switch (verdict.reason) {
                case 'unavailable':
                    return { ok: false, status: 503, code: 'bot-check-unavailable' };
                case 'misconfigured':
                case 'testing-key':
                    deps.warn(`ボット対策: 鍵が使えない（${verdict.reason}）。登録を止めている`);
                    return { ok: false, status: 503, code: 'bot-check-misconfigured' };
                case 'wrong-hostname':
                    deps.warn(`ボット対策: 確かめたページのホスト名が違う（${verdict.hostname ?? '無し'}）`);
                    return { ok: false, status: 400, code: 'bot-check-failed' };
                default:
                    return { ok: false, status: 400, code: 'bot-check-failed' };
            }
        },

        /** コントロールパネルに出す今の設定。 */
        settings,

        /**
         * 設定を変える（管理者）。使うときは、その鍵の組でコントロールパネルの画面から確かめたトークンを添える。
         * シークレットキーを省くと、保存済みのもの（同じサービスのときだけ）を使う。
         */
        async update(input: unknown): Promise<BotProtectionUpdateOutcome> {
            if (typeof input === 'object' && input !== null && 'provider' in input && input.provider === null) {
                await deps.repository.clear();
                deps.changed();
                return { ok: true, value: await settings() };
            }
            const parsed = EnableSchema.safeParse(input);
            if (!parsed.success) {
                const field = parsed.error.issues[0]?.path[0];
                const error =
                    (typeof field === 'string' ? UPDATE_FIELD_ERRORS[field] : undefined) ??
                    'ボット対策のサービスが正しくありません';
                return { ok: false, status: 400, error };
            }
            const update = parsed.data;
            const config: BotProtectionConfig = { provider: update.provider, siteKey: update.siteKey };
            const current = update.secret === undefined ? await active(true) : null;
            const secret = update.secret ?? (current?.config?.provider === config.provider ? current.secret : null);
            if (secret === null) return { ok: false, status: 400, error: 'シークレットキーを入れてください' };

            const verdict = await verify(config, secret, update.token, BOT_CHECK_ACTIONS.settings, undefined);
            if (!verdict.ok) {
                return {
                    ok: false,
                    status: verdict.reason === 'unavailable' ? 503 : 400,
                    error: updateError(verdict, deps.hostnames),
                };
            }
            await deps.repository.put({
                ...config,
                secret: deps.box.seal(new TextEncoder().encode(secret), sealContext(config)),
            });
            deps.changed();
            return { ok: true, value: await settings() };
        },
    };
}

export type BotProtection = ReturnType<typeof createBotProtection>;
