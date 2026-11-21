/** User-Agent から「Chrome（macOS）」のような端末の名前を作る（ログイン中の端末の一覧に出す）。読めなければ「不明な端末」。 */
export function deviceLabelOf(userAgent: string | null): string {
    if (!userAgent) return '不明な端末';
    const browser = [
        [/Edg(e|A|iOS)?\//, 'Edge'],
        [/OPR\/|Opera/, 'Opera'],
        [/Firefox\/|FxiOS\//, 'Firefox'],
        [/CriOS\/|Chrome\//, 'Chrome'],
        [/Safari\//, 'Safari'],
    ].find(([pattern]) => (pattern as RegExp).test(userAgent))?.[1] as string | undefined;
    const os = [
        [/iPhone|iPad|iPod/, 'iOS'],
        [/Android/, 'Android'],
        [/Windows/, 'Windows'],
        [/Mac OS X|Macintosh/, 'macOS'],
        [/CrOS/, 'ChromeOS'],
        [/Linux/, 'Linux'],
    ].find(([pattern]) => (pattern as RegExp).test(userAgent))?.[1] as string | undefined;
    if (browser && os) return `${browser}（${os}）`;
    return browser ?? os ?? '不明な端末';
}
