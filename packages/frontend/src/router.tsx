import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { NotificationsProvider } from './components/notifications';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ConfirmProvider } from './components/ui/ConfirmProvider';
import { VersionBadge } from './components/VersionBadge';
import { VersionSkewGuard } from './components/VersionSkewGuard';
import { SessionProvider } from './lib/session';
import { AuthPage } from './pages/AuthPage';
import { CliAuthorizePage } from './pages/CliAuthorizePage';
import { HomePage } from './pages/HomePage';
import { InstancePage } from './pages/InstancePage';
import { ModPage } from './pages/ModPage';
import { UserPage } from './pages/UserPage';
import { WorldPage } from './pages/WorldPage';
import { WorldEditorPage } from './pages/world-editor';

export function AppRouter() {
    return (
        <BrowserRouter>
            <SessionProvider>
                <NotificationsProvider>
                    <ConfirmProvider>
                        <Routes>
                            <Route path="/auth" element={<AuthPage />} />
                            {/* ロビーは無い。ログインしたらホームの部屋へそのまま移る */}
                            <Route
                                path="/"
                                element={
                                    <ProtectedRoute>
                                        <HomePage />
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
                            <Route path="/world" element={<WorldPage />} />
                            <Route path="/:at/mods/:name" element={<ModPage />} />
                            <Route path="/:at/mods/:name/versions/:version" element={<ModPage />} />
                            <Route path="/world/:worldId" element={<WorldPage />} />
                            {/* 共有 URL（/@handle/name）。作者の ID と名前で決まる */}
                            <Route path="/:at/:name" element={<WorldPage />} />
                            {/* ユーザーのプロフィール（共有できるよう、ログインしなくても見られる。操作するときだけログイン） */}
                            <Route path="/user/:userId" element={<UserPage />} />
                            {/* ユーザーページ（/@ID）。ログインしなくても見られる */}
                            <Route path="/:at" element={<UserPage />} />
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
                            {/* CLI・CI（ubichill login / ci create）を公開環境として追加する承認 */}
                            <Route
                                path="/cli/authorize"
                                element={
                                    <ProtectedRoute>
                                        <CliAuthorizePage />
                                    </ProtectedRoute>
                                }
                            />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                        <VersionBadge />
                        <VersionSkewGuard />
                    </ConfirmProvider>
                </NotificationsProvider>
            </SessionProvider>
        </BrowserRouter>
    );
}
