/**
 * 今の設定でログインに使える手段か。解除の判定（最後の 1 つを外させない）と、設定の画面の表示に使う。
 * DB 上に行があっても、無効化・許可するサーバーの外・連合の block の外部アカウントでは入れないので数えない。
 */
import { fediverseHostOf } from '@ubichill/shared';

export interface LoginPolicyInput {
    fediverseEnabled: boolean;
    /** 空ならすべてのサーバー */
    allowedServers: ReadonlySet<string>;
    isBlocked(host: string): boolean;
}

export function createLoginPolicy(input: LoginPolicyInput): (providerId: string) => boolean {
    return (providerId) => {
        if (providerId === 'credential') return true;
        const host = fediverseHostOf(providerId);
        if (!host || !input.fediverseEnabled) return false;
        if (input.allowedServers.size > 0 && !input.allowedServers.has(host)) return false;
        return !input.isBlocked(host);
    };
}
