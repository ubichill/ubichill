// k6 の入口。LT_SCENARIO=users（利用者の負荷）か browser（画面の体験の確認）。設定は env（LT_*）で渡す（config.ts）。
// k6-operator は parallelism の数だけ runner を立て、setup() は runner ごとに走る。setup では確かめるだけにする。
import { getJson } from './api.ts';
import { type BrowserSetup, runBrowserJourney } from './browser.ts';
import { buildOptions, parseConfig, validateConfig } from './config.ts';
import { capacityProblem, findWorld, isRecord } from './protocol.ts';
import { runnerSplitProblem, runUser } from './users.ts';

const config = parseConfig(__ENV);
const problems = validateConfig(config);
if (problems.length > 0) throw new Error(`負荷試験の設定が不正です:\n- ${problems.join('\n- ')}`);

export const options = buildOptions(config);

export function setup(): BrowserSetup {
    const target = { origin: config.origin, apiBase: config.apiBase };
    const version = getJson(target, '/api/version');
    if (version.status !== 200 || !isRecord(version.body)) {
        throw new Error(`backend（${config.apiBase}）に届きません: /api/version が ${version.status}`);
    }
    const worlds = getJson(target, '/api/v1/worlds');
    const world = worlds.status === 200 ? findWorld(worlds.body, config.worldId) : null;
    if (world === null) {
        throw new Error(
            `ワールドの一覧に ${config.worldId} がありません（${worlds.status}）。dev は WORLDS_SERVE_UNSIGNED_REPOSITORY=true か確かめる`,
        );
    }
    const problem =
        config.scenario === 'users'
            ? (capacityProblem(world, config.usersPerRoom) ?? runnerSplitProblem(config))
            : null;
    if (problem !== null) throw new Error(problem);
    console.log(
        `負荷試験 ${config.testId}: ${config.scenario}・commit ${String(version.body.commitHash)}・ワールド ${world.id}`,
    );
    return { worldDisplayName: world.displayName };
}

export async function users(): Promise<void> {
    await runUser(config);
}

export async function browserJourney(data: BrowserSetup): Promise<void> {
    await runBrowserJourney(config, data);
}
