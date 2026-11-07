/** ソーシャル API（ユーザー検索・フレンド・フレンドの現在地）。 */
import type {
    Friendship,
    FriendsResponse,
    Instance,
    UserProfileWithFriendship,
    UserSearchResponse,
    UserSummary,
} from '@ubichill/shared';
import { API_BASE } from './api';

export interface FriendLocationsResponse {
    locations: Array<{ instance: Instance; friends: UserSummary[] }>;
    /** 自分に見えないインスタンスにいるフレンド（どこかは出さない） */
    private: UserSummary[];
    /** インスタンスにいないフレンド（オフラインか、部屋の外） */
    elsewhere: UserSummary[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}/api/v1/social${path}`, {
        credentials: 'include',
        cache: 'no-store',
        ...init,
        headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
}

export const searchUsers = (q: string, signal?: AbortSignal) =>
    request<UserSearchResponse>(`/users?q=${encodeURIComponent(q)}`, { signal });

/** ID（`handle` か、ほかのサーバーの人は `handle@domain`）でプロフィールを引く。 */
export const fetchUserByHandle = (handle: string) =>
    request<UserProfileWithFriendship>(`/users/by-handle/${encodeURIComponent(handle)}`);

/** ユーザー ID（ほかのサーバーの人は actor の URL）でプロフィールを引く。 */
export const fetchUserWithFriendship = (userId: string) =>
    request<UserProfileWithFriendship>(`/users/${encodeURIComponent(userId)}`);

export const fetchFriends = () => request<FriendsResponse>('/friends');

export const fetchFriendLocations = () => request<FriendLocationsResponse>('/locations');

/** 申請する（相手から申請が来ていれば承認になる）。 */
export const requestFriend = async (userId: string) =>
    (await request<{ friendship: Friendship }>('/friends', { method: 'POST', body: JSON.stringify({ userId }) }))
        .friendship;

export const acceptFriend = (userId: string) =>
    request<{ friendship: Friendship }>(`/friends/${encodeURIComponent(userId)}/accept`, { method: 'POST' });

/** フレンドの解除・申請の取り消し・拒否。 */
export const removeFriend = (userId: string) =>
    request<void>(`/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' });
