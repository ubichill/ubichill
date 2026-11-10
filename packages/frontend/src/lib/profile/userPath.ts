/** ユーザーページのパス（`/@ID`）。 */
export function userPagePath(user: { handle: string }): string {
    return `/@${user.handle}`;
}
