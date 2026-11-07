/**
 * Ed25519 の公開鍵の Multikey 表記（FEP-521a・W3C Controlled Identifiers の publicKeyMultibase）。
 * `z` + base58btc(0xed 0x01 + 32 バイトの公開鍵)。
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PUB_PREFIX = [0xed, 0x01] as const;

/** 大きな整数 → 58 進の桁（上の桁から）。 */
const digits58 = (n: bigint): number[] => (n === 0n ? [] : [...digits58(n / 58n), Number(n % 58n)]);
/** 大きな整数 → バイト（上のバイトから）。 */
const bytes256 = (n: bigint): number[] => (n === 0n ? [] : [...bytes256(n >> 8n), Number(n & 0xffn)]);

export function base58btcEncode(bytes: Uint8Array): string {
    const firstNonZero = bytes.findIndex((b) => b !== 0);
    const leading = firstNonZero < 0 ? bytes.length : firstNonZero;
    const value = bytes.slice(leading).reduce((acc, b) => acc * 256n + BigInt(b), 0n);
    return (
        '1'.repeat(leading) +
        digits58(value)
            .map((d) => ALPHABET[d])
            .join('')
    );
}

export function base58btcDecode(text: string): Uint8Array | null {
    const firstNonOne = [...text].findIndex((c) => c !== '1');
    const leading = firstNonOne < 0 ? text.length : firstNonOne;
    const values = [...text.slice(leading)].map((c) => ALPHABET.indexOf(c));
    if (values.some((v) => v < 0)) return null;
    const value = values.reduce((acc, v) => acc * 58n + BigInt(v), 0n);
    return Uint8Array.from([...new Array<number>(leading).fill(0), ...bytes256(value)]);
}

/** 32 バイトの Ed25519 の公開鍵 → publicKeyMultibase。 */
export function ed25519Multikey(publicKey: Uint8Array): string {
    if (publicKey.length !== 32) throw new Error('Ed25519 の公開鍵は 32 バイトです');
    return `z${base58btcEncode(Uint8Array.from([...ED25519_PUB_PREFIX, ...publicKey]))}`;
}

/** publicKeyMultibase → 32 バイトの Ed25519 の公開鍵。Ed25519 でなければ null。 */
export function parseEd25519Multikey(multibase: string): Uint8Array | null {
    if (!multibase.startsWith('z') || multibase.length > 64) return null;
    const bytes = base58btcDecode(multibase.slice(1));
    if (bytes?.length !== 34 || bytes[0] !== ED25519_PUB_PREFIX[0] || bytes[1] !== ED25519_PUB_PREFIX[1]) return null;
    return bytes.slice(2);
}
