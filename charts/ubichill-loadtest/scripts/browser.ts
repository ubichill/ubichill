// 画面の体験の確認（Chromium）。負荷の最中に 1〜2 人が実際の画面で「ログイン → ロビー → インスタンスを作って入る → 描画」を通す。
// 手順とセレクタは packages/e2e/src/browser/smoke.spec.ts と同じ（画面を変えたら両方を直す）。
import { sleep } from 'k6';
import { browser, type Locator, type Page } from 'k6/browser';
import { vu } from 'k6/execution';
import { setTimeout } from 'k6/timers';
import { type ApiTarget, deleteInstance, ensureSession } from './api.ts';
import type { LoadTestConfig } from './config.ts';
import { browserFailures, browserJourney, browserStep, instanceOps } from './metrics.ts';
import { loadtestAccount } from './plan.ts';
import { instanceIdFromUrl } from './protocol.ts';

export interface BrowserSetup {
    readonly worldDisplayName: string;
}

const STEP_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

type Step = 'account' | 'login' | 'lobby' | 'enter' | 'render';

export async function runBrowserJourney(config: LoadTestConfig, setup: BrowserSetup): Promise<void> {
    const target: ApiTarget = { origin: config.origin, apiBase: config.apiBase };
    const account = loadtestAccount('web', config.accountOffset + vu.idInInstance, config.accountPassword);
    const progress: { step: Step; instanceId: string | null } = { step: 'account', instanceId: null };
    // 画面の操作の前に API でアカウントを用意する（初回だけ登録）。この Cookie は後片付けにだけ使う
    const session = ensureSession(target, account);
    if (!session.ok) {
        browserFailures.add(1, { step: 'account' });
        console.error(`アカウントを用意できません（${account.handle}）: ${session.reason}`);
        sleep(config.browserPauseSeconds);
        return;
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    const timed = async <T>(step: Step, run: () => Promise<T>): Promise<T> => {
        progress.step = step;
        const startedAt = Date.now();
        const value = await run();
        browserStep.add(Date.now() - startedAt, { step });
        return value;
    };
    const journeyStartedAt = Date.now();
    try {
        await timed('login', () => logIn(page, config.origin, account));
        const card = await timed('lobby', () => openLobby(page, setup.worldDisplayName));
        progress.instanceId = await timed('enter', () => enterNewInstance(page, card));
        await timed('render', () => waitForRender(page));
        browserJourney.add(Date.now() - journeyStartedAt);
    } catch (error) {
        browserFailures.add(1, { step: progress.step });
        console.error(`画面の体験の確認が ${progress.step} で失敗: ${String(error)}（${page.url()}）`);
    } finally {
        await page.close();
        await context.close();
        if (progress.instanceId !== null) {
            instanceOps.add(1, { op: 'delete', result: deleteInstance(target, session.cookie, progress.instanceId) });
        }
    }
    sleep(config.browserPauseSeconds);
}

async function logIn(
    page: Page,
    origin: string,
    account: { readonly email: string; readonly password: string },
): Promise<void> {
    await page.goto(`${origin}/auth`);
    const submit = page.locator('form').getByRole('button', { name: 'ログイン', exact: true });
    await submit.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await page.getByLabel('メールアドレス').fill(account.email);
    await page.getByLabel('パスワード').fill(account.password);
    await submit.click();
    await page.waitForURL(`${origin}/`, { timeout: STEP_TIMEOUT_MS });
}

/** ロビーのワールドの一覧に、対象のワールドのカードが出るまで。カードは表示名の見出しで見分ける。 */
async function openLobby(page: Page, worldDisplayName: string): Promise<Locator> {
    await page.getByRole('button', { name: 'ワールド', exact: true }).click();
    const card = page.getByRole('heading', { name: worldDisplayName, exact: true });
    await card.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    return card;
}

async function enterNewInstance(page: Page, card: Locator): Promise<string> {
    await card.click();
    await page.getByRole('button', { name: '新しくインスタンス作成' }).click();
    await page.waitForURL(/\/instance\/[^/]+$/, { timeout: STEP_TIMEOUT_MS });
    const id = instanceIdFromUrl(page.url());
    if (id === null) throw new Error(`インスタンスの URL ではありません: ${page.url()}`);
    return id;
}

/** 同梱 mod（pen）の Worker が UI を描くまで。署名の無いワールド（dev）は入室の前に確認を求められる。 */
async function waitForRender(page: Page): Promise<void> {
    const pen = page.locator('[data-entity-type="pen:pen"]').first();
    const unsigned = page.getByText('作者を確認できないワールドです');
    const rejection = page.getByRole('region', { name: 'mod の読み込み状況' });
    const penAttached = async () => (await pen.count()) > 0;
    const rejected = () => rejection.isVisible();
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    const first = await firstOf(
        { pen: penAttached, unsigned: () => unsigned.isVisible(), rejection: rejected },
        deadline,
    );
    if (first === 'unsigned') await page.getByRole('button', { name: '確認', exact: true }).click();
    const settled = first === 'pen' ? first : await firstOf({ pen: penAttached, rejection: rejected }, deadline);
    if (settled === 'rejection') {
        throw new Error(`mod を読み込めませんでした: ${(await rejection.innerText()).replace(/\s+/g, ' ')}`);
    }
    await pen
        .locator('*')
        .first()
        .waitFor({ state: 'attached', timeout: Math.max(1, deadline - Date.now()) });
}

/** どれかが成り立つまで待ち、成り立ったものの名前を返す（k6 の Locator には or が無い）。 */
async function firstOf<K extends string>(
    candidates: Readonly<Record<K, () => Promise<boolean>>>,
    deadline: number,
): Promise<K> {
    const names = Object.keys(candidates) as K[];
    const visible = await Promise.all(names.map((name) => candidates[name]()));
    const found = names.find((_, i) => visible[i]);
    if (found !== undefined) return found;
    if (Date.now() >= deadline)
        throw new Error(`${names.join(' / ')} のどれも ${STEP_TIMEOUT_MS}ms 以内に出ませんでした`);
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
    return firstOf(candidates, deadline);
}
