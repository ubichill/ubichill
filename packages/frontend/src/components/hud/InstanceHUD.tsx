import { useSocket } from '@ubichill/sdk/react';
import type { Instance } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE } from '@/lib/api';
import { css } from '@/styled-system/css';

export function InstanceHUD() {
    const navigate = useNavigate();
    const { id: instanceId } = useParams<{ id: string }>();
    const { users, isConnected, currentUser } = useSocket();
    const [menuOpen, setMenuOpen] = useState(false);
    /** 現在のインスタンスが指すワールド（authorName 比較で編集ボタン表示を判定） */
    const [instanceWorld, setInstanceWorld] = useState<Instance['world'] | null>(null);

    // currentUser はカーソル移動のたびに参照が変わるので、name だけ依存に使う
    const currentUserName = currentUser?.name;

    // 編集ボタンの表示判定はワールド作成者名で行う。
    // 正規の認可は backend の PUT/DELETE で authorId 厳格チェックされるため、
    // UI で偶然一致して編集ボタンが見えても、他人のワールドは絶対に書き換えできない。
    useEffect(() => {
        if (!instanceId) {
            setInstanceWorld(null);
            return;
        }
        let cancelled = false;
        fetch(`${API_BASE}/api/v1/instances/${instanceId}`, { credentials: 'include' })
            .then((r) => (r.ok ? (r.json() as Promise<Instance>) : null))
            .then((instance) => {
                if (cancelled || !instance) return;
                setInstanceWorld(instance.world);
            })
            .catch(() => {
                /* 取得失敗時は編集ボタン非表示 */
            });
        return () => {
            cancelled = true;
        };
    }, [instanceId]);

    const editableWorldId =
        instanceWorld && currentUserName && instanceWorld.authorName === currentUserName ? instanceWorld.id : null;

    const userCount = users.size;

    return (
        <>
            {/* 常時表示のステータスバー（右上） */}
            <div
                className={css({
                    position: 'fixed',
                    top: '12px',
                    right: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    zIndex: 10000,
                    pointerEvents: 'auto',
                })}
            >
                {/* 接続状態 + ユーザー数 + メニューボタン */}
                <button
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    className={css({
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        backgroundColor: 'hudBg',
                        backdropFilter: 'blur(6px)',
                        borderRadius: '20px',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'hudText',
                        fontSize: '13px',
                        fontWeight: '500',
                        transition: 'background-color 0.15s ease',
                        _hover: { backgroundColor: 'hudBgHover' },
                    })}
                    aria-label="メニューを開く"
                >
                    {/* 接続インジケーター */}
                    <span
                        className={css({
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            flexShrink: 0,
                            backgroundColor: isConnected ? 'hudStatusOn' : 'hudStatusOff',
                        })}
                    />
                    {/* ユーザー数 */}
                    <span>{userCount} 人</span>
                    {/* ハンバーガーアイコン */}
                    <span
                        className={css({
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                            ml: '2px',
                        })}
                    >
                        {[0, 1, 2].map((i) => (
                            <span
                                key={i}
                                className={css({
                                    display: 'block',
                                    width: '14px',
                                    height: '2px',
                                    backgroundColor: 'hudText',
                                    borderRadius: '1px',
                                })}
                            />
                        ))}
                    </span>
                </button>
            </div>

            {/* メニューパネル */}
            {menuOpen && (
                <>
                    {/* オーバーレイ（パネル外クリックで閉じる） */}
                    <div
                        className={css({
                            position: 'fixed',
                            inset: 0,
                            zIndex: 10001,
                        })}
                        onClick={() => setMenuOpen(false)}
                    />

                    {/* パネル本体 */}
                    <div
                        className={css({
                            position: 'fixed',
                            top: '52px',
                            right: '12px',
                            width: '240px',
                            backgroundColor: 'hudPanel',
                            backdropFilter: 'blur(12px)',
                            borderRadius: '14px',
                            border: '1px solid',
                            borderColor: 'hudBorder',
                            overflow: 'hidden',
                            zIndex: 10002,
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                        })}
                    >
                        {/* ユーザー一覧 */}
                        <div
                            className={css({
                                padding: '12px 14px 8px',
                                borderBottom: '1px solid',
                                borderColor: 'hudDivider',
                            })}
                        >
                            <p
                                className={css({
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: 'hudTextMuted',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    marginBottom: '8px',
                                })}
                            >
                                参加中 {userCount} 人
                            </p>
                            <ul
                                className={css({
                                    listStyle: 'none',
                                    padding: 0,
                                    margin: 0,
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px',
                                    '&::-webkit-scrollbar': { width: '4px' },
                                    '&::-webkit-scrollbar-thumb': {
                                        backgroundColor: 'hudScrollThumb',
                                        borderRadius: '2px',
                                    },
                                })}
                            >
                                {[...users.values()].map((user) => (
                                    <li
                                        key={user.id}
                                        className={css({
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '5px 4px',
                                            borderRadius: '8px',
                                        })}
                                    >
                                        {/* アバターアイコン（名前の頭文字） */}
                                        <span
                                            className={css({
                                                width: '26px',
                                                height: '26px',
                                                borderRadius: '50%',
                                                backgroundColor: 'hudAvatar',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                                color: 'white',
                                                flexShrink: 0,
                                                textTransform: 'uppercase',
                                            })}
                                        >
                                            {user.name.charAt(0)}
                                        </span>
                                        <span
                                            className={css({
                                                fontSize: '13px',
                                                color: 'hudTextBody',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                flex: 1,
                                            })}
                                        >
                                            {user.name}
                                            {user.id === currentUser?.id && (
                                                <span
                                                    className={css({
                                                        ml: '4px',
                                                        fontSize: '10px',
                                                        color: 'hudTextSubtle',
                                                    })}
                                                >
                                                    (あなた)
                                                </span>
                                            )}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* アクション */}
                        <div className={css({ padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px' })}>
                            {editableWorldId && (
                                <button
                                    type="button"
                                    onClick={() => navigate(`/world/${editableWorldId}/edit`)}
                                    className={css({
                                        width: 'full',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '9px 12px',
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        color: 'hudTextAction',
                                        fontSize: '13px',
                                        fontWeight: '500',
                                        transition: 'background-color 0.12s ease',
                                        _hover: { backgroundColor: 'hudActionHover' },
                                    })}
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                    </svg>
                                    このワールドを編集
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => navigate('/user/me')}
                                className={css({
                                    width: 'full',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '9px 12px',
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    color: 'hudTextAction',
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    transition: 'background-color 0.12s ease',
                                    _hover: { backgroundColor: 'hudActionHover' },
                                })}
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                                マイページ
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/')}
                                className={css({
                                    width: 'full',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '9px 12px',
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    color: 'hudTextAction',
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    transition: 'background-color 0.12s ease',
                                    _hover: { backgroundColor: 'hudActionHover' },
                                })}
                            >
                                <span className={css({ fontSize: '16px', lineHeight: 1 })}>←</span>
                                ロビーへ戻る
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
