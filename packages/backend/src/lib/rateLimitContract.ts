import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { expect, it } from 'vitest';

/** 同じ数え方を共有する 2 つの backend の limiter の設定（メモリなら同じ store は共有できないので 1 つのプロセスとして扱う）。 */
export interface LimiterUnderTest {
    /** 名前ごとに limiter の追加設定（store など）を返す。replica は backend の番号。 */
    options: (name: string, replica: number) => Partial<Options>;
    /** 複数の backend で数えた数が合算されるか（共有の store）。 */
    shared: boolean;
}

/** limiter を付けた小さな backend を立て、GET の状態コードを返す関数を作る。 */
export async function serveLimited(
    limiterOptions: Partial<Options>,
    limit: number,
): Promise<{ hit: () => Promise<number>; close: () => Promise<void> }> {
    const app = express();
    app.use(rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false, ...limiterOptions }));
    app.get('/', (_req, res) => {
        res.send('ok');
    });
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    return {
        hit: async () => (await fetch(url)).status,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

/** メモリの store と Redis の store に当てるテスト群。describe の中で呼ぶ。create はテストごとに独立した名前空間を返すこと。 */
export function rateLimitContract(create: () => LimiterUnderTest): void {
    it('上限までは通し、超えたら 429', async () => {
        const subject = create();
        const backend = await serveLimited(subject.options('global', 0), 3);
        try {
            const statuses = [];
            for (const _ of [1, 2, 3, 4]) statuses.push(await backend.hit());
            expect(statuses).toEqual([200, 200, 200, 429]);
        } finally {
            await backend.close();
        }
    });

    it('limiter ごとに数は別（全体の limiter とルートの limiter が同じ IP を足し合わない）', async () => {
        const subject = create();
        const first = await serveLimited(subject.options('global', 0), 2);
        const second = await serveLimited(subject.options('instances-create', 0), 2);
        try {
            expect([await first.hit(), await first.hit(), await first.hit()]).toEqual([200, 200, 429]);
            expect(await second.hit()).toBe(200);
        } finally {
            await first.close();
            await second.close();
        }
    });

    it('2 つの backend の数え方（共有なら合算、メモリなら別々）', async () => {
        const subject = create();
        const a = await serveLimited(subject.options('global', 0), 2);
        const b = await serveLimited(subject.options('global', 1), 2);
        try {
            expect([await a.hit(), await b.hit()]).toEqual([200, 200]);
            expect(await a.hit()).toBe(subject.shared ? 429 : 200);
            expect(await b.hit()).toBe(subject.shared ? 429 : 200);
        } finally {
            await a.close();
            await b.close();
        }
    });
}
