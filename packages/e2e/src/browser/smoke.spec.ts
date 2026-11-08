import { writeFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { smokeAccount } from '../account.ts';
import { type ConsoleEntry, fatalConsoleEntries, formatConsole } from './consoleRules.ts';

/**
 * ブラウザのスモーク。src/cli.ts から SMOKE_ORIGIN・SMOKE_RUN_ID・SMOKE_WORLD を渡して走らせる。
 * ログイン画面から登録・ログインし、ホームの部屋へ自動で入り、同梱 mod（pen）の Worker が動くことを確かめる。
 * SMOKE_WORLD が既定のワールドでなければ、ホームをそのワールドに変えて `/` を開き直す（ホームの変更も確かめる）。
 */
const origin = requiredEnv('SMOKE_ORIGIN');
const apiOrigin = process.env.SMOKE_API_ORIGIN ?? origin;
const runId = requiredEnv('SMOKE_RUN_ID');
const DEFAULT_WORLD = 'default';
const worldId = process.env.SMOKE_WORLD ?? DEFAULT_WORLD;

test.use({ baseURL: origin, screenshot: 'only-on-failure', trace: 'retain-on-failure' });

test('登録・ログインし、ホームに入って pen の Worker が動く', async ({ page }, testInfo) => {
    const account = smokeAccount(runId, 'w');
    const consoleEntries: ConsoleEntry[] = [];
    // Worker の console も page の console に届く
    page.on('console', (message) =>
        consoleEntries.push({ source: 'page', type: message.type(), text: message.text() }),
    );
    page.on('pageerror', (error) => consoleEntries.push({ source: 'pageerror', type: 'error', text: String(error) }));
    const created: string[] = [];

    try {
        await test.step('登録', async () => {
            await page.goto('/auth');
            await page.getByRole('button', { name: '新規登録', exact: true }).click();
            await page.getByLabel('表示名').fill(account.displayName);
            await page.getByLabel('ID', { exact: true }).fill(account.handle);
            await page.getByLabel('メールアドレス').fill(account.email);
            await page.getByLabel('パスワード', { exact: true }).fill(account.password);
            // 表示名・ID の重複の確認が終わるまで登録できない
            await expect(page.getByText('この表示名は使用できます')).toBeVisible();
            await expect(page.getByText('この ID は使用できます')).toBeVisible();
            await page.locator('form').getByRole('button', { name: '登録', exact: true }).click();
            await expect(page.getByText(/登録が完了しました/)).toBeVisible();
        });

        await test.step('ログイン', async () => {
            const submit = page.locator('form').getByRole('button', { name: 'ログイン', exact: true });
            await expect(submit).toBeVisible();
            await page.getByLabel('メールアドレス').fill(account.email);
            await page.getByLabel('パスワード', { exact: true }).fill(account.password);
            await submit.click();
        });

        await test.step('ロビーを通らず、ホームの部屋へ自動で入る', async () => {
            created.push(await enterInstance(page));
        });

        if (worldId !== DEFAULT_WORLD) {
            await test.step(`ホームを ${worldId} に変えて開き直す`, async () => {
                const response = await page.request.put(new URL('/api/v1/users/me/home', apiOrigin).toString(), {
                    headers: { origin },
                    data: { worldRef: worldId },
                });
                expect(response.ok(), `ホームを変えられません: ${response.status()}`).toBe(true);
                await page.goto('/');
                created.push(await enterInstance(page));
            });
        }

        await test.step('pen の Worker が読み込まれ、描画する', async () => {
            // WorkerModHost は mod の検証を通ったあとに描かれ、中身は Worker が送る UI で埋まる
            // 読み込めなかった mod は案内（region）に出る。出たら待たずに理由を添えて落とす
            const pen = penHost(page);
            const rejection = rejectionNotice(page);
            await expect(pen.or(rejection).first()).toBeAttached({ timeout: 30_000 });
            if ((await rejection.count()) > 0) {
                throw new Error(`mod を読み込めませんでした: ${(await rejection.innerText()).replace(/\s+/g, ' ')}`);
            }
            await expect(pen.locator('*').first()).toBeAttached({ timeout: 20_000 });
            expect(page.workers().length, 'sandbox の Worker が起動していません').toBeGreaterThan(0);
            await expect
                .poll(() => consoleEntries.some((entry) => entry.text.includes('[Sandbox:pen:pen] 初期化完了')), {
                    message: 'pen の Worker が初期化を終えていません',
                    timeout: 15_000,
                })
                .toBe(true);
        });

        await test.step('署名・Worker のエラーがコンソールに出ていない', async () => {
            // 起動直後の非同期のエラーも拾うため、少し待ってから見る
            await page.waitForTimeout(2_000);
            const fatal = fatalConsoleEntries(consoleEntries);
            expect(fatal, formatConsole(fatal)).toEqual([]);
        });
    } finally {
        await writeFile(testInfo.outputPath('console.log'), `${formatConsole(consoleEntries)}\n`);
        for (const id of created) {
            const response = await page.request.delete(
                new URL(`/api/v1/instances/${encodeURIComponent(id)}`, apiOrigin).toString(),
                {
                    headers: { origin },
                },
            );
            if (!response.ok()) console.warn(`インスタンス ${id} を消せませんでした: ${response.status()}`);
        }
    }
});

function penHost(page: Page) {
    return page.locator('[data-entity-type="pen:pen"]').first();
}

function rejectionNotice(page: Page) {
    return page.getByRole('region', { name: 'mod の読み込み状況' });
}

/** ホームの部屋の URL になるまで待ち、その ID を返す。プレビューの同梱ワールドは署名が無く、入室の前に確認を求められる。 */
async function enterInstance(page: Page): Promise<string> {
    await page.waitForURL(/\/instance\/[^/]+$/, { timeout: 30_000 });
    const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '');
    const unsigned = page.getByText('作者を確認できないワールドです');
    await expect(penHost(page).or(rejectionNotice(page)).or(unsigned).first()).toBeAttached({ timeout: 30_000 });
    if (await unsigned.isVisible()) await page.getByRole('button', { name: '確認', exact: true }).click();
    return id;
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} がありません。src/cli.ts から走らせてください`);
    return value;
}
