/**
 * サービストークン（mod が外部サービスへ渡す身元証明）を Ubichill のサーバーに依頼する手段を、Host アプリから受け取る。
 * 依頼先の URL や認証はアプリ固有なので、このパッケージは知らない（SocketProvider の resolveInstance と同じ形）。
 * Provider が無い環境（エディタの Preview 等）ではトークンを出さない。
 */
import type { ModAuthorProof, RpcIdentityTokenResult } from '@ubichill/shared';
import type React from 'react';
import { createContext, useContext } from 'react';

/** 失敗は UbiError（IDENTITY_UNAVAILABLE 等）で投げる。 */
export type RequestServiceToken = (input: {
    audience: string;
    modId: string;
    /** 依頼した mod の作者署名。発行元が確かめ直してトークンに作者（`mod_author`）を載せる。 */
    authorProof?: ModAuthorProof;
    signal?: AbortSignal;
}) => Promise<RpcIdentityTokenResult>;

const ServiceTokenContext = createContext<RequestServiceToken | null>(null);

export const ServiceTokenProvider: React.FC<{ requestToken: RequestServiceToken; children: React.ReactNode }> = ({
    requestToken,
    children,
}) => <ServiceTokenContext.Provider value={requestToken}>{children}</ServiceTokenContext.Provider>;

export function useServiceTokenRequester(): RequestServiceToken | null {
    return useContext(ServiceTokenContext);
}
