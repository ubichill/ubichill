import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fetchPackageBytes, type PackageFetch, readPackageManifest } from '@ubichill/loader';
import { writeWorldFiles } from '@ubichill/loader/world-files';
import {
    flattenPrefabEntities,
    type InitialEntity,
    instantiatePrefab,
    lockedMods,
    ModLockSchema,
    unpackPrefab,
    updatePrefabInstance,
    WorldDefinitionSchema,
} from '@ubichill/shared';
import type { Logger } from '@ubichill/terminal';
import yaml from 'yaml';
import { targetWorld } from './packages.ts';

export async function runPrefab(args: string[], log: Logger): Promise<void> {
    const [action, target] = args;
    const path = targetWorld(args);
    const raw = readFileSync(path, 'utf8');
    const doc = yaml.parseDocument(raw);
    const world = WorldDefinitionSchema.parse(doc.toJS());
    const lock = ModLockSchema.parse(JSON.parse(readFileSync(path.replace(/\.ya?ml$/i, '.lock.json'), 'utf8')));
    const modsDir = resolve(args.find((a) => a.startsWith('--mods-dir='))?.slice(11) ?? 'dist');
    const fetchBytes: PackageFetch = async (url) => {
        if (/^https?:/.test(url)) return fetchPackageBytes(url);
        const file = resolve(modsDir, url.replace(/^\//, ''));
        if (!file.startsWith(modsDir + sep) || !existsSync(file)) throw new Error(`配布物が見つかりません: ${file}`);
        return readFileSync(file);
    };
    let entities = world.spec.initialEntities;
    if (action === 'add') {
        const [id, name] = (target ?? '').split('/');
        const entry = lockedMods(lock)[id];
        if (!entry) throw new Error('先に mod を install してください');
        const manifest = await readPackageManifest(entry, '', fetchBytes);
        const prefab = manifest.prefabs?.[name];
        if (!prefab) throw new Error('プレハブが見つかりません');
        entities = [
            ...entities,
            instantiatePrefab(
                entry,
                name,
                prefab,
                manifest.components,
                entities,
                `prefab-${randomUUID().slice(0, 12)}`,
            ),
        ];
    } else if (action === 'update' || action === 'unpack') {
        const entity = flattenPrefabEntities(entities).find((e) => e.id === target);
        if (!entity?.prefab) throw new Error('配置済みプレハブの Entity ID を指定してください');
        let next: InitialEntity;
        if (action === 'unpack') next = unpackPrefab(entity);
        else {
            const link = entity.prefab;
            const entry = lockedMods(lock)[link.modId];
            if (!entry) throw new Error('先に mod を install してください');
            const old = await readPackageManifest(
                {
                    id: link.modId,
                    version: link.version,
                    manifestIntegrity: link.manifestIntegrity,
                    baseUrl: link.baseUrl,
                    components: {},
                },
                '',
                fetchBytes,
            );
            const manifest = await readPackageManifest(entry, '', fetchBytes);
            const before = old.prefabs?.[link.name];
            const after = manifest.prefabs?.[link.name];
            if (!before || !after) throw new Error('更新前または更新先にプレハブがありません');
            const result = updatePrefabInstance(
                entity,
                { prefab: before, fields: old.components },
                { prefab: after, fields: manifest.components, entry },
                entities,
            );
            log.info(
                `${link.version} → ${entry.version}。競合 ${result.conflicts.length} 件`,
                result.conflicts.join('\n'),
            );
            if (!args.includes('--apply')) {
                log.info('配置側の変更を残して適用するには --apply を指定してください');
                return;
            }
            next = result.entity;
        }
        const replace = (list: InitialEntity[]): InitialEntity[] =>
            list.map((e) => (e.id === target ? next : { ...e, children: replace(e.children) }));
        entities = replace(entities);
    } else
        throw new Error(
            '使い方: ubichill prefab add <mod/プレハブ> | update <Entity ID> [--apply] | unpack <Entity ID> --world=world.yaml',
        );
    WorldDefinitionSchema.parse({ ...world, spec: { ...world.spec, initialEntities: entities } });
    doc.setIn(['spec', 'initialEntities'], entities);
    writeWorldFiles([{ path, text: String(doc), expected: raw }]);
    log.success(
        `プレハブを${action === 'unpack' ? 'Unpack' : action === 'add' ? '配置' : '更新'}しました`,
        '公開時にワールドを署名し直してください',
    );
}
