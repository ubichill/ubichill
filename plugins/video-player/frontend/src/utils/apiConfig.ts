/**
 * Video Player API設定
 *
 * 環境に応じて適切なAPIベースURLを提供します。
 * 優先順位:
 * 1. 環境変数 VITE_VIDEO_PLAYER_BACKEND_URL
 * 2. ローカル開発: http://localhost:8000
 * 3. 本番環境: /plugin/video-player (統一プラグインパス)
 */

export const getVideoPlayerApiBase = (): string => {
    // 環境変数が設定されていればそれを優先
    const envUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_VIDEO_PLAYER_BACKEND_URL;
    if (envUrl) {
        return envUrl;
    }

    return window.location.hostname === 'localhost' ? 'http://localhost:8000' : '/plugin/video-player';
};
