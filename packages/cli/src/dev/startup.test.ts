import { describeError, formatBanner, plainPaint, UNICODE_SYMBOLS } from '@ubichill/terminal';
import { describe, expect, it } from 'vitest';
import { bannerRows, listenFailure } from './startup.ts';

const base = {
    urls: { local: 'http://localhost:3333/', network: [] },
    host: { kind: 'loopback' },
    world: 'worlds/chillwa.yaml',
    modCount: 2,
    localCount: 0,
    failing: false,
    debug: false,
} as const;

describe('bannerRows', () => {
    it('ふだんの起動: Local・LAN に出す方法・ワールド・--debug の案内', () => {
        const text = formatBanner(
            { title: 'ubichill dev', version: '1.0.2', readyMs: 812, rows: bannerRows(base) },
            { paint: plainPaint, symbols: UNICODE_SYMBOLS },
        );
        expect(text.split('\n')).toEqual([
            '',
            '  ubichill dev  v1.0.2  ready in 812 ms',
            '',
            '  ➜  Local:   http://localhost:3333/',
            '  ➜  Network: --host を付けると LAN に公開します',
            '  ➜  World:   worlds/chillwa.yaml  (mod 2・手元 0)',
            '  ➜  Debug:   --debug でログを詳しく',
            '',
        ]);
    });

    it('--host では LAN の URL を全部並べ、「--host を付けると」は出さない', () => {
        const rows = bannerRows({
            ...base,
            host: { kind: 'all' },
            urls: { local: 'http://localhost:3333/', network: ['http://192.168.1.10:3333/', 'http://10.0.0.5:3333/'] },
        });
        expect(rows.filter((r) => r.label === 'Network').map((r) => r.value)).toEqual([
            'http://192.168.1.10:3333/',
            'http://10.0.0.5:3333/',
        ]);
    });

    it('最初のビルドが失敗していても案内は出し、直すものがあることを黄色の行で知らせる', () => {
        const rows = bannerRows({ ...base, failing: true, modCount: undefined, localCount: 1 });
        expect(rows.find((r) => r.label === 'Status')).toMatchObject({ tone: 'warn' });
        expect(rows.find((r) => r.label === 'World')?.note).toBe('(手元 1)');
    });

    it('--debug のときは何が増えるかを書く', () => {
        expect(bannerRows({ ...base, debug: true }).at(-1)?.value).toContain('有効');
    });
});

describe('listenFailure', () => {
    const errno = (code: string) => Object.assign(new Error(`listen ${code}: 127.0.0.1:3333`), { code });

    it('ポートが使われていたら、別のポートか止める方法を案内し、元のエラーは原因に残す', () => {
        const view = describeError(listenFailure(errno('EADDRINUSE'), 3333, { kind: 'loopback' }));
        expect(view.message).toBe('ポート 3333 は使われています');
        expect(view.hint).toContain('--port=<n>');
        expect(view.causes).toEqual(['listen EADDRINUSE: 127.0.0.1:3333']);
    });

    it('この機械に無いアドレスを --host に渡したら、その旨を案内する', () => {
        const view = describeError(listenFailure(errno('EADDRNOTAVAIL'), 3333, { kind: 'address', host: '10.9.9.9' }));
        expect(view.message).toContain('10.9.9.9');
    });

    it('知らないエラー・エラーでない値はそのまま返す（投げない）', () => {
        const other = errno('EMFILE');
        expect(listenFailure(other, 3333, { kind: 'loopback' })).toBe(other);
        expect(listenFailure(undefined, 3333, { kind: 'loopback' })).toBeUndefined();
    });
});
