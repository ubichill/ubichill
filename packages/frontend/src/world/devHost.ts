/**
 * 開発用の Host か（`pnpm dev`、または開発用としてビルドしたプレビュー）。
 * 本番としてビルドした Host・`VITE_ENVIRONMENT` を指定せずにビルドした Host は、未署名の mod を動かさず、
 * 作者のサーバーにも https でしか問い合わせない。
 */
export const DEV_HOST: boolean = import.meta.env.DEV || import.meta.env.VITE_ENVIRONMENT === 'development';
