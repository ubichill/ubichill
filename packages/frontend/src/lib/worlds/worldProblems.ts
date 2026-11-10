/**
 * そのまま署名し直せば直る問題か。署名の形式が古い（版 1）・形式が読めないだけで、配信している中身は作者が置いたまま。
 * 内容が署名と合わない（content-mismatch など）ものは、何が変わったかを作者が確かめるため、編集から公開し直させる。
 */
export function isResignable(world: { problemCode?: string }): boolean {
    return world.problemCode === 'malformed';
}
