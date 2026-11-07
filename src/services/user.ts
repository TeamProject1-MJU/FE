/**
 * 사용자 서비스 (#38, API 명세 v1.12 4.3~4.6)
 *
 * TODO: 백엔드 연동 시 아래 API 호출로 교체합니다.
 * - GET    /users/me     내 정보 { id, nickname, createdAt }
 * - PATCH  /users/me     닉네임 수정 { nickname } (2~20자, 중복 허용, 오류 VALIDATION_ERROR)
 * - POST   /auth/logout  { refreshToken } (Authorization 헤더 없음, 앱은 저장한 토큰을 모두 지움)
 * - DELETE /users/me     회원 탈퇴
 *
 * 지금은 실제 조회·토큰 저장·계정 API 없이 mock 으로 화면 흐름만 확인합니다.
 */

import {
    NICKNAME_MAX,
    NICKNAME_MIN,
    UserError,
    type User,
} from '@/types/user';

const MOCK_DELAY_MS = 700;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** mock 사용자 (앱이 켜져 있는 동안 닉네임 수정 결과를 기억) */
let mockUser: User = {
    id: '0192f3a4-7b1c-7c3e-9a10-5d2e8f6b1a01',
    nickname: '민지',
    createdAt: '2026-10-02T10:00:00+09:00',
};

/** 닉네임 검사 (서버도 같은 규칙으로 검사합니다) */
export function validateNickname(value: string): string | null {
    const length = value.trim().length;
    if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
        return `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해주세요.`;
    }
    return null;
}

/** 4.4 내 정보. failForTest 가 true 면 조회 실패를 흉내 냅니다(실패·재시도 화면 확인용). */
export async function fetchMe(failForTest = false): Promise<User> {
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '내 정보를 불러오지 못했어요.');
    return mockUser;
}

/** 4.5 닉네임 수정 */
export async function updateNickname(nickname: string): Promise<User> {
    await wait(MOCK_DELAY_MS);
    const message = validateNickname(nickname);
    if (message) throw new UserError('VALIDATION_ERROR', message);
    mockUser = { ...mockUser, nickname: nickname.trim() };
    return mockUser;
}

/** 4.3 로그아웃. TODO: 저장한 Access·Refresh Token 삭제 */
export async function logout(): Promise<void> {
    await wait(MOCK_DELAY_MS);
}

/** 4.6 회원 탈퇴. TODO: 저장한 토큰 삭제 */
export async function withdraw(): Promise<void> {
    await wait(MOCK_DELAY_MS);
}