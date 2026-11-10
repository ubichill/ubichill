/**
 * ユーザー（`/api/v1/users`）。機能ごとのファイルをつなぐ。プロフィールの編集は routes/profiles、ホームは routes/home。
 * 順番に意味がある: `/:userId` は `/me` にも当たるので、ほかの人に見せる分（public）を最後に置く。
 */
import { Router } from 'express';
import { router as account } from './account';
import { router as favorites } from './favorites';
import { router as privacy } from './privacy';
import { router as publicUser } from './public';
import { router as publishingEnvironments } from './publishingEnvironments';
import { router as registration } from './registration';
import { router as works } from './works';

export const router = Router();

router.use(registration, account, publishingEnvironments, works, favorites, privacy, publicUser);
