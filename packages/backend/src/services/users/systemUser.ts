/** システムユーザー（リポジトリ管理のワールドの作者）。検索・フレンド・ブロック・ロール・連合の相手には出さない。 */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export const isSystemUser = (userId: string): boolean => userId === SYSTEM_USER_ID;
