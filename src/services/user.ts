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
import { signIn, signOut } from '@/stores/auth-store';
import { clearSelectedRoute } from '@/stores/route-store';

const MOCK_DELAY_MS = 700;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** mock 사용자 (앱이 켜져 있는 동안 닉네임 수정 결과를 기억) */
let mockUser: User = {
    id: '0192f3a4-7b1c-7c3e-9a10-5d2e8f6b1a01',
    nickname: '민지',
    createdAt: '2026-10-02T10:00:00+09:00',
};

/**
 * 닉네임 글자 수 (백엔드와 같은 기준)
 * 명세 부록 A: char_length(btrim(nickname)) → 앞뒤 공백을 빼고 '글자' 단위로 셉니다.
 * JS 의 length 는 이모지 등을 2로 세므로 Array.from 으로 셉니다.
 */
export function nicknameLength(value: string): number {
    return Array.from(value.trim()).length;
}

/** 닉네임 검사 (명세 4.5: 2~20자, 중복 허용 → 중복 검사는 하지 않음) */
export function validateNickname(value: string): string | null {
    const length = nicknameLength(value);
    if (length === 0) return '닉네임을 입력해주세요.';
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

/**
 * 4.5 닉네임 수정 (앞뒤 공백을 뺀 값을 보냅니다)
 * failForTest 가 true 면 저장 실패를 흉내 냅니다(실패 시 입력값 유지 확인용).
 */
export async function updateNickname(nickname: string, failForTest = false): Promise<User> {
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    const message = validateNickname(nickname);
    if (message) throw new UserError('VALIDATION_ERROR', message);
    mockUser = { ...mockUser, nickname: nickname.trim() };
    return mockUser;
}

/** 4.1 카카오 로그인 mock: 로그인 상태로 바꿉니다. TODO: 카카오 SDK + POST /auth/kakao 연동 */
export function mockKakaoLogin() {
    signIn({ userId: mockUser.id, nickname: mockUser.nickname });
}

/**
 * 4.3 로그아웃 (#40)
 * 성공하면 mock 로그인 상태와 이전 사용자의 화면 데이터(선택 경로)를 지웁니다.
 * failForTest 가 true 면 네트워크 실패를 흉내 냅니다(실패 상태 확인용).
 * TODO: POST /auth/logout { refreshToken } 호출, 저장한 Access·Refresh Token 삭제
 */
export async function logout(failForTest = false): Promise<void> {
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '로그아웃하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    signOut();
    clearSelectedRoute();
}

/**
 * 4.6 회원 탈퇴 (#41)
 * 서버: 참여 중인 모든 방에서 나가기(방장이면 승계, 마지막 멤버면 방 삭제) → soft delete → Refresh Token 모두 폐기.
 * 성공하면 mock 로그인 상태와 이전 사용자의 화면 데이터(선택 경로)를 지웁니다.
 * failForTest 가 true 면 실패를 흉내 냅니다(실패 상태 확인용).
 * TODO: DELETE /users/me 호출, 저장한 Access·Refresh Token 삭제
 */
export async function withdraw(failForTest = false): Promise<void> {
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '탈퇴하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    signOut();
    clearSelectedRoute();
}