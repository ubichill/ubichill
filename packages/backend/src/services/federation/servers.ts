/**
 * 知っているほかのサーバー（NodeInfo で ubichill か・Application actor で機能）と、配送の調子（止めているか）。
 */
import type { RemoteServerRecord } from '@ubichill/db';
import {
    APPLICATION_ACTOR_REL,
    circuitPauseMs,
    DELIVERY_LIMITS,
    isUnreachable,
    nodeInfoUrlFrom,
    originForDomain,
    readNodeInfo,
} from '@ubichill/shared';
import { z } from 'zod';
import type { Transport } from './transport';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ServerDirectoryDeps {
    allowHttp: boolean;
    repo: {
        get(domain: string): Promise<RemoteServerRecord | undefined>;
        list(): Promise<RemoteServerRecord[]>;
        setInfo(
            domain: string,
            info: {
                software: string | null;
                version: string | null;
                federationVersion: number | null;
                features: string[];
            },
            now: Date,
        ): Promise<void>;
        recordSuccess(domain: string, now: Date): Promise<void>;
        recordFailure(domain: string, now: Date, pausedUntil?: (failures: number) => Date | null): Promise<number>;
    };
    transport: Pick<Transport, 'get'>;
    /** Application actor の機能を引く（actor の取得はキャッシュを通す） */
    appFeatures(actorUrl: string): Promise<string[] | null>;
    now(): number;
}

export interface ServerDirectory {
    /** 相手のサーバーの情報（1 日ごとに取り直す）。取れなければ前の記録 */
    describe(domain: string): Promise<RemoteServerRecord | null>;
    /** 相手が機能を告知しているか */
    supports(domain: string, feature: string): Promise<boolean>;
    /** いま送らないホスト（続けて失敗して止めている・到達できない） */
    pausedHosts(): Promise<string[]>;
    recordSuccess(domain: string): Promise<void>;
    recordFailure(domain: string): Promise<void>;
}

export function createServerDirectory(deps: ServerDirectoryDeps): ServerDirectory {
    const fetchInfo = async (domain: string): Promise<void> => {
        for (const origin of originForDomain(domain, { allowHttp: deps.allowHttp })) {
            const links = await deps.transport
                .get(`${origin}/.well-known/nodeinfo`, {
                    signAs: { kind: 'app' },
                    maxBytes: 16 * 1024,
                    accept: 'application/json',
                })
                .catch(() => null);
            if (links?.status !== 200) continue;
            const nodeInfoUrl = nodeInfoUrlFrom(links.json);
            const info = nodeInfoUrl
                ? await deps.transport
                      .get(nodeInfoUrl, { signAs: { kind: 'app' }, maxBytes: 64 * 1024, accept: 'application/json' })
                      .catch(() => null)
                : null;
            const summary = info?.status === 200 ? readNodeInfo(info.json) : null;
            const appLink = z
                .object({ links: z.array(z.object({ rel: z.string(), href: z.string() }).passthrough()) })
                .safeParse(links.json);
            const appUrl = appLink.success
                ? appLink.data.links.find((l) => l.rel === APPLICATION_ACTOR_REL)?.href
                : undefined;
            const features = appUrl ? ((await deps.appFeatures(appUrl).catch(() => null)) ?? []) : [];
            await deps.repo.setInfo(
                domain,
                {
                    software: summary?.software ?? null,
                    version: summary?.version ?? null,
                    federationVersion: summary?.federationVersion ?? null,
                    features,
                },
                new Date(deps.now()),
            );
            return;
        }
    };

    const describe = async (domain: string) => {
        const known = await deps.repo.get(domain);
        const fetchedAt = known?.nodeInfoFetchedAt?.getTime() ?? 0;
        if (!known || deps.now() - fetchedAt > DAY_MS) await fetchInfo(domain).catch(() => undefined);
        return (await deps.repo.get(domain)) ?? null;
    };

    return {
        describe,
        async supports(domain, feature) {
            return (await describe(domain))?.features.includes(feature) ?? false;
        },
        async pausedHosts() {
            const now = deps.now();
            return (await deps.repo.list())
                .filter((r) => r.pausedUntil && r.pausedUntil.getTime() > now)
                .map((r) => r.domain);
        },
        recordSuccess: (domain) => deps.repo.recordSuccess(domain, new Date(deps.now())),
        /** 続けて失敗したら止める（到達できないサーバーは 6 時間ごとにだけ試す）。 */
        async recordFailure(domain) {
            const now = deps.now();
            const failingSince = (await deps.repo.get(domain))?.failingSince?.getTime() ?? now;
            await deps.repo.recordFailure(domain, new Date(now), (failures) => {
                const pause = isUnreachable(failingSince, now)
                    ? DELIVERY_LIMITS.UNREACHABLE_PROBE_MS
                    : circuitPauseMs(failures);
                return pause > 0 ? new Date(now + pause) : null;
            });
        },
    };
}
