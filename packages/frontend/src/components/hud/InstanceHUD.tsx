import { useSocket } from '@ubichill/sdk/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/styled-system/css';

export function InstanceHUD() {
    const navigate = useNavigate();
    const { users, isConnected, currentUser } = useSocket();
    const [menuOpen, setMenuOpen] = useState(false);

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
                        <div className={css({ padding: '8px' })}>
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
