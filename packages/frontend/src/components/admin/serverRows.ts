import type { DomainPolicy, DomainPolicyRecord, FederationServer } from '@/lib/admin/federationApi';

/** 一覧の 1 行（知っているサーバーと、まだ連絡の無いサーバーに決めた方針）。 */
export interface ServerRow {
    domain: string;
    policy: DomainPolicy;
    /** 届かない（続けて失敗している・止めている） */
    unreachable: boolean;
    lastSeenAt: string | null;
}

/**
 * サーバーと方針をまとめる。絞っているサーバーを先に、ほかは最近連絡のあった順。
 * 方針だけのドメイン（まだ連絡の無いサーバー・親ドメイン）も出す。
 */
export function serverRows(
    servers: readonly FederationServer[],
    policies: readonly DomainPolicyRecord[],
    now: number,
): ServerRow[] {
    const byPolicy = new Map(policies.map((p) => [p.domain, p.policy]));
    const known = servers.map(
        (s): ServerRow => ({
            domain: s.domain,
            policy: byPolicy.get(s.domain) ?? s.policy,
            unreachable: !!s.failingSince || (!!s.pausedUntil && Date.parse(s.pausedUntil) > now),
            lastSeenAt: s.lastSeenAt,
        }),
    );
    const seen = new Set(known.map((r) => r.domain));
    const onlyPolicies = policies
        .filter((p) => !seen.has(p.domain))
        .map((p): ServerRow => ({ domain: p.domain, policy: p.policy, unreachable: false, lastSeenAt: null }));
    const rank = (r: ServerRow) => (r.policy === 'block' ? 0 : r.policy === 'limit' ? 1 : 2);
    return [...known, ...onlyPolicies].sort(
        (a, b) =>
            rank(a) - rank(b) ||
            (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') ||
            a.domain.localeCompare(b.domain),
    );
}

/** 入力をドメインとして読む（URL を貼っても、`@handle@domain` を貼ってもよい）。読めなければ null。 */
export function domainFromInput(input: string): string | null {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return null;
    const url = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? URL.parse(trimmed) : null;
    const account = /^@?[^@\s/:]+@([^@\s/]+)$/.exec(trimmed);
    const candidate = url ? url.host : (account?.[1] ?? trimmed);
    if (!candidate) return null;
    return /^(?=.{1,253}(:\d{1,5})?$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(:\d{1,5})?$/.test(
        candidate,
    )
        ? candidate
        : null;
}
