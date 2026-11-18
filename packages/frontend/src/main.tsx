import { ErrorBoundary, ServiceTokenProvider, SocketProvider, WorldProvider } from '@ubichill/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PermissionRoot } from './components/permissions/PermissionRoot';
import { AppCrashFallback } from './components/ui/AppCrashFallback';
import { requestServiceToken } from './lib/mods/serviceTokens';
import { restoreMediaOutput } from './lib/settings/mediaOutputSetting';
import { resolveInstance } from './lib/worlds/instanceConnection';
import { AppRouter } from './router';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

restoreMediaOutput();

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
