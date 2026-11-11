import type { User } from '@/types/user';

/** mock 로그인과 사용자 서비스가 같은 프로필을 사용해요. */
export let mockUser: User = {
    id: '0192f3a4-7b1c-7c3e-9a10-5d2e8f6b1a01',
    nickname: '민지',
    createdAt: '2026-10-02T10:00:00+09:00',
};
export function setMockUser(user: User) { mockUser = user; }
