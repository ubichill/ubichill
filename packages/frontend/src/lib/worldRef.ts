import type { Instance } from '@ubichill/shared';

/**
 * インスタンスのワールドを指す URL（お気に入り・新しいインスタンス作成のキー）。
 * 外部ワールドは id だけでは自サーバーで解決できないので、取得元の URL を優先する。
 */
export function instanceWorldRef(world: Pick<Instance['world'], 'id' | 'source'>): string {
    return world.source?.url ?? world.id;
}
