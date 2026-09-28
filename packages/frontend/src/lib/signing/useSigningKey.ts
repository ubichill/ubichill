import { useEffect, useSyncExternalStore } from 'react';
import { loadSigningKey, signingPublicKeySnapshot, subscribeSigningKey } from './keyStore';

/** このブラウザに保存された作者署名鍵の公開鍵（読み込み中は undefined、未設定は null）。 */
export function useSigningPublicKey(): string | null | undefined {
    const publicKey = useSyncExternalStore(subscribeSigningKey, signingPublicKeySnapshot, signingPublicKeySnapshot);
    useEffect(() => {
        if (publicKey === undefined) void loadSigningKey().catch(() => undefined);
    }, [publicKey]);
    return publicKey;
}
