import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { VersionBadge } from './components/VersionBadge';
import { AuthPage } from './pages/AuthPage';
import { InstancePage } from './pages/InstancePage';
import { LobbyPage } from './pages/LobbyPage';
import { WorldPage } from './pages/WorldPage';

export function AppRouter() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/auth" element={<AuthPage />} />
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <LobbyPage />
                        </ProtectedRoute>
                    }
                />
                <Route
                    path="/instance/:id"
                    element={
                        <ProtectedRoute>
                            <InstancePage />
                        </ProtectedRoute>
                    }
                />
                {/* 公開ワールド URL — 誰でもアクセス可能、認証後に自動参加 */}
                <Route path="/world/:worldId" element={<WorldPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <VersionBadge />
        </BrowserRouter>
    );
}
