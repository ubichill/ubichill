/** 鍵の指紋（画面で見比べるための短い表示）。 */
export function keyFingerprint(publicKey: string): string {
    return `${publicKey.slice(0, 6)}…${publicKey.slice(-6)}`;
}
