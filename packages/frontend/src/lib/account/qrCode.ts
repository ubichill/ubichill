import { encode } from 'uqr';

/**
 * QR コードを SVG の 1 本の path にする（暗いマスごとに 1×1 の四角）。読み取りに要る余白（quiet zone）を含めた
 * 一辺のマス数も返す。
 */
export function qrCodePath(text: string): { size: number; path: string } {
    const { size, data } = encode(text, { ecc: 'M', border: 4 });
    return { size, path: modulesToPath(data) };
}

/** 暗いマス（true）を `M x y h1 v1 h-1 z` の並びにする。 */
export function modulesToPath(modules: readonly (readonly boolean[])[]): string {
    return modules.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join('');
}
