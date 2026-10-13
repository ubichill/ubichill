/**
 * 外部の作品の実体（DB・safeFetch・作者の確認を注入する）。ロジックは externalWorks.ts。
 * 公開先を確かめた結果は作品ごとに使い回す（ユーザーページを開くたびに外部へ取りに行かない）。公開済みは長く、
 * それ以外（公開前・障害・不正）は短く持つ。公開した直後に開いても、少し待てば出るように。
 */
import { type ExternalWorkRecord, externalWorkRepository } from '@ubichill/db';
import type { ExternalWork, ExternalWorkStatus, PublishedMod, WorldListItem } from '@ubichill/shared';
import { setBounded } from '../utils/boundedMap';
import { isAuthorKey } from './authorKeyStore';
import { confirmPublishedMod, type FetchedJson, worldConfirmation } from './externalWorks';
import { safeFetch } from './safeFetch';
import { nodeWorldCrypto } from './worldCrypto';
import { worldRegistry } from './worldRegistry';

const PUBLISHED_TTL_MS = 10 * 60 * 1000;
const NOT_PUBLISHED_TTL_MS = 60 * 1000;
const MAX_CACHED = 2000;

type Confirmation =
    | { status: 'published'; world?: WorldListItem; mod?: PublishedMod }
    | { status: Exclude<ExternalWorkStatus, 'published'> };

const confirmations = new Map<string, { at: number; value: Promise<Confirmation> }>();

/** 404 などは「無い」、通信の失敗・5xx は throw（取得の失敗と公開前を分ける）。 */
const fetchJson = async (url: string): Promise<FetchedJson> => {
    const res = await safeFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return { found: false };
    try {
        return { found: true, value: (await res.json()) as unknown };
    } catch {
        return { found: false };
    }
};

async function confirm(record: ExternalWorkRecord, account: string, fresh: boolean): Promise<Confirmation> {
    if (record.kind === 'world') {
        // 外部のワールドに入るときと同じ解決（取得・署名と作者の確認・期限つきのキャッシュ）を使う
        const resolution = await (fresh
            ? worldRegistry.resolveRemoteFresh(record.url)
            : worldRegistry.resolveRemote(record.url));
        const confirmed = worldConfirmation(resolution, { account, name: record.name });
        return confirmed.status === 'published'
            ? { status: 'published', world: worldRegistry.listItemOf(confirmed.world) }
            : confirmed;
    }
    if (!record.version) return { status: 'invalid' };
    return confirmPublishedMod(
        { url: record.url, name: record.name, version: record.version },
        { account, crypto: nodeWorldCrypto, isAuthorKey, fetchJson },
    );
}

/** 確かめた結果と、確かめた時刻。 */
interface Checked {
    confirmation: Confirmation;
    checkedAt: number;
}

function cachedConfirm(record: ExternalWorkRecord, account: string, fresh: boolean): Promise<Checked> {
    const key = `${account} ${record.kind} ${record.url} ${record.name} ${record.version ?? ''}`;
    const now = Date.now();
    const hit = confirmations.get(key);
    if (!fresh && hit) {
        // 結果で期限を変える（結果がまだ出ていなければ、出るまで待つ）
        return hit.value.then((confirmation) =>
            now - hit.at < (confirmation.status === 'published' ? PUBLISHED_TTL_MS : NOT_PUBLISHED_TTL_MS)
                ? { confirmation, checkedAt: hit.at }
                : cachedConfirm(record, account, true),
        );
    }
    const value = confirm(record, account, fresh).catch((): Confirmation => ({ status: 'unreachable' }));
    setBounded(confirmations, key, { at: now, value }, MAX_CACHED);
    return value.then((confirmation) => ({ confirmation, checkedAt: now }));
}

/** ユーザーページに出す外部の作品（いま本人の署名付きで配られていると確かめられたものだけ）。 */
export async function publishedExternalWorks(
    userId: string,
    account: string,
): Promise<{ worlds: WorldListItem[]; mods: PublishedMod[] }> {
    const records = await externalWorkRepository.listByUser(userId);
    const confirmed = (await Promise.all(records.map((r) => cachedConfirm(r, account, false)))).map(
        (c) => c.confirmation,
    );
    return {
        worlds: confirmed.flatMap((c) => (c.status === 'published' && c.world ? [c.world] : [])),
        mods: confirmed.flatMap((c) => (c.status === 'published' && c.mod ? [c.mod] : [])),
    };
}

/** 本人の設定画面の一覧（確かめた状態つき）。`fresh` なら使い回さずに確かめ直す（再確認）。 */
export async function externalWorkStatuses(userId: string, account: string, fresh: boolean): Promise<ExternalWork[]> {
    const records = await externalWorkRepository.listByUser(userId);
    return Promise.all(
        records.map(async (r): Promise<ExternalWork> => {
            const { confirmation, checkedAt } = await cachedConfirm(r, account, fresh);
            return {
                kind: r.kind === 'mod' ? 'mod' : 'world',
                url: r.url,
                name: r.name,
                ...(r.version ? { version: r.version } : {}),
                registeredAt: r.registeredAt.toISOString(),
                status: confirmation.status,
                checkedAt: new Date(checkedAt).toISOString(),
            };
        }),
    );
}
