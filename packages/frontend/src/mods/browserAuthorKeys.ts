/**
 * ブラウザで作者の鍵一覧を確かめた結果の保存（作者の確認の規則は @ubichill/shared の authorKeyDirectory。backend と同じ）。
 *
 * backend は DB に持つ結果を、ブラウザは localStorage に持つ。再読み込みしても T_fresh・T_max の猶予と
 * 「確認が古い間は、古くなる前に確認済みだった内容にだけ作者を付ける」規則が backend と同じように効く。
 * 中身は読むときに検証する（壊れた・手で書き換えた値は無いものとして扱う）。
 */
import {
    type AuthorBindingStore,
    type AuthorProfile,
    type SigningKeyEntry,
    SigningKeyEntrySchema,
} from '@ubichill/shared';

const BINDINGS_KEY = 'ubichill:author-bindings:v1';
const CONTENTS_KEY = 'ubichill:author-confirmed-contents:v1';
/** 保存する作者・内容の数の上限（作者名を変えた署名を読まされても、保存領域を食い潰さない）。 */
export const MAX_STORED_AUTHORS = 200;
export const MAX_STORED_CONTENTS = 2000;

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface StoredBinding {
    keys: SigningKeyEntry[];
    displayName?: string;
    fetchedAt: number;
}
type StoredBindings = [string, StoredBinding][];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** 1 件でも形が違えば全体を捨てる（部分的に壊れた値を信じない）。 */
function parseBindings(value: unknown): StoredBindings | undefined {
    if (!Array.isArray(value)) return undefined;
    const parsed = value.map((item): [string, StoredBinding] | undefined => {
        if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || !isRecord(item[1])) {
            return undefined;
        }
        const { keys, displayName, fetchedAt } = item[1];
        if (!Array.isArray(keys) || !Number.isFinite(fetchedAt)) return undefined;
        if (displayName !== undefined && typeof displayName !== 'string') return undefined;
        const entries = keys.map((k) => SigningKeyEntrySchema.safeParse(k));
        if (!entries.every((e) => e.success)) return undefined;
        return [
            item[0],
            {
                keys: entries.flatMap((e) => (e.success ? [e.data] : [])),
                ...(displayName ? { displayName } : {}),
                fetchedAt: fetchedAt as number,
            },
        ];
    });
    return parsed.every((p) => p !== undefined) ? (parsed as StoredBindings) : undefined;
}

const parseContents = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;

function read<T>(storage: KeyValueStorage, key: string, parse: (value: unknown) => T | undefined, fallback: T): T {
    try {
        const raw = storage.getItem(key);
        return (raw === null ? undefined : parse(JSON.parse(raw))) ?? fallback;
    } catch {
        return fallback;
    }
}

function write(storage: KeyValueStorage, key: string, value: unknown): void {
    try {
        storage.setItem(key, JSON.stringify(value));
    } catch {
        // 保存できなくても確認自体は続ける（その場合は再読み込みで猶予が効かないだけ）
    }
}

/** 古い順に並べた配列の末尾へ入れ直し、上限を超えた分を先頭から捨てる。 */
const appendBounded = <T>(items: readonly T[], item: T, same: (a: T) => boolean, max: number): T[] =>
    [...items.filter((a) => !same(a)), item].slice(-max);

export function createStoredAuthorBindings(
    storage: KeyValueStorage,
    now: () => number = Date.now,
): {
    bindings: AuthorBindingStore;
    confirmedContents: {
        record: (account: string, contentHash: string) => Promise<void>;
        has: (account: string, contentHash: string) => Promise<boolean>;
    };
} {
    const contentKey = (account: string, contentHash: string) => `${account} ${contentHash}`;
    return {
        bindings: {
            find: async (account) => {
                const found = read<StoredBindings>(storage, BINDINGS_KEY, parseBindings, []).find(
                    ([a]) => a === account,
                )?.[1];
                return found
                    ? {
                          keys: found.keys,
                          ...(found.displayName ? { displayName: found.displayName } : {}),
                          fetchedAt: new Date(found.fetchedAt),
                      }
                    : undefined;
            },
            save: async (account, profile: AuthorProfile) => {
                const current = read<StoredBindings>(storage, BINDINGS_KEY, parseBindings, []);
                const entry: [string, StoredBinding] = [
                    account,
                    {
                        keys: [...profile.keys],
                        ...(profile.displayName ? { displayName: profile.displayName } : {}),
                        fetchedAt: now(),
                    },
                ];
                write(
                    storage,
                    BINDINGS_KEY,
                    appendBounded(current, entry, ([a]) => a === account, MAX_STORED_AUTHORS),
                );
            },
        },
        confirmedContents: {
            record: async (account, contentHash) => {
                const key = contentKey(account, contentHash);
                const current = read<string[]>(storage, CONTENTS_KEY, parseContents, []);
                write(
                    storage,
                    CONTENTS_KEY,
                    appendBounded(current, key, (a) => a === key, MAX_STORED_CONTENTS),
                );
            },
            has: async (account, contentHash) =>
                read<string[]>(storage, CONTENTS_KEY, parseContents, []).includes(contentKey(account, contentHash)),
        },
    };
}
