/**
 * `ubichill world build <world.yaml>`: 手元のワールド定義から、Go のインスタンスサーバーに渡す定義
 * （`InstanceDefinition` の JSON）を作る。backend がインスタンスを作るときと同じ変換（`toInstanceDefinition`）なので、
 * `ubichill-instance --guests --world=<出力>` で起動した Go は、本体で動かすのと同じ初期状態を持つ。
 *
 * mod の lock は兄弟の `<world>.lock.json`（`ubichill install` が作る）から読む。lock の要る mod があるのに
 * 無ければ失敗にする（lock の無い mod は Host が実行しないので、動かないワールドを黙って出さない）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
    definitionToResolved,
    type InstanceDefinition,
    ModLockSchema,
    requiredLockModIds,
    toInstanceDefinition,
    WorldSourceKind,
} from '@ubichill/shared';
import type { Logger } from '@ubichill/terminal';
import yaml from 'yaml';

const USAGE = 'usage: ubichill world build <world.yaml> [--id=<instanceId>] [--max-users=<n>] [--out=<path>]';

/** Go の InstanceDefinition が受け付ける範囲（protocol/instance/openapi.json）。 */
const MAX_USERS_LIMIT = 1000;
const ID_MAX_LENGTH = 200;

export interface WorldBuildInput {
    worldPath: string;
    /** YAML のテキスト。 */
    worldText: string;
    /** 兄弟の lock（無ければ undefined）。 */
    lockText?: string;
    id?: string;
    maxUsers?: number;
}

/**
 * 純粋な変換。`id` は省略時 `metadata.name`、`maxUsers` は省略時ワールドの定員の上限。
 * lock に無い mod を参照していれば throw する。
 */
export function buildInstanceDefinition(input: WorldBuildInput): InstanceDefinition {
    const url = pathToFileURL(input.worldPath).href;
    const parsedLock = input.lockText === undefined ? undefined : ModLockSchema.parse(JSON.parse(input.lockText));
    const world = definitionToResolved(
        yaml.parse(input.worldText),
        url,
        { kind: WorldSourceKind.Local, url },
        {
            lock: parsedLock,
        },
    );
    const unlocked = requiredLockModIds(world).filter((modId) => !world.lock?.mods[modId]);
    if (unlocked.length > 0) {
        throw new Error(
            `lock に固定されていない mod があります: ${unlocked.join(', ')}。` +
                `\`ubichill install ${input.worldPath}\` で ${lockPathFor(input.worldPath)} を作ってください`,
        );
    }
    const id = input.id ?? world.id;
    if (id.length === 0 || id.length > ID_MAX_LENGTH)
        throw new Error(`インスタンス ID は 1〜${ID_MAX_LENGTH} 文字です`);
    const maxUsers = input.maxUsers ?? world.capacity.max;
    if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > MAX_USERS_LIMIT) {
        throw new Error(`--max-users は 1〜${MAX_USERS_LIMIT} の整数です`);
    }
    if (maxUsers > world.capacity.max) {
        throw new Error(`--max-users=${maxUsers} はワールドの定員の上限（${world.capacity.max}）を超えています`);
    }
    return toInstanceDefinition(world, { id, maxUsers });
}

const lockPathFor = (worldPath: string): string => worldPath.replace(/\.ya?ml$/i, '.lock.json');

const argValue = (argv: string[], name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export async function runWorld(argv: string[], log: Logger): Promise<void> {
    const [subcommand, ...rest] = argv;
    if (subcommand !== 'build') throw new Error(USAGE);
    const worldPath = rest.find((a) => !a.startsWith('--'));
    if (!worldPath || !/\.ya?ml$/i.test(worldPath)) throw new Error(USAGE);
    const lockPath = lockPathFor(worldPath);
    const maxUsersArg = argValue(rest, 'max-users');
    const definition = buildInstanceDefinition({
        worldPath,
        worldText: readFileSync(worldPath, 'utf-8'),
        lockText: existsSync(lockPath) ? readFileSync(lockPath, 'utf-8') : undefined,
        id: argValue(rest, 'id'),
        maxUsers: maxUsersArg === undefined ? undefined : Number(maxUsersArg),
    });
    const json = `${JSON.stringify(definition, null, 2)}\n`;
    const out = argValue(rest, 'out');
    if (out) {
        writeFileSync(out, json, 'utf-8');
        log.success(out, `entity ${definition.snapshot.entities.length}、mod ${definition.snapshot.activeMods.length}`);
    } else {
        // 定義を stdout に流す（パイプで Go に渡す）。ほかのものは stdout に書かない
        process.stdout.write(json);
    }
}
