/** フレンド同士のメッセージの実体（DB・フレンド・通知をつなぐ）。規則は messages.ts と shared の messages.ts。 */
import { directMessageRepository, userFriendRepository } from '@ubichill/db';
import { notificationService, notifyInBackground } from '../notifications/notificationService';
import { createMessageService } from './messages';
import { summariesOf } from './userSummaries';

export const messageService = createMessageService({
    messages: directMessageRepository,
    areFriends: (a, b) => userFriendRepository.areFriends(a, b),
    summariesOf,
    notify: notificationService,
    background: notifyInBackground,
    now: () => new Date(),
});
