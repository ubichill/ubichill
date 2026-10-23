import { announcementRepository, notificationRepository } from '@ubichill/db';
import { logger } from '../utils/logger';
import { notificationHub } from './notificationHub';
import { createNotificationService } from './notifications';

/** 本番の DB と hub につないだ通知の窓口。 */
export const notificationService = createNotificationService({
    notifications: notificationRepository,
    announcements: announcementRepository,
    hub: notificationHub,
});

/** 通知の失敗で元の操作（申請・お気に入り）を失敗にしない。 */
export const notifyInBackground = (task: Promise<unknown> | undefined, what: string): void => {
    void task?.catch((err: unknown) => logger.warn(`${what}の通知に失敗しました:`, err));
};
