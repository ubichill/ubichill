import { isPublishable, type WorldIdentity } from '@ubichill/shared';

interface EntryWorld {
    id: string;
    displayName: string;
    identity?: WorldIdentity;
    source?: { url: string };
}

/** セッション中に「入る」を選んだ未検証ワールドの記録先（sessionStorage 互換）。 */
export interface EntryAcceptanceStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'ubichill:accepted-unverified-worlds';

/**
 * 入室前に確認が必要なら確認キーを返す（署名検証済みなら null）。
 * キーに contentHash を含めるので、一度許可したワールドでも内容が変わればもう一度確認する。
 */
export function unverifiedEntryKey(world: EntryWorld): string | null {
    if (isPublishable(world.identity)) return null;
    return `${world.source?.url ?? world.id}#${world.identity?.contentHash ?? 'unknown'}`;
}

export function unverifiedEntryMessage(world: EntryWorld): string {
    return `「${world.displayName}」は作者の署名がないワールドです。内容が改竄されていないか、誰が作ったかを確認できません。配信元を信頼できる場合のみ入室してください。入室しますか？`;
}

function readAccepted(store: EntryAcceptanceStore): readonly string[] {
    try {
        const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]') as unknown;
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

export function hasAcceptedEntry(store: EntryAcceptanceStore, key: string): boolean {
    return readAccepted(store).includes(key);
}

export function acceptEntry(store: EntryAcceptanceStore, key: string): void {
    const next = [...readAccepted(store).filter((k) => k !== key), key].slice(-50);
    store.setItem(STORAGE_KEY, JSON.stringify(next));
}
