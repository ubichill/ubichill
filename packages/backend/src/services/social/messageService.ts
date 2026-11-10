/** フレンド同士のメッセージの実体（DB・フレンド・ブロック・通知をつなぐ）。規則は messages.ts と shared の messages.ts。 */
import { directMessageRepository, userFriendRepository } from '@ubichill/db';
import { notificationService, notifyInBackground } from '../notifications/notificationService';
import { hiddenIdsFor, isBlockedBetween } from './blockCheck';
import { createMessageService } from './messages';
import { summariesOf } from './userSummaries';

export const messageService = createMessageService({
    messages: directMessageRepository,
    areFriends: (a, b) => userFriendRepository.areFriends(a, b),
    isBlockedBetween,
    hiddenIdsFor,
    summariesOf,
    notify: notificationService,
    background: notifyInBackground,
    now: () => new Date(),
});
