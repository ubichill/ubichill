// chart を実際に描画し、backend と instance に渡る Redis の env を確かめる（helm lint では中身までは見ない）。
// 使い方: node scripts/check-chart.mjs（helm が PATH にあり、charts/ubichill/charts に依存の tgz があること）
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const chart = fileURLToPath(new URL('../charts/ubichill', import.meta.url));
const base = [
    '--set', 'global.domain=example.test',
    '--set', 'backend.secretEnv.BETTER_AUTH_SECRET=test-better-auth-secret-at-least-32-characters',
    '--set', 'postgresql.auth.password=test-app-password',
    '--set', 'postgresql.auth.postgresPassword=test-postgres-password',
];

const render = (release, args) =>
    execFileSync('helm', ['template', release, chart, ...base, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const containerEnv = (manifests, deploymentSuffix, container) => {
    const docs = parseAllDocuments(manifests).map((d) => d.toJS()).filter(Boolean);
    const deployment = docs.find((d) => d.kind === 'Deployment' && d.metadata.name.endsWith(deploymentSuffix));
    if (!deployment) throw new Error(`Deployment *${deploymentSuffix} が描画されていない`);
    const found = deployment.spec.template.spec.containers.find((c) => c.name === container);
    if (!found) throw new Error(`container ${container} が無い`);
    return Object.fromEntries((found.env ?? []).map((e) => [e.name, e.value ?? e.valueFrom]));
};

const secretRef = (name, key) => ({ secretKeyRef: { name, key } });

const cases = [
    {
        name: 'subchart・認証あり（既定）',
        release: 'ubichill',
        args: ['--set', 'redis.auth.password=test-redis-password'],
        expect: { REDIS_URL: 'redis://ubichill-redis-master:6379', REDIS_PASSWORD: secretRef('ubichill-redis', 'redis-password') },
    },
    {
        name: 'subchart・認証なし',
        release: 'ubichill',
        args: ['--set', 'redis.auth.enabled=false'],
        expect: { REDIS_URL: 'redis://ubichill-redis-master:6379', REDIS_PASSWORD: undefined },
    },
    {
        name: 'subchart・auth.existingSecret',
        release: 'ubichill',
        args: ['--set', 'redis.auth.existingSecret=ubichill-secrets', '--set', 'redis.auth.existingSecretPasswordKey=REDIS_PASSWORD'],
        expect: { REDIS_URL: 'redis://ubichill-redis-master:6379', REDIS_PASSWORD: secretRef('ubichill-secrets', 'REDIS_PASSWORD') },
    },
    {
        name: 'リリース名に ubichill が入らない',
        release: 'foo',
        args: ['--set', 'redis.auth.password=test-redis-password'],
        expect: { REDIS_URL: 'redis://foo-redis-master:6379', REDIS_PASSWORD: secretRef('foo-redis', 'redis-password') },
    },
    {
        name: 'Redis なし',
        release: 'ubichill',
        args: ['--set', 'redis.enabled=false'],
        expect: { REDIS_URL: undefined, REDIS_PASSWORD: undefined },
    },
    {
        name: '外部の Redis・パスワードあり',
        release: 'ubichill',
        args: ['--set', 'redis.enabled=false', '--set', 'redis.external.url=redis://redis.shared:6379', '--set', 'redis.external.existingSecret=redis-credentials'],
        expect: { REDIS_URL: 'redis://redis.shared:6379', REDIS_PASSWORD: secretRef('redis-credentials', 'redis-password') },
    },
    {
        name: '外部の Redis・パスワードなし',
        release: 'ubichill',
        args: ['--set', 'redis.enabled=false', '--set', 'redis.external.url=redis://redis.shared:6379'],
        expect: { REDIS_URL: 'redis://redis.shared:6379', REDIS_PASSWORD: undefined },
    },
];

const failures = [];
for (const c of cases) {
    const manifests = render(c.release, c.args);
    for (const [suffix, container] of [['-backend', 'backend'], ['-instance', 'instance']]) {
        const env = containerEnv(manifests, suffix, container);
        for (const [key, want] of Object.entries(c.expect)) {
            if (JSON.stringify(env[key]) !== JSON.stringify(want)) {
                failures.push(`${c.name} / ${container}: ${key} = ${JSON.stringify(env[key])}（期待 ${JSON.stringify(want)}）`);
            }
        }
    }
}

// instance のノード ID とアドレスは Downward API から渡す（Directory の heartbeat・owner の割り当て）
const downward = containerEnv(render('ubichill', ['--set', 'redis.auth.password=test-redis-password']), '-instance', 'instance');
for (const [key, fieldPath] of [['POD_NAME', 'metadata.name'], ['POD_IP', 'status.podIP']]) {
    if (JSON.stringify(downward[key]) !== JSON.stringify({ fieldRef: { fieldPath } })) {
        failures.push(`instance: ${key} = ${JSON.stringify(downward[key])}（期待 fieldRef ${fieldPath}）`);
    }
}

// 部屋の割り当て（Directory）は既定でメモリ。redis は明示したときだけ
const directoryOf = (args) => containerEnv(render('ubichill', ['--set', 'redis.auth.password=x', ...args]), '-instance', 'instance').INSTANCE_DIRECTORY;
if (directoryOf([]) !== 'memory') failures.push(`INSTANCE_DIRECTORY の既定が memory でない: ${directoryOf([])}`);
if (directoryOf(['--set', 'instanceRuntime.directory=redis']) !== 'redis') failures.push('instanceRuntime.directory=redis が渡らない');

const renderFails = (args, message) => {
    try {
        render('ubichill', args);
        return false;
    } catch (error) {
        // ほかの理由で描画が失敗しても「拒否した」と数えない
        return String(error.stderr).includes(message);
    }
};
if (!renderFails(['--set', 'redis.enabled=false', '--set', 'instanceRuntime.directory=redis'], 'Redis（redis.enabled か redis.external.url）が要ります')) {
    failures.push('Redis なしで instanceRuntime.directory=redis を指定しても描画が通ってしまう');
}
if (!renderFails(['--set', 'redis.auth.password=x', '--set', 'instanceRuntime.directory=Redis'], 'memory か redis です')) {
    failures.push('instanceRuntime.directory の不正な値が描画を通ってしまう');
}

const rejected = (() => {
    try {
        render('ubichill', ['--set', 'redis.external.url=redis://redis.shared:6379', '--set', 'redis.auth.password=x']);
        return false;
    } catch (error) {
        // ほかの理由で描画が失敗しても「拒否した」と数えない
        return String(error.stderr).includes('同時に指定できません');
    }
})();
if (!rejected) failures.push('subchart と redis.external.url を同時に指定しても描画が通ってしまう');

// backend の台数: 既定は 1。2 以上は Redis があるときだけ描画できる
const backendReplicas = (manifests) => {
    const docs = parseAllDocuments(manifests).map((d) => d.toJS()).filter(Boolean);
    return docs.find((d) => d.kind === 'Deployment' && d.metadata.name.endsWith('-backend'))?.spec.replicas;
};
const replicaCases = [
    { name: '既定', args: ['--set', 'redis.auth.password=x'], want: 1 },
    { name: 'subchart の Redis で 2 台', args: ['--set', 'redis.auth.password=x', '--set', 'backend.replicaCount=2'], want: 2 },
    {
        name: '外部の Redis で 2 台',
        args: ['--set', 'redis.enabled=false', '--set', 'redis.external.url=redis://redis.shared:6379', '--set', 'backend.replicaCount=2'],
        want: 2,
    },
    { name: 'Redis なしで 1 台', args: ['--set', 'redis.enabled=false'], want: 1 },
];
for (const c of replicaCases) {
    const got = backendReplicas(render('ubichill', c.args));
    if (got !== c.want) failures.push(`backend の台数（${c.name}）: ${got}（期待 ${c.want}）`);
}
const rejectedReplicas = (() => {
    try {
        render('ubichill', ['--set', 'redis.enabled=false', '--set', 'backend.replicaCount=2']);
        return false;
    } catch (error) {
        return String(error.stderr).includes('Redis（redis.enabled または redis.external.url）が要ります');
    }
})();
if (!rejectedReplicas) failures.push('Redis なしで backend.replicaCount=2 を指定しても描画が通ってしまう');

if (failures.length > 0) {
    console.error(`❌ chart の Redis の env・backend の台数:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
}
console.log(
    `✅ chart の Redis の env: ${cases.length} 通り + instance の Downward API・Directory の選択 + 不正な指定の拒否、backend の台数: ${replicaCases.length} 通り + Redis なしの複数台の拒否`,
);
