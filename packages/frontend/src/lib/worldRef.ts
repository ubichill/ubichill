import type { Instance } from '@ubichill/shared';

/**
 * インスタンスのワールドを指す URL（お気に入り・新しいインスタンス作成のキー）。
 * 外部ワールドは id だけでは自サーバーで解決できないので、取得元の URL を優先する。
 */
export function instanceWorldRef(world: Pick<Instance['world'], 'id' | 'source'>): string {
    return world.source?.url ?? world.id;
}

/**
 * このサーバーのワールドの共有ページのパス（`/@handle/name`）。正規 URL（`.../api/v1/authors/:handle/worlds/:name.yaml`）から作り、
 * API のオリジンとフロントのオリジンが違っても（開発環境）フロントのパスにする。作れなければ以前の形（`/world/:id`）。
 */
export function localWorldPagePath(world: { id: string; url?: string }): string {
    const author = world.url ? /\/api\/v1\/authors\/([^/]+)\/worlds\/([^/?#.]+)\.yaml$/.exec(world.url) : null;
    return author ? `/@${author[1]}/${author[2]}` : `/world/${encodeURIComponent(world.id)}`;
}
