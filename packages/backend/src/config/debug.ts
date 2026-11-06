/**
 * DEBUG の解釈。設定（appConfig.debug）とロガーで同じ規則を使う（ロガーが設定を読み込むと、設定の検証が import のたびに走る）。
 * 未指定なら本番（NODE_ENV=production）以外で有効。
 */
export const debugFromEnv = (value: string | undefined, nodeEnv: string | undefined): boolean =>
    value === 'true' ? true : value === 'false' ? false : nodeEnv !== 'production';
