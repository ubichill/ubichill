// 負荷試験の chart（charts/ubichill-loadtest）を描画し、本番を向いた値で落ちること・対象の URL が正しいことを確かめる。
// 使い方: node scripts/check-loadtest-chart.mjs（helm が PATH にあること）
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const chart = fileURLToPath(new URL('../charts/ubichill-loadtest', import.meta.url));

const render = (args, namespace = 'ubichill-dev') =>
    execFileSync('helm', ['template', 'lt', chart, '-n', namespace, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

const docsOf = (manifests) =>
    parseAllDocuments(manifests)
        .map((d) => d.toJS())
        .filter(Boolean);

const envOf = (testRun) => Object.fromEntries(testRun.spec.runner.env.map((e) => [e.name, e.value]));

const failures = [];
const expect = (ok, message) => {
    if (!ok) failures.push(message);
};

const rejected = [
    ['testid が無い', [], 'ubichill-dev'],
    ['本番の namespace', ['--set', 'testid=x'], 'ubichill'],
    ['本番の release', ['--set', 'testid=x', '--set', 'target.release=ubichill'], 'ubichill-dev'],
    ['本番のホスト', ['--set', 'testid=x', '--set', 'target.origin=https://ubichill.com'], 'ubichill-dev'],
    ['本番のホスト（www）', ['--set', 'testid=x', '--set', 'target.origin=https://www.ubichill.com/'], 'ubichill-dev'],
    [
        '本番の backend の Service',
        ['--set', 'testid=x', '--set', 'target.backendUrl=http://ubichill-backend.ubichill.svc:3001'],
        'ubichill-dev',
    ],
    ['本番の Go の Service', ['--set', 'testid=x', '--set', 'target.instanceUrl=http://ubichill-instance:3002'], 'ubichill-dev'],
    ['部屋が runner で割り切れない', ['--set', 'testid=x', '--set', 'scenario.rooms=5', '--set', 'parallelism=2'], 'ubichill-dev'],
    ['via の誤り', ['--set', 'testid=x', '--set', 'target.via=direct'], 'ubichill-dev'],
    ['空白を含む testid', ['--set', 'testid=a b'], 'ubichill-dev'],
];
for (const [name, args, namespace] of rejected) {
    const passed = (() => {
        try {
            render(args, namespace);
            return true;
        } catch {
            return false;
        }
    })();
    expect(!passed, `${name}: 描画が通ってしまった`);
}

const cluster = docsOf(render(['--set', 'testid=smoke-1', '--set', 'browser.enabled=true']));
const users = cluster.find((d) => d.kind === 'TestRun' && !d.metadata.name.endsWith('-browser'));
const browser = cluster.find((d) => d.kind === 'TestRun' && d.metadata.name.endsWith('-browser'));
const configMap = cluster.find((d) => d.kind === 'ConfigMap');
expect(users && browser && configMap, 'TestRun 2 つと ConfigMap が描画されていない');
if (users && browser && configMap) {
    const env = envOf(users);
    expect(env.LT_API_BASE === 'http://ubichill-dev-backend:3001', `cluster の LT_API_BASE: ${env.LT_API_BASE}`);
    expect(env.LT_WS_BASE === 'http://ubichill-dev-instance:3002', `cluster の LT_WS_BASE: ${env.LT_WS_BASE}`);
    expect(env.LT_TESTID === 'smoke-1', 'LT_TESTID が testid と違う');
    expect(env.K6_PROMETHEUS_RW_TREND_STATS === 'p(50),p(95),p(99),max', 'K6_PROMETHEUS_RW_TREND_STATS');
    // k6-operator の --tag が script の options.tags を置き換えるので、testid は CLI でも付ける
    expect(users.spec.args.join(' ') === '--tag testid=smoke-1 --out experimental-prometheus-rw', `args: ${users.spec.args}`);
    expect(browser.spec.args.join(' ') === '--tag testid=smoke-1 --out experimental-prometheus-rw', `browser の args: ${browser.spec.args}`);
    expect(users.spec.script.configMap.file === 'main.ts', 'script の file');
    expect(users.spec.runner.nodeSelector['ubichill.com/loadgen'] === 'true', 'nodeSelector の値が文字列の "true" でない');
    expect(envOf(browser).LT_SCENARIO === 'browser', 'browser の LT_SCENARIO');
    expect(browser.spec.runner.image.endsWith('-with-browser'), 'browser の image');
    expect(browser.spec.parallelism === 1, 'browser の parallelism');
    const files = Object.keys(configMap.data).sort();
    expect(files.includes('main.ts'), 'ConfigMap に main.ts が無い');
    expect(!files.some((f) => f.endsWith('.test.ts') || !f.endsWith('.ts')), `ConfigMap に余計なファイル: ${files}`);
}

const viaPublic = docsOf(render(['--set', 'testid=x', '--set', 'target.via=public']));
const publicEnv = envOf(viaPublic.find((d) => d.kind === 'TestRun'));
expect(publicEnv.LT_API_BASE === 'https://dev.ubichill.com', `public の LT_API_BASE: ${publicEnv.LT_API_BASE}`);
expect(publicEnv.LT_WS_BASE === '', `public の LT_WS_BASE: ${publicEnv.LT_WS_BASE}`);

if (failures.length > 0) {
    console.error(`負荷試験の chart の検査に失敗:\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('負荷試験の chart の検査: ok');
