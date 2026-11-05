/**
 * `world.html` のエントリ。SNS の画面（index.html）と同じ `src/world` でワールドを動かすが、
 * 認証・router・backend API を持たない。同期の相手は同じオリジンの Go だけ。
 */
import { type RequestServiceToken, ServiceTokenProvider, SocketProvider, WorldProvider } from '@ubichill/react';
import { UbiError, UbiErrorCode } from '@ubichill/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PermissionRoot } from '@/components/permissions/PermissionRoot';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import { createGuestResolver } from '@/world';
import '@/styles/globals.css';
import { WorldApp } from './WorldApp';

const resolveInstance = createGuestResolver('', window.sessionStorage);

/** SNS が無いので身元証明は出せない（mod には理由を返す）。 */
const requestServiceToken: RequestServiceToken = async () => {
    throw new UbiError(UbiErrorCode.IDENTITY_UNAVAILABLE, 'このサーバーは身元証明を発行していません');
};

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
    <StrictMode>
        <SocketProvider resolveInstance={resolveInstance}>
            <WorldProvider>
                <PermissionRoot>
                    <ServiceTokenProvider requestToken={requestServiceToken}>
                        <ConfirmProvider>
                            <WorldApp />
                        </ConfirmProvider>
                    </ServiceTokenProvider>
                </PermissionRoot>
            </WorldProvider>
        </SocketProvider>
    </StrictMode>,
);
