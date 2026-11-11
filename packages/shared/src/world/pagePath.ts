/** ワールドの共有ページのパス（画面のリンクと、フェディバースの固定ノートのリンクで同じ形にする）。 */

/**
 * このサーバーのワールドの共有ページのパス（`/@handle/name`）。正規 URL（`.../api/v1/authors/:handle/worlds/:name.yaml`）から作り、
 * API のオリジンとフロントのオリジンが違っても（開発環境）フロントのパスにする。作れなければ以前の形（`/world/:id`）。
 */
export function localWorldPagePath(world: { id: string; url?: string; source?: { url?: string } }): string {
    const url = world.url ?? world.source?.url;
    const author = url ? /\/api\/v1\/authors\/([^/]+)\/worlds\/([^/?#.]+)\.yaml$/.exec(url) : null;
    return author ? `/@${author[1]}/${author[2]}` : `/world/${encodeURIComponent(world.id)}`;
}

/**
 * ワールドの共有ページのパス（このサーバーの中）。短い共有ページ（`/@handle/name`）があればそれ、本体のワールドは正規 URL から、
 * それ以外の外部のワールドは `/world?url=…`（作者を確かめられていなくても開ける）。
 */
export function worldPagePath(world: {
    id: string;
    url?: string;
    source?: { kind: string; url?: string };
    sharePath?: string;
}): string {
    if (world.sharePath) return world.sharePath;
    const url = world.url ?? world.source?.url;
    if (world.source?.kind === 'local' || !url) return localWorldPagePath(world);
    return `/world?url=${encodeURIComponent(url)}`;
}
