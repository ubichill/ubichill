import { ErrorBoundary, ServiceTokenProvider, SocketProvider, WorldProvider } from '@ubichill/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PermissionRoot } from './components/permissions/PermissionRoot';
import { AppCrashFallback } from './components/ui/AppCrashFallback';
import { requestServiceToken } from './lib/mods/serviceTokens';
import { loadServerOverview } from './lib/server/serverInfo';
import { restoreMediaOutput } from './lib/settings/mediaOutputSetting';
import { resolveInstance } from './lib/worlds/instanceConnection';
import { AppRouter } from './router';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

restoreMediaOutput();
// テーマの色・アイコン・略称（BFF が HTML に入れた色を、管理者が変えた後の値に合わせる）
void loadServerOverview();

createRoot(rootEl).render(
    <StrictMode>
        <ErrorBoundary fallback={<AppCrashFallback />}>
            <SocketProvider resolveInstance={resolveInstance}>
                <WorldProvider>
                    <PermissionRoot>
                        <ServiceTokenProvider requestToken={requestServiceToken}>
                            <AppRouter />
                        </ServiceTokenProvider>
                    </PermissionRoot>
                </WorldProvider>
            </SocketProvider>
        </ErrorBoundary>
    </StrictMode>,
);
