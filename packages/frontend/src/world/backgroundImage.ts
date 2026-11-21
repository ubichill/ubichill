import type { WorldEnvironmentData } from '@ubichill/shared';

/**
 * 背景の画像を CSS の値にする。http(s) の URL だけを通し、URL として正規化してから引用符で囲む
 * （引用符・改行は URL の正規化で符号化・除去されるので、CSS の値を抜け出せない）。
 */
export function backgroundImageStyle(
    environment: Pick<WorldEnvironmentData, 'backgroundImage' | 'backgroundImageFit'>,
): { backgroundImage: string; backgroundSize?: string; backgroundRepeat: string; backgroundPosition: string } | null {
    const source = environment.backgroundImage;
    if (!source || !URL.canParse(source)) return null;
    const url = new URL(source);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return environment.backgroundImageFit === 'tile'
        ? { backgroundImage: `url("${url.href}")`, backgroundRepeat: 'repeat', backgroundPosition: '0 0' }
        : {
              backgroundImage: `url("${url.href}")`,
              backgroundSize: 'cover',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
          };
}
