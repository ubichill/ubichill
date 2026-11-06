/**
 * 起動の終わりの案内（Vite の「ready in」の下の行）と、起動できなかったときの直し方。
 */
import { type BannerRow, HintedError } from '@ubichill/terminal';
import { DEBUG_FLAG } from '../output.ts';
import type { DevUrls, HostOption } from './address.ts';

/** 起動し終えたときの案内の行（URL・ワールド・状態・--debug）。 */
export function bannerRows(input: {
    readonly urls: DevUrls;
    readonly host: HostOption;
    readonly world: string;
    readonly modCount: number | undefined;
    readonly localCount: number;
    readonly failing: boolean;
    readonly debug: boolean;
}): BannerRow[] {
    const mods =
        input.modCount === undefined ? `手元 ${input.localCount}` : `mod ${input.modCount}・手元 ${input.localCount}`;
    return [
        ...(input.urls.local ? [{ label: 'Local', value: input.urls.local, tone: 'url' as const }] : []),
        ...input.urls.network.map((url) => ({ label: 'Network', value: url, tone: 'url' as const })),
        ...(input.host.kind === 'loopback'
            ? [{ label: 'Network', value: '--host を付けると LAN に公開します', tone: 'dim' as const }]
            : []),
        { label: 'World', value: input.world, note: `(${mods})` },
        ...(input.failing
            ? [
                  {
                      label: 'Status',
                      value: 'ビルドに失敗しています。上のエラーを直して保存すると読み直します',
                      tone: 'warn' as const,
                  },
              ]
            : []),
        input.debug
            ? { label: 'Debug', value: '有効（HTTP・Go のログ・判断と時間）', tone: 'dim' as const }
            : { label: 'Debug', value: `${DEBUG_FLAG} でログを詳しく`, tone: 'dim' as const },
    ];
}

/** 待ち受けの失敗を、直し方の付いた失敗にする。 */
export function listenFailure(error: unknown, port: number, host: HostOption): unknown {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === 'EADDRINUSE')
        return new HintedError(
            `ポート ${port} は使われています`,
            '--port=<n> で別のポートを指定するか、使っているプロセスを止めてください',
            { cause: error },
        );
    if (code === 'EADDRNOTAVAIL' && host.kind === 'address')
        return new HintedError(
            `${host.host} で待ち受けられません（この機械の口ではありません）`,
            '--host=<この機械の IP> を指定してください',
            {
                cause: error,
            },
        );
    if (code === 'EACCES')
        return new HintedError(
            `ポート ${port} で待ち受ける権限がありません`,
            '1024 以上のポートを --port=<n> で指定してください',
            {
                cause: error,
            },
        );
    return error;
}
