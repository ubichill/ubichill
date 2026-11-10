/**
 * 入力（`ubichill.com`・`https://ubichill.com/world/x` など）をフォロー先のオリジンにする。読めなければ null。
 * サーバーのワールドはオリジンの `/api/v1/worlds` から取るので、パスは捨てる。
 */
export function peerOriginOf(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
        const url = new URL(withScheme);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
        return url.origin;
    } catch {
        return null;
    }
}
