/**
 * 外部の作品の実体（DB・safeFetch・作者の確認を注入する）。ロジックは externalWorks.ts。
 * 表示する前の確認は作品ごとに一定時間使い回す（ユーザーページを開くたびに外部へ取りに行かない）。
 */
import { type ExternalWorkRecord, externalWorkRepository } from '@ubichill/db';
import type { PublishedMod, WorldListItem } from '@ubichill/shared';
import { createTtlCache } from '../utils/ttlCache';
import { isAuthorKey } from './authorKeyStore';
import { confirmPublishedMod } from './externalWorks';
import { safeFetch } from './safeFetch';
import { nodeWorldCrypto } from './worldCrypto';
import { worldRegistry } from './worldRegistry';

/** 確認の結果を使い回す時間。作者が置き換え・取り下げをしたときに、ユーザーページに反映されるまでの上限。 */
const CONFIRM_TTL_MS = 10 * 60 * 1000;
const confirmedMods = createTtlCache<PublishedMod | undefined>({ ttlMs: CONFIRM_TTL_MS, max: 2000 });

const fetchJson = async (url: string): Promise<unknown> => {
    const res = await safeFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    return res.ok ? ((await res.json()) as unknown) : undefined;
};

async function confirmWorld(record: ExternalWorkRecord, account: string): Promise<WorldListItem | undefined> {
    // ワールドの解決（取得・署名と作者の確認・期限つきのキャッシュ）は外部のワールドに入るときと同じものを使う
    const item = await worldRegistry.publishableListItem(record.url).catch(() => undefined);
    return item?.identity?.status === 'verified' && item.identity.author === account ? item : undefined;
}

function confirmMod(record: ExternalWorkRecord, account: string): Promise<PublishedMod | undefined> {
    const version = record.version;
    if (!version) return Promise.resolve(undefined);
    return confirmedMods.getOrCreate(`${account} ${record.url} ${record.name} ${version}`, () =>
        confirmPublishedMod(
            { url: record.url, name: record.name, version },
            { account, crypto: nodeWorldCrypto, isAuthorKey, fetchJson },
        ),
    );
}

/** ユーザーページに出す外部の作品（いま本人の署名付きで配られていると確かめられたものだけ）。 */
export async function publishedExternalWorks(
    userId: string,
    account: string,
): Promise<{ worlds: WorldListItem[]; mods: PublishedMod[] }> {
    const records = await externalWorkRepository.listByUser(userId);
    const [worlds, mods] = await Promise.all([
        Promise.all(records.filter((r) => r.kind === 'world').map((r) => confirmWorld(r, account))),
        Promise.all(records.filter((r) => r.kind === 'mod').map((r) => confirmMod(r, account).catch(() => undefined))),
    ]);
    return {
        worlds: worlds.filter((w): w is WorldListItem => w !== undefined),
        mods: mods.filter((m): m is PublishedMod => m !== undefined),
    };
}
