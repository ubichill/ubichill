// chart を実際に描画し、backend と instance に渡る Redis の env を確かめる（helm lint では中身までは見ない）。
// 同梱の Redis（Valkey）の StatefulSet・Service・Secret・exporter も描画結果で確かめる。
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
        name: '同梱・認証あり（既定）',
        release: 'ubichill',
        args: ['--set', 'redis.auth.password=test-redis-password'],
        expect: { REDIS_URL: 'redis://ubichill-redis-master:6379', REDIS_PASSWORD: secretRef('ubichill-redis', 'redis-password') },
    },
    {
        name: '同梱・認証なし',
        release: 'ubichill',
        args: ['--set', 'redis.auth.enabled=false'],
        expect: { REDIS_URL: 'redis://ubichill-redis-master:6379', REDIS_PASSWORD: undefined },
    },
    {
        name: '同梱・auth.existingSecret',
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

// backend も同じ Directory の値を受け取る（redis なら owner の Pod へ管理 API を送り、在席を Redis から読む）
const backendDirectoryOf = (args) => {
    const docs = parseAllDocuments(render('ubichill', ['--set', 'redis.auth.password=x', ...args])).map((d) => d.toJS()).filter(Boolean);
    return docs.find((d) => d.kind === 'ConfigMap' && d.metadata.name.endsWith('-backend-config'))?.data?.INSTANCE_DIRECTORY;
};
if (backendDirectoryOf([]) !== 'memory') failures.push(`backend の INSTANCE_DIRECTORY の既定が memory でない: ${backendDirectoryOf([])}`);
if (backendDirectoryOf(['--set', 'instanceRuntime.directory=redis']) !== 'redis') failures.push('instanceRuntime.directory=redis が backend に渡らない');

// Go の Pod の数。2 以上は Directory を Redis で共有するときだけ
const instanceReplicasOf = (args) => {
    const docs = parseAllDocuments(render('ubichill', ['--set', 'redis.auth.password=x', ...args])).map((d) => d.toJS()).filter(Boolean);
    return docs.find((d) => d.kind === 'Deployment' && d.metadata.name.endsWith('-instance'))?.spec?.replicas;
};
if (instanceReplicasOf([]) !== 1) failures.push(`instance の replicas の既定が 1 でない: ${instanceReplicasOf([])}`);
if (instanceReplicasOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.replicas=3']) !== 3) {
    failures.push('instanceRuntime.replicas=3（redis）が Deployment に渡らない');
}

// 更新方式・drain・readiness。memory は新旧の Pod が並ぶと owner が 2 つになるので Recreate のまま、
// redis は新しい Pod が ready になってから古い Pod を draining で止める
const instanceDeploymentOf = (args) => {
    const docs = parseAllDocuments(render('ubichill', ['--set', 'redis.auth.password=x', ...args])).map((d) => d.toJS()).filter(Boolean);
    const deployment = docs.find((d) => d.kind === 'Deployment' && d.metadata.name.endsWith('-instance'));
    const container = deployment.spec.template.spec.containers.find((c) => c.name === 'instance');
    const arg = (name) => container.args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
    return {
        strategy: deployment.spec.strategy,
        grace: deployment.spec.template.spec.terminationGracePeriodSeconds,
        readiness: container.readinessProbe?.httpGet?.path,
        liveness: container.livenessProbe?.httpGet?.path,
        drainTimeout: arg('drain-timeout'),
        migrateAfter: arg('migrate-after'),
        disconnectNotice: arg('disconnect-notice'),
        deletionCost: arg('pod-deletion-cost'),
        maxRooms: arg('max-rooms'),
        maxConnections: arg('max-connections'),
        serviceAccount: deployment.spec.template.spec.serviceAccountName,
    };
};
const memoryDeployment = instanceDeploymentOf([]);
const redisDeployment = instanceDeploymentOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.replicas=2', '--set', 'instanceRuntime.maxRooms=200']);
const expectDeployment = (label, got, want) => {
    for (const [key, value] of Object.entries(want)) {
        if (JSON.stringify(got[key]) !== JSON.stringify(value)) {
            failures.push(`instance（${label}）の ${key} = ${JSON.stringify(got[key])}（期待 ${JSON.stringify(value)}）`);
        }
    }
};
expectDeployment('memory', memoryDeployment, {
    strategy: { type: 'Recreate' },
    grace: 30,
    readiness: '/ready',
    liveness: '/health',
    drainTimeout: '0s',
    migrateAfter: '3h',
    disconnectNotice: '10m',
    deletionCost: undefined,
    maxRooms: '1000',
    maxConnections: '0',
    serviceAccount: undefined,
});
expectDeployment('redis', redisDeployment, {
    strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
    // terminationGracePeriodSeconds は drainTimeout（24h）+ 30 秒
    grace: 86430,
    readiness: '/ready',
    liveness: '/health',
    drainTimeout: '24h',
    maxRooms: '200',
});
expectDeployment(
    'redis・drainTimeout 1h30m15s',
    instanceDeploymentOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.drainTimeout=1h30m15s', '--set', 'instanceRuntime.migrateAfter=2h']),
    { grace: 5445, drainTimeout: '1h30m15s', migrateAfter: '2h' },
);
expectDeployment(
    'redis・maxConnections 500',
    instanceDeploymentOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.maxConnections=500']),
    { maxConnections: '500' },
);
expectDeployment(
    'redis・terminationGracePeriodSeconds を明示',
    instanceDeploymentOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.terminationGracePeriodSeconds=600']),
    { grace: 600 },
);

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
if (!renderFails(['--set', 'redis.auth.password=x', '--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.drainTimeout=1d'], 'h・m・s の組み合わせ')) {
    failures.push('drainTimeout の秒に直せない値（1d）が描画を通ってしまう');
}
if (!renderFails(['--set', 'redis.auth.password=x', '--set', 'instanceRuntime.maxConnections=-1'], 'maxConnections は 0（無制限）以上')) {
    failures.push('instanceRuntime.maxConnections が負でも描画が通ってしまう');
}
if (!renderFails(['--set', 'redis.auth.password=x', '--set', 'instanceRuntime.replicas=2'], 'Pod の間で部屋を共有できません')) {
    failures.push('directory: memory で instanceRuntime.replicas=2 にしても描画が通ってしまう');
}

// 指標の収集（ServiceMonitor）と KEDA の scale-out は既定で無効（CRD が無いクラスタでも描画・適用が落ちない）
const docsOf = (args) => parseAllDocuments(render('ubichill', ['--set', 'redis.auth.password=x', ...args])).map((d) => d.toJS()).filter(Boolean);
const instanceOf = (docs, kind) => docs.find((d) => d.kind === kind && d.metadata.name.endsWith('-instance'));
const defaultDocs = docsOf([]);
if (instanceOf(defaultDocs, 'ScaledObject') || instanceOf(defaultDocs, 'ServiceMonitor')) {
    failures.push('既定で ScaledObject か ServiceMonitor が描画される');
}
if (instanceOf(defaultDocs, 'Deployment')?.spec?.replicas !== 1) failures.push('自動スケールが無効のとき Deployment に replicas が無い');
const autoscaled = docsOf([
    '--set', 'instanceRuntime.directory=redis',
    '--set', 'instanceRuntime.autoscaling.enabled=true',
    '--set', 'instanceRuntime.autoscaling.maxReplicaCount=7',
    '--set', 'instanceRuntime.autoscaling.targetConnectionsPerPod=250',
    '--set', 'instanceRuntime.metrics.serviceMonitor.enabled=true',
    '--set', 'instanceRuntime.metrics.serviceMonitor.labels.release=prometheus',
]);
const scaled = instanceOf(autoscaled, 'ScaledObject');
if (!scaled) {
    failures.push('autoscaling.enabled で ScaledObject が描画されない');
} else {
    const triggers = Object.fromEntries(scaled.spec.triggers.map((t) => [t.name, t]));
    const want = {
        target: scaled.spec.scaleTargetRef.name === 'ubichill-instance',
        min: scaled.spec.minReplicaCount === 1,
        max: scaled.spec.maxReplicaCount === 7,
        // 縮めるのはゆっくり（既定: 15 分の安定化、10 分に 1 Pod）
        scaleIn:
            JSON.stringify(scaled.spec.advanced?.horizontalPodAutoscalerConfig?.behavior?.scaleDown) ===
            JSON.stringify({ stabilizationWindowSeconds: 900, policies: [{ type: 'Pods', value: 1, periodSeconds: 600 }] }),
        // 接続数・部屋数は draining の Pod を除く（止めている Pod の接続で、縮めた直後に増やし直さない）
        connections:
            triggers.connections?.metricType === 'AverageValue' &&
            triggers.connections.metadata.threshold === '250' &&
            triggers.connections.metadata.query ===
                'sum(ubichill_instance_websocket_connections{namespace="default",service="ubichill-instance"} unless on(pod) (ubichill_instance_draining{namespace="default",service="ubichill-instance"} == 1))',
        rooms:
            triggers.rooms?.metricType === 'AverageValue' &&
            triggers.rooms.metadata.threshold === '800' &&
            triggers.rooms.metadata.query ===
                'sum(ubichill_instance_active_rooms{namespace="default",service="ubichill-instance"} unless on(pod) (ubichill_instance_draining{namespace="default",service="ubichill-instance"} == 1))',
        cpu: triggers.cpu?.type === 'cpu' && triggers.cpu.metricType === 'AverageValue' && triggers.cpu.metadata.value === '600m',
        // 指標が無いときに 0 として扱わない
        nullIsError: scaled.spec.triggers.filter((t) => t.type === 'prometheus').every((t) => t.metadata.ignoreNullValues === 'false'),
    };
    for (const [key, ok] of Object.entries(want)) if (!ok) failures.push(`ScaledObject の ${key} が期待と違う: ${JSON.stringify(scaled.spec)}`);
}
const noScaleIn = instanceOf(
    docsOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.autoscaling.enabled=true', '--set', 'instanceRuntime.autoscaling.scaleDown.enabled=false']),
    'ScaledObject',
);
if (noScaleIn?.spec?.advanced?.horizontalPodAutoscalerConfig?.behavior?.scaleDown?.selectPolicy !== 'Disabled') {
    failures.push('autoscaling.scaleDown.enabled=false でも scale-in が無効にならない');
}
// 自動で縮めるときだけ、Go が自分の Pod に pod-deletion-cost を書く権限（ServiceAccount・Role・RoleBinding）と Downward API を付ける
{
    const deployment = instanceOf(autoscaled, 'Deployment');
    const container = deployment?.spec?.template?.spec?.containers?.find((c) => c.name === 'instance');
    const env = Object.fromEntries((container?.env ?? []).map((e) => [e.name, e.value ?? e.valueFrom]));
    const sa = autoscaled.find((d) => d.kind === 'ServiceAccount' && d.metadata.name === 'ubichill-instance');
    const role = autoscaled.find((d) => d.kind === 'Role' && d.metadata.name === 'ubichill-instance-deletion-cost');
    const binding = autoscaled.find((d) => d.kind === 'RoleBinding' && d.metadata.name === 'ubichill-instance-deletion-cost');
    const want = {
        serviceAccount: deployment?.spec?.template?.spec?.serviceAccountName === 'ubichill-instance' && sa?.automountServiceAccountToken === true,
        role: JSON.stringify(role?.rules) === JSON.stringify([{ apiGroups: [''], resources: ['pods'], verbs: ['patch'] }]),
        binding:
            binding?.roleRef?.kind === 'Role' &&
            binding.roleRef.name === role?.metadata?.name &&
            binding.subjects?.[0]?.kind === 'ServiceAccount' &&
            binding.subjects[0].name === 'ubichill-instance' &&
            binding.subjects[0].namespace === 'default',
        namespaceEnv: JSON.stringify(env.POD_NAMESPACE) === JSON.stringify({ fieldRef: { fieldPath: 'metadata.namespace' } }),
        podNameEnv: JSON.stringify(env.POD_NAME) === JSON.stringify({ fieldRef: { fieldPath: 'metadata.name' } }),
        flag: container?.args?.includes('--pod-deletion-cost=true'),
    };
    for (const [key, ok] of Object.entries(want)) if (!ok) failures.push(`pod-deletion-cost の ${key} が期待と違う`);
    const plain = docsOf(['--set', 'instanceRuntime.directory=redis']);
    const plainContainer = instanceOf(plain, 'Deployment')?.spec?.template?.spec?.containers?.find((c) => c.name === 'instance');
    if (
        plain.some((d) => (d.kind === 'Role' || d.kind === 'RoleBinding') && d.metadata.name.includes('instance')) ||
        plain.some((d) => d.kind === 'ServiceAccount' && d.metadata.name === 'ubichill-instance') ||
        instanceOf(plain, 'Deployment')?.spec?.template?.spec?.serviceAccountName !== undefined ||
        plainContainer?.args?.some((a) => a.startsWith('--pod-deletion-cost')) ||
        plainContainer?.env?.some((e) => e.name === 'POD_NAMESPACE')
    ) {
        failures.push('自動スケールが無効でも pod-deletion-cost の権限・設定が描画される');
    }
}
// HPA が台数を持つので Deployment には replicas を書かない（同期のたびに戻さない）
if (instanceOf(autoscaled, 'Deployment')?.spec?.replicas !== undefined) failures.push('autoscaling.enabled でも Deployment に replicas が書かれる');
// Go の権限: Role は pods の patch だけ（上の role の検査）。ValidatingAdmissionPolicy が instance の Pod の pod-deletion-cost の注釈だけに絞る
const policy = autoscaled.find((d) => d.kind === 'ValidatingAdmissionPolicy');
const binding = autoscaled.find((d) => d.kind === 'ValidatingAdmissionPolicyBinding');
if (!policy || !binding) {
    failures.push('autoscaling.enabled で ValidatingAdmissionPolicy とその Binding が描画されない');
} else {
    const want = {
        namespacedName: policy.metadata.name === 'default-ubichill-instance-deletion-cost' && binding.spec.policyName === policy.metadata.name,
        serviceAccount: policy.spec.matchConditions?.[0]?.expression === 'request.userInfo.username == "system:serviceaccount:default:ubichill-instance"',
        onlyPods: policy.spec.matchConstraints.resourceRules.every((r) => JSON.stringify(r.resources) === '["pods"]' && JSON.stringify(r.operations) === '["UPDATE"]'),
        annotationOnly: policy.spec.validations.some((v) => v.expression.includes('variables.cost')),
        specFrozen: policy.spec.validations.some((v) => v.expression === 'object.spec == oldObject.spec'),
        deny: JSON.stringify(binding.spec.validationActions) === '["Deny"]',
        thisNamespace: binding.spec.matchResources.namespaceSelector.matchLabels['kubernetes.io/metadata.name'] === 'default',
        fail: policy.spec.failurePolicy === 'Fail',
    };
    for (const [key, ok] of Object.entries(want)) if (!ok) failures.push(`ValidatingAdmissionPolicy の ${key} が期待と違う`);
}
if (docsOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.autoscaling.enabled=true', '--set', 'instanceRuntime.autoscaling.deletionCostPolicy.enabled=false']).some((d) => d.kind === 'ValidatingAdmissionPolicy')) {
    failures.push('deletionCostPolicy.enabled=false でも ValidatingAdmissionPolicy が描画される');
}
if (defaultDocs.some((d) => d.kind === 'ValidatingAdmissionPolicy' || d.kind === 'Role')) failures.push('自動スケールが無効なのに Role か ValidatingAdmissionPolicy が描画される');
// Go の配置（負荷の生成器と別のノードに置く）
const placed = instanceOf(
    docsOf(['--set-string', 'instanceRuntime.nodeSelector.ubichill\\.com/target=true', '--set-json', 'instanceRuntime.tolerations=[{"key":"a","operator":"Exists"}]', '--set-json', 'instanceRuntime.affinity={"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"ubichill.com/loadgen","operator":"DoesNotExist"}]}]}}}']),
    'Deployment',
)?.spec?.template?.spec;
if (placed?.nodeSelector?.['ubichill.com/target'] !== 'true' || placed?.tolerations?.[0]?.key !== 'a' || placed?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms?.[0]?.matchExpressions?.[0]?.key !== 'ubichill.com/loadgen') {
    failures.push(`instance の nodeSelector・tolerations・affinity が渡らない: ${JSON.stringify({ n: placed?.nodeSelector, t: placed?.tolerations, a: placed?.affinity })}`);
}
if (instanceOf(defaultDocs, 'Deployment')?.spec?.template?.spec?.affinity !== undefined) failures.push('affinity を指定していないのに instance に affinity が書かれる');
const monitor = instanceOf(autoscaled, 'ServiceMonitor');
const service = instanceOf(autoscaled, 'Service');
const endpoint = monitor?.spec?.endpoints?.[0];
if (!monitor || endpoint?.port !== 'realtime' || endpoint?.path !== '/metrics' || monitor.metadata.labels.release !== 'prometheus') {
    failures.push(`ServiceMonitor が期待と違う: ${JSON.stringify(monitor)}`);
} else if (!Object.entries(monitor.spec.selector.matchLabels).every(([k, v]) => service?.metadata?.labels?.[k] === v)) {
    failures.push('ServiceMonitor の selector が instance の Service のラベルに合わない');
}
const withoutCpu = instanceOf(
    docsOf(['--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.autoscaling.enabled=true', '--set', 'instanceRuntime.autoscaling.targetCPUPerPod=']),
    'ScaledObject',
);
if (withoutCpu?.spec?.triggers?.some((t) => t.type === 'cpu') !== false) failures.push('targetCPUPerPod を空にしても CPU の trigger が描画される');
const autoscalingArgs = ['--set', 'redis.auth.password=x', '--set', 'instanceRuntime.autoscaling.enabled=true'];
if (!renderFails(autoscalingArgs, 'autoscaling.enabled には instanceRuntime.directory: redis が要ります')) {
    failures.push('directory: memory で autoscaling.enabled にしても描画が通ってしまう');
}
if (!renderFails([...autoscalingArgs, '--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.autoscaling.targetRoomsPerPod=1000'], 'maxRooms（1000）未満にします')) {
    failures.push('targetRoomsPerPod が maxRooms 以上でも描画が通ってしまう');
}
// 9 割（新しい部屋を断り始める数）ちょうどは断り、その手前は通す。0（無制限）なら比べない
const connectionTarget = (max, target) => [...autoscalingArgs, '--set', 'instanceRuntime.directory=redis', '--set', `instanceRuntime.maxConnections=${max}`, '--set', `instanceRuntime.autoscaling.targetConnectionsPerPod=${target}`];
if (!renderFails(connectionTarget(300, 270), 'maxConnections（300）の 9 割未満にします')) {
    failures.push('targetConnectionsPerPod が maxConnections の 9 割以上でも描画が通ってしまう');
}
for (const [max, target] of [[300, 269], [0, 5000]]) {
    if (!instanceOf(docsOf(connectionTarget(max, target).slice(2)), 'ScaledObject')) failures.push(`maxConnections=${max}・targetConnectionsPerPod=${target} が描画されない`);
}
if (!renderFails([...autoscalingArgs, '--set', 'instanceRuntime.directory=redis', '--set', 'instanceRuntime.autoscaling.maxReplicaCount=1'], 'maxReplicaCount は 2 以上')) {
    failures.push('maxReplicaCount=1 でも描画が通ってしまう');
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
if (!rejected) failures.push('同梱の Redis と redis.external.url を同時に指定しても描画が通ってしまう');

// backend の台数: 既定は 1。2 以上は Redis があるときだけ描画できる
const backendReplicas = (manifests) => {
    const docs = parseAllDocuments(manifests).map((d) => d.toJS()).filter(Boolean);
    return docs.find((d) => d.kind === 'Deployment' && d.metadata.name.endsWith('-backend'))?.spec.replicas;
};
const replicaCases = [
    { name: '既定', args: ['--set', 'redis.auth.password=x'], want: 1 },
    { name: '同梱の Redis で 2 台', args: ['--set', 'redis.auth.password=x', '--set', 'backend.replicaCount=2'], want: 2 },
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

// 同梱の Redis（Valkey）。Service の名前とポートは Bitnami の subchart と同じにして、REDIS_URL を変えずに済ませる
const redisArgs = ['--set', 'redis.auth.password=test-redis-password'];
const redisOf = (args) => {
    const docs = parseAllDocuments(render('ubichill', args)).map((d) => d.toJS()).filter(Boolean);
    const sts = docs.find((d) => d.kind === 'StatefulSet' && d.metadata.labels?.component === 'redis');
    const pod = sts?.spec?.template?.spec;
    return {
        docs,
        sts,
        pod,
        valkey: pod?.containers?.find((c) => c.name === 'valkey'),
        exporter: pod?.containers?.find((c) => c.name === 'metrics'),
        find: (kind, name) => docs.find((d) => d.kind === kind && d.metadata.name === name),
        redisDocs: docs.filter((d) => ['redis', 'redis-metrics'].includes(d.metadata?.labels?.component)),
        configLines: (docs.find((d) => d.kind === 'ConfigMap' && d.metadata.name.endsWith('-redis-config'))?.data?.['valkey.conf'] ?? '').split('\n'),
    };
};
const envOf = (container) => Object.fromEntries((container?.env ?? []).map((e) => [e.name, e.value ?? e.valueFrom]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const matches = (selector, labels) => Object.entries(selector ?? {}).every(([k, v]) => labels?.[k] === v);
const expectRedis = (label, ok) => {
    if (!ok) failures.push(`同梱の Redis（${label}）が期待と違う`);
};
{
    const r = redisOf(redisArgs);
    const master = r.find('Service', 'ubichill-redis-master');
    const podLabels = r.sts?.spec?.template?.metadata?.labels;
    const ref = secretRef('ubichill-redis', 'redis-password');
    const sc = r.valkey?.securityContext;
    const pvc = r.sts?.spec?.volumeClaimTemplates?.[0];
    expectRedis('StatefulSet は 1 replica で Bitnami と別の名前', r.sts?.metadata?.name === 'ubichill-redis-valkey' && r.sts.spec.replicas === 1);
    expectRedis(
        'Service <release>-redis-master:6379 が Valkey の Pod だけを指す',
        master?.spec?.ports?.[0]?.port === 6379 &&
            master.spec.ports[0].targetPort === 'redis' &&
            master.spec.selector.component === 'redis' &&
            matches(master.spec.selector, podLabels) &&
            r.valkey?.ports?.some((p) => p.name === 'redis' && p.containerPort === 6379),
    );
    expectRedis(
        'chart が作る Secret',
        Buffer.from(r.find('Secret', 'ubichill-redis')?.data?.['redis-password'] ?? '', 'base64').toString() === 'test-redis-password',
    );
    expectRedis(
        'Valkey・probe が backend と同じ Secret を読む',
        same(envOf(r.valkey).REDIS_PASSWORD, ref) &&
            same(envOf(r.valkey).REDISCLI_AUTH, ref) &&
            r.valkey.args.join(' ') === '/etc/valkey/valkey.conf --requirepass $(REDIS_PASSWORD)',
    );
    expectRedis('版を固定したイメージ', /^docker\.io\/valkey\/valkey:\d+\.\d+\.\d+-alpine$/.test(r.valkey?.image ?? ''));
    expectRedis(
        '設定（AOF・maxmemory は上限 512Mi の 75%・noeviction）',
        ['appendonly yes', 'dir /data', 'maxmemory 384mb', 'maxmemory-policy noeviction'].every((line) => r.configLines.includes(line)),
    );
    expectRedis(
        '非 root・readOnlyRootFilesystem・capabilities drop',
        r.pod?.securityContext?.runAsNonRoot === true &&
            sc?.readOnlyRootFilesystem === true &&
            sc.allowPrivilegeEscalation === false &&
            same(sc.capabilities?.drop, ['ALL']),
    );
    expectRedis(
        'readiness・liveness は valkey-cli ping',
        [r.valkey?.readinessProbe, r.valkey?.livenessProbe].every((p) => p?.exec?.command?.join(' ').includes('valkey-cli -h 127.0.0.1 -p 6379 ping')),
    );
    expectRedis(
        '永続化（既定）は PVC。変更できない欄に chart の版のラベルを入れない',
        pvc?.metadata?.name === 'data' &&
            pvc.spec.resources.requests.storage === '2Gi' &&
            pvc.metadata.labels['helm.sh/chart'] === undefined &&
            !r.pod.volumes.some((v) => v.name === 'data'),
    );
    expectRedis(
        'exporter・ServiceMonitor・NetworkPolicy は既定で無い',
        !r.exporter && !r.find('Service', 'ubichill-redis-metrics') && !r.find('ServiceMonitor', 'ubichill-redis') && !r.find('NetworkPolicy', 'ubichill-redis'),
    );
}
{
    const pvc = redisOf([...redisArgs, '--set', 'redis.master.persistence.storageClass=proxmox-data', '--set', 'redis.master.persistence.size=5Gi']).sts
        ?.spec?.volumeClaimTemplates?.[0]?.spec;
    expectRedis('storageClass・size', pvc?.storageClassName === 'proxmox-data' && pvc.resources.requests.storage === '5Gi');
}
{
    const r = redisOf([...redisArgs, '--set', 'redis.master.persistence.enabled=false']);
    expectRedis('永続化なしは emptyDir', !r.sts?.spec?.volumeClaimTemplates && r.pod?.volumes?.some((v) => v.name === 'data' && v.emptyDir));
}
{
    const r = redisOf(['--set', 'redis.auth.existingSecret=ubichill-secrets', '--set', 'redis.auth.existingSecretPasswordKey=REDIS_PASSWORD']);
    expectRedis(
        'auth.existingSecret なら Secret を作らずそれを読む',
        !r.find('Secret', 'ubichill-redis') &&
            same(envOf(r.valkey).REDIS_PASSWORD, secretRef('ubichill-secrets', 'REDIS_PASSWORD')) &&
            r.sts.spec.template.metadata.annotations['checksum/password'] === undefined,
    );
}
{
    const r = redisOf(['--set', 'redis.auth.enabled=false']);
    expectRedis('認証なしは Secret・--requirepass が無い', !r.find('Secret', 'ubichill-redis') && !r.valkey?.args?.includes('--requirepass') && !r.valkey?.env);
}
{
    const r = redisOf([
        ...redisArgs,
        '--set', 'redis.metrics.enabled=true',
        '--set', 'redis.metrics.serviceMonitor.enabled=true',
        '--set', 'redis.metrics.serviceMonitor.labels.release=prometheus',
    ]);
    const svc = r.find('Service', 'ubichill-redis-metrics');
    const monitor = r.find('ServiceMonitor', 'ubichill-redis');
    expectRedis(
        'exporter の sidecar',
        /^docker\.io\/oliver006\/redis_exporter:v\d+\.\d+\.\d+$/.test(r.exporter?.image ?? '') &&
            envOf(r.exporter).REDIS_ADDR === 'redis://127.0.0.1:6379' &&
            same(envOf(r.exporter).REDIS_PASSWORD, secretRef('ubichill-redis', 'redis-password')),
    );
    expectRedis(
        'ServiceMonitor が metrics の Service だけを拾う',
        monitor?.spec?.endpoints?.[0]?.port === 'http-metrics' &&
            monitor.metadata.labels.release === 'prometheus' &&
            matches(monitor.spec.selector.matchLabels, svc?.metadata?.labels) &&
            !matches(monitor.spec.selector.matchLabels, r.find('Service', 'ubichill-redis-master')?.metadata?.labels) &&
            svc.spec.ports[0].name === 'http-metrics' &&
            matches(svc.spec.selector, r.sts.spec.template.metadata.labels),
    );
}
{
    const digest = `sha256:${'a'.repeat(64)}`;
    expectRedis('digest を足したイメージ', redisOf([...redisArgs, '--set', `redis.image.digest=${digest}`]).valkey?.image === `docker.io/valkey/valkey:8.1.11-alpine@${digest}`);
    expectRedis(
        'digest だけのイメージ',
        redisOf([...redisArgs, '--set', `redis.image.digest=${digest}`, '--set', 'redis.image.tag=']).valkey?.image === `docker.io/valkey/valkey@${digest}`,
    );
}
for (const [limit, want] of [['1Gi', '768mb'], ['1.5Gi', '1152mb'], ['128Mi', '96mb']]) {
    expectRedis(`maxmemory（上限 ${limit}）`, redisOf([...redisArgs, '--set', `redis.master.resources.limits.memory=${limit}`]).configLines.includes(`maxmemory ${want}`));
}
expectRedis('maxmemory の明示', redisOf([...redisArgs, '--set', 'redis.config.maxmemory=100mb']).configLines.includes('maxmemory 100mb'));
for (const [label, args] of [
    ['redis.enabled=false', ['--set', 'redis.enabled=false']],
    ['redis.external.url', ['--set', 'redis.enabled=false', '--set', 'redis.external.url=redis://redis.shared:6379']],
]) {
    const found = redisOf(args).redisDocs;
    if (found.length > 0) failures.push(`${label} でも同梱の Redis が描画される: ${found.map((d) => `${d.kind}/${d.metadata.name}`).join(', ')}`);
}
for (const file of ['values-dev.yaml', 'values-prod.yaml']) {
    const r = redisOf([
        '-f', `${chart}/${file}`,
        ...redisArgs,
        '--set', 'backend.secretEnv.BETTER_AUTH_SECRET=test-better-auth-secret-at-least-32-characters',
        '--set', 'backend.secretEnv.RESEND_API_KEY=test-resend-api-key',
    ]);
    expectRedis(`${file} で描画`, r.find('Service', 'ubichill-redis-master') && r.valkey);
}
for (const [label, args, message] of [
    ['パスワードも existingSecret も無い', [], 'redis.auth.password か redis.auth.existingSecret'],
    ['タグが latest', [...redisArgs, '--set', 'redis.image.tag=latest'], 'redis.image.tag は版を固定'],
    ['digest の形が違う', [...redisArgs, '--set', 'redis.image.digest=abc'], 'sha256:<hex> の形'],
    // home-manifests の dev が Bitnami の subchart 向けに書いていた値。残すと存在しないイメージを引いて Pod が起動しない
    [
        'Bitnami の exporter',
        [...redisArgs, '--set', 'redis.metrics.enabled=true', '--set', 'redis.metrics.image.repository=bitnamilegacy/redis-exporter'],
        'redis.metrics.image.repository に Bitnami のイメージ',
    ],
    ['Bitnami の Redis', [...redisArgs, '--set', 'redis.image.repository=docker.io/bitnami/redis'], 'redis.image.repository に Bitnami のイメージ'],
]) {
    if (!renderFails(args, message)) failures.push(`同梱の Redis: ${label}でも描画が通ってしまう`);
}

if (failures.length > 0) {
    console.error(`❌ chart の Redis の env・同梱の Redis・backend の台数:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
}
console.log(
    `✅ chart の Redis の env: ${cases.length} 通り + 同梱の Valkey（Service・Secret・永続化・exporter・版の固定・描画しない条件・拒否）+ instance の Downward API・Directory の選択（Go・backend）・replicas・更新方式と drain（引っ越し・猶予の自動計算）・指標の収集と KEDA（既定・有効・scale-in・draining の除外・拒否）・pod-deletion-cost の権限 + 不正な指定の拒否、backend の台数: ${replicaCases.length} 通り + Redis なしの複数台の拒否`,
);
