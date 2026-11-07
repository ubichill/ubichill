/**
 * ほかのサーバーとの付き合い方（管理者が決める）。どの ubichill サーバーとも連合するのが既定で、問題のあるサーバーだけを絞る。
 * - limit: 新しいフレンド・招待・リクエスト・来訪を受けない（今あるフレンドはそのまま）
 * - block: 送受信・取得を全部やめ、フレンドも切る
 * サブドメインにも効く（`spam.example` を block すれば `a.spam.example` も block）。
 */

export type DomainPolicy = 'allow' | 'limit' | 'block';
export type DomainRestriction = Exclude<DomainPolicy, 'allow'>;

export const DOMAIN_POLICY_LABELS: Record<DomainPolicy, string> = {
    allow: '連合する',
    limit: '新しいつながりを受けない',
    block: '連合しない',
};

const RANK: Record<DomainPolicy, number> = { allow: 0, limit: 1, block: 2 };

/** ドメイン（ポート付きでもよい）と、その親ドメイン（ポートなし）。 */
function domainAndParents(domain: string): string[] {
    const lower = domain.toLowerCase();
    const host = lower.replace(/:\d+$/, '');
    const labels = host.split('.');
    const parents = labels.slice(1).map((_, i) => labels.slice(i + 1).join('.'));
    return [...new Set([lower, host, ...parents])].filter((d) => d !== '');
}

/** ドメインに効く方針（そのドメインと親ドメインの方針のうち、いちばん強いもの）。 */
export function policyFor(domain: string, restrictions: ReadonlyMap<string, DomainRestriction>): DomainPolicy {
    return domainAndParents(domain).reduce<DomainPolicy>((strongest, d) => {
        const policy = restrictions.get(d);
        return policy && RANK[policy] > RANK[strongest] ? policy : strongest;
    }, 'allow');
}

/** 新しいつながり（申請・招待・リクエスト・来訪）を受けるか。 */
export const acceptsNewContact = (policy: DomainPolicy): boolean => policy === 'allow';

/** やり取り（送受信・取得）をするか。 */
export const exchanges = (policy: DomainPolicy): boolean => policy !== 'block';
