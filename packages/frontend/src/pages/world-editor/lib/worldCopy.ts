import { type ModLock, type WorldDefinition, WorldDefinitionSchema } from '@ubichill/shared';
import yaml from 'yaml';

/**
 * 外部のワールドのコピー（このサーバーの新しいワールド）。名前は新しく付け、版は 1.0.0 から始める。
 * 作者の表示（metadata.author）は持ち込まない（保存したアカウントの作品になる）。
 * mod は元のワールドの lock の版のまま始める（保存のときに足りない分だけ固定し直す）。
 */
export function worldCopy(source: WorldDefinition, name: string, lock: ModLock | undefined): WorldDefinition {
    const { author: _author, ...metadata } = source.metadata;
    const { lock: _lock, ...spec } = source.spec;
    return {
        ...source,
        metadata: { ...metadata, name, version: '1.0.0' },
        spec: lock ? { ...spec, lock } : spec,
    };
}

export interface WorldCopyDeps {
    /** サーバーで解決したワールド（YAML の取得元と、作者の署名を確かめた lock）。 */
    resolve: (url: string) => Promise<{ source: { url: string }; lock?: ModLock }>;
    fetchText: (url: string) => Promise<string>;
    newName: () => string;
}

/** 外部のワールドを読み、コピーにする。YAML がワールドの形でなければ失敗する。 */
export async function loadWorldCopy(url: string, deps: WorldCopyDeps): Promise<WorldDefinition> {
    const world = await deps.resolve(url);
    const parsed = WorldDefinitionSchema.safeParse(yaml.parse(await deps.fetchText(world.source.url)));
    if (!parsed.success) throw new Error('ワールドの YAML を読めません');
    return worldCopy(parsed.data, deps.newName(), world.lock);
}
