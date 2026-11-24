/**
 * 検索エンジンに載せてよい環境か。本番（backend の NODE_ENV、`/api/version` の environment が production）だけ。
 * 開発・プレビューは、URL を知っている人が見られても検索には出さない（canonical がプレビューを指し、テストのユーザーが載る）。
 */
export const isIndexableEnvironment = (environment: string | undefined): boolean =>
    environment?.trim().toLowerCase() === 'production';
