/**
 * 認証アプリのコード（TOTP、RFC 6238）。Google Authenticator などに合わせて SHA-1・6 桁・30 秒にする。
 * 時計のずれを前後 1 区切りまで許し、同じ区切りのコードは 2 回受け付けない（RFC 6238 §5.2）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** 前後に許す区切りの数（±30 秒） */
const WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 の base32（認証アプリに渡す形。= の詰め物は付けない）。 */
export function base32Encode(bytes: Uint8Array): string {
    const bits = Array.from(bytes, (b) => b.toString(2).padStart(8, '0')).join('');
    const chunks = bits.match(/.{1,5}/g) ?? [];
    return chunks.map((chunk) => BASE32_ALPHABET[Number.parseInt(chunk.padEnd(5, '0'), 2)]).join('');
}

/** HOTP（RFC 4226）。 */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const mac = createHmac('sha1', secret).update(message).digest();
    const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
    const binary = mac.readUInt32BE(offset) & 0x7fffffff;
    return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** その時刻の区切りの番号。 */
export function totpStep(now: Date): number {
    return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/**
 * コードが合う区切りの番号を返す（合わなければ null）。`usedStep` 以前の区切りは受け付けない
 * （一度使ったコードを横から見て使い回させない）。
 */
export function matchTotp(secret: Uint8Array, code: string, now: Date, usedStep: number | null): number | null {
    if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null;
    const current = totpStep(now);
    const presented = Buffer.from(code);
    const steps = Array.from({ length: WINDOW * 2 + 1 }, (_, i) => current - WINDOW + i);
    return (
        steps.find(
            (step) =>
                (usedStep === null || step > usedStep) &&
                step >= 0 &&
                timingSafeEqual(Buffer.from(hotp(secret, step)), presented),
        ) ?? null
    );
}

/** 認証アプリに読ませる URI（QR コードにする）。 */
export function otpauthUri(input: { secret: Uint8Array; issuer: string; account: string }): string {
    const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
    const params = new URLSearchParams({
        secret: base32Encode(input.secret),
        issuer: input.issuer,
        algorithm: 'SHA1',
        digits: String(TOTP_DIGITS),
        period: String(TOTP_PERIOD_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}
