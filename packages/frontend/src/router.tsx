import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ConfirmProvider } from './components/ui/ConfirmProvider';
import { VersionBadge } from './components/VersionBadge';
import { AuthPage } from './pages/AuthPage';
import { InstancePage } from './pages/InstancePage';
import { LobbyPage } from './pages/LobbyPage';
import { UserPage } from './pages/UserPage';
import { WorldPage } from './pages/WorldPage';
import { WorldEditorPage } from './pages/world-editor';

export function AppRouter() {
    return (
        <BrowserRouter>
            <ConfirmProvider>
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
                    {/* ユーザープロフィール（URL から閲覧。マイページは HUD タブで表示） */}
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
            </ConfirmProvider>
        </BrowserRouter>
    );
}
