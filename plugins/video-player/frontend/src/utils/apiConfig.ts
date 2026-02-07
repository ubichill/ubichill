/**
 * Video Player API設定
 *
 * 環境に応じて適切なAPIベースURLを提供します。
 * 優先順位:
 * 1. 環境変数 NEXT_PUBLIC_VIDEO_PLAYER_BACKEND_URL
 * 2. ローカル開発: http://localhost:8000
 * 3. 本番環境: /plugin/video-player (統一プラグインパス)
 */

export const getVideoPlayerApiBase = (): string => {
    // 環境変数が設定されていればそれを優先
    if (process.env.NEXT_PUBLIC_VIDEO_PLAYER_BACKEND_URL) {
        return process.env.NEXT_PUBLIC_VIDEO_PLAYER_BACKEND_URL;
    }

    // SSR時は本番環境パスをデフォルトに
    if (typeof window === 'undefined') {
        return '/plugin/video-player';
    }

    // クライアントサイドでホスト名チェック
    return window.location.hostname === 'localhost' ? 'http://localhost:8000' : '/plugin/video-player';
};
