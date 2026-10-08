import { CommandType } from '@ubichill/shared/mod/protocol';
import type { RpcIdentityTokenResult } from '@ubichill/shared/mod/types';
import type { RpcFn } from '../types';

export type IdentityTokenOptions = {
    /** abort すると発行の依頼（ドメイン承認の待ちを含む）を取り消す。 */
    signal?: AbortSignal;
};

export type IdentityModule = {
    /**
     * 外部サービスへ渡すサービストークン（短命の署名付き JWT）を受け取る。
     * `audience` はサービスのオリジン（例 `'https://api.example.com'`）。トークンはそのサービスでしか通らない。
     *
     * - サービスには、そのサービス専用の匿名 ID（sub）と mod の ID が伝わる。本当のユーザー ID・メールは伝わらない。
     * - 宛先は `Ubi.fetch` と同じくユーザーが通信を許したドメインに限る（初回は承認画面が出る）。
     * - ゲスト・未ログインでは `IDENTITY_UNAVAILABLE` の UbiError で失敗する。
     * - 同じ宛先のトークンは期限の少し前まで使い回されるので、毎回呼んでよい。
     *
     * サービス側の検証方法は docs/SERVICE_TOKEN.md。
     */
    token(audience: string, options?: IdentityTokenOptions): Promise<RpcIdentityTokenResult>;
};

export function createIdentityModule(rpc: RpcFn): IdentityModule {
    return {
        token: (audience, options) =>
            rpc<RpcIdentityTokenResult>(
                { type: CommandType.IDENTITY_TOKEN, payload: { audience } },
                { signal: options?.signal },
            ),
    };
}
