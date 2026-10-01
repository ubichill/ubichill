import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { loadSigningKey, signingPublicKeySnapshot, subscribeSigningKey } from './keyStore';

/** このブラウザに保存された、そのアカウントの署名鍵の公開鍵（読み込み中は undefined、未設定は null）。 */
export function useSigningPublicKey(userId: string): string | null | undefined {
    const getSnapshot = useCallback(() => signingPublicKeySnapshot(userId), [userId]);
    const publicKey = useSyncExternalStore(subscribeSigningKey, getSnapshot, getSnapshot);
    useEffect(() => {
        if (publicKey === undefined) void loadSigningKey(userId).catch(() => undefined);
    }, [publicKey, userId]);
    return publicKey;
}
