/** フレンド同士のメッセージの実体（DB・フレンド・ブロック・通知をつなぐ）。規則は messages.ts と shared の messages.ts。 */
import { directMessageRepository, userFriendRepository } from '@ubichill/db';
import { notificationService, notifyInBackground } from '../../notifications/notificationService';
import { hiddenIdsFor, isBlockedBetween } from '../blocks/blockCheck';
import { summariesOf } from '../userSummaries';
import { createMessageService } from './messages';

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
