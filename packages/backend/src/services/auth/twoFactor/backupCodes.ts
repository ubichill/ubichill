/**
 * バックアップコード（認証アプリを使えなくなったときに 1 回ずつ使う）。10 文字（50 ビット）を 10 個。
 * 見間違えやすい i・l・o・u は使わず、入力ではそれらを 1・1・0 として読む（Crockford の base32 と同じ考え方）。
 */
export const BACKUP_CODE_COUNT = 10;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LENGTH = 10;

/** コードを 1 つ作る（`xxxxx-xxxxx`）。256 は 32 で割り切れるので、バイトを 32 で割った余りに偏りは出ない。 */
export function newBackupCode(randomBytes: (size: number) => Uint8Array): string {
    const chars = Array.from(randomBytes(LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join('');
    return `${chars.slice(0, LENGTH / 2)}-${chars.slice(LENGTH / 2)}`;
}

export function newBackupCodes(randomBytes: (size: number) => Uint8Array): string[] {
    return Array.from({ length: BACKUP_CODE_COUNT }, () => newBackupCode(randomBytes));
}

/** 入力を比べる形にする（大文字・空白・ハイフンを許し、見間違えやすい文字を読み替える）。形が違えば null。 */
export function normalizeBackupCode(input: string): string | null {
    const normalized = input.toLowerCase().replace(/[\s-]/g, '').replace(/[il]/g, '1').replace(/o/g, '0');
    return normalized.length === LENGTH && [...normalized].every((c) => ALPHABET.includes(c)) ? normalized : null;
}
