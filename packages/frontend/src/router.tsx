import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { VersionBadge } from './components/VersionBadge';
import { AuthPage } from './pages/AuthPage';
import { InstancePage } from './pages/InstancePage';
import { LobbyPage } from './pages/LobbyPage';
import { UserPage } from './pages/UserPage';
import { WorldEditorPage } from './pages/WorldEditorPage';
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
                {/* 自分のマイページ */}
                <Route
                    path="/user/me"
                    element={
                        <ProtectedRoute>
                            <UserPage />
                        </ProtectedRoute>
                    }
                />
                {/* 他ユーザーの公開ページ */}
                <Route
                    path="/user/:userId"
                    element={
                        <ProtectedRoute>
                            <UserPage />
                        </ProtectedRoute>
                    }
                />
                {/* ワールド新規作成 */}
                <Route
                    path="/worlds/new"
                    element={
                        <ProtectedRoute>
                            <WorldEditorPage />
                        </ProtectedRoute>
                    }
                />
                {/* ワールド編集（作成者のみアクセス可能、サーバー側で 403） */}
                <Route
                    path="/world/:worldId/edit"
                    element={
                        <ProtectedRoute>
                            <WorldEditorPage />
                        </ProtectedRoute>
                    }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <VersionBadge />
        </BrowserRouter>
    );
}
