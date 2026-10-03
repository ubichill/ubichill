/** ユーザーページのパス。ID があれば `/@ID`、無ければ内部 ID の `/user/:id`。 */
export function userPagePath(user: { id: string; handle: string | null }): string {
    return user.handle ? `/@${user.handle}` : `/user/${encodeURIComponent(user.id)}`;
}
