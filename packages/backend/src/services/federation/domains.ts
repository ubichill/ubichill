/** ほかのサーバーとの付き合い方（管理者の決めたもの）を覚えておき、要求ごとに DB を引かない。変えたらすぐ読み直す。 */
import { type DomainPolicy, type DomainRestriction, policyFor } from '@ubichill/shared';

export interface DomainPolicies {
    policyOf(domain: string): DomainPolicy;
    reload(): Promise<void>;
}

export function createDomainPolicies(deps: {
    list(): Promise<Array<{ domain: string; policy: string }>>;
    now(): number;
    refreshMs?: number;
}): DomainPolicies {
    const state = {
        restrictions: new Map<string, DomainRestriction>(),
        loadedAt: 0,
        loading: null as Promise<void> | null,
    };
    const reload = async () => {
        const rows = await deps.list();
        state.restrictions = new Map(
            rows.flatMap((r) =>
                r.policy === 'limit' || r.policy === 'block' ? [[r.domain.toLowerCase(), r.policy]] : [],
            ),
        );
        state.loadedAt = deps.now();
    };
    return {
        policyOf(domain) {
            // 古ければ裏で読み直す（読み直すまでは今の方針で答える）
            if (deps.now() - state.loadedAt > (deps.refreshMs ?? 30_000) && !state.loading) {
                state.loading = reload()
                    .catch(() => undefined)
                    .finally(() => {
                        state.loading = null;
                    });
            }
            return policyFor(domain, state.restrictions);
        },
        reload,
    };
}
