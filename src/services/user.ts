import { useMock } from '@/services/api/config';
import { get, patch, delete as apiDelete } from '@/services/api/client';
import { ApiError } from '@/services/api/errors';
import { clearLocalSession, getSessionGeneration, logoutSession } from '@/services/auth';
import { mockUser, setMockUser } from '@/mocks/user';
/**
 * 사용자 서비스 (#38, API 명세 v1.12 4.3~4.6)
 *
 * 서버 모드는 /users/me 조회·수정·탈퇴를 호출하고, mock 모드는 기존 동작을 유지해요.
 * 인증 오류와 재발급은 공통 클라이언트에서 처리해요.
 */

import {
    NICKNAME_MAX,
    NICKNAME_MIN,
    UserError,
    type User,
    type UserProfile,
} from '@/types/user';
import { signIn, signOut, updateSession } from '@/stores/auth-store';
import { clearSelectedRoute } from '@/stores/route-store';

const MOCK_DELAY_MS = 700;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function parseProfile(value: unknown): UserProfile {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const profile = value as Record<string, unknown>;
        if (typeof profile.id === 'string' && typeof profile.nickname === 'string') {
            return { id: profile.id, nickname: profile.nickname };
        }
    }
    throw new ApiError('UNKNOWN_ERROR');
}

function parseUser(value: unknown): User {
    const profile = parseProfile(value);
    const createdAt = (value as Record<string, unknown>).createdAt;
    if (typeof createdAt !== 'string') throw new ApiError('UNKNOWN_ERROR');
    return { ...profile, createdAt };
}

function syncProfile(profile: UserProfile, generation: number) {
    if (generation !== getSessionGeneration()) throw new ApiError('AUTH_REQUIRED');
    updateSession({ userId: profile.id, nickname: profile.nickname });
}

/**
 * 닉네임 앞뒤 공백 제거 (백엔드와 같은 기준)
 * Java String.strip()과 같은 기준으로 앞뒤 공백을 제거합니다.
 */
export function stripNickname(value: string): string {
    // Java Character.isWhitespace; preserves NBSP, U+2007, U+202F and BOM.
    return value.replace(/^[\u0009-\u000D\u001C-\u0020\u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]+|[\u0009-\u000D\u001C-\u0020\u1680\u2000-\u2006\u2008-\u200A\u2028\u2029\u205F\u3000]+$/g, '');
}

/** Counts code points after Java-compatible stripping. */
export function nicknameLength(value: string): number {
    return Array.from(stripNickname(value)).length;
}

/** 닉네임 검사 (명세 4.5: 2~20자, 중복 허용 → 중복 검사는 하지 않음) */
export function validateNickname(value: string): string | null {
    const stripped = stripNickname(value);
    if (stripped.includes('\u0000')) return '닉네임에 사용할 수 없는 문자가 있어요.';
    const length = nicknameLength(stripped);
    if (length === 0) return '닉네임을 입력해주세요.';
    if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
        return `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해주세요.`;
    }
    return null;
}

/** 4.4 내 정보. failForTest는 mock 모드의 조회 실패·재시도 확인에만 사용해요. */
export async function fetchMe(failForTest = false): Promise<User> {
    if (!useMock()) {
        const generation = getSessionGeneration();
        const user = parseUser(await get<unknown>('/users/me'));
        syncProfile(user, generation);
        return user;
    }
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '내 정보를 불러오지 못했어요.');
    return mockUser;
}

/**
 * 4.5 닉네임 수정 (앞뒤 공백을 뺀 값을 보냅니다)
 * failForTest는 mock 모드의 저장 실패·입력값 유지 확인에만 사용해요.
 */
export async function updateNickname(nickname: string, failForTest = false): Promise<UserProfile> {
    const message = validateNickname(nickname);
    if (!useMock()) {
        if (message) throw new UserError('VALIDATION_ERROR', message);
        const generation = getSessionGeneration();
        const profile = parseProfile(await patch<unknown>('/users/me', { nickname: stripNickname(nickname) }));
        syncProfile(profile, generation);
        return profile;
    }
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    if (message) throw new UserError('VALIDATION_ERROR', message);
    setMockUser({ ...mockUser, nickname: stripNickname(nickname) });
    return mockUser;
}

/** 화면 확인용 mock 로그인 상태로 바꿔요. */
export function mockKakaoLogin() {
    signIn({ userId: mockUser.id, nickname: mockUser.nickname });
}

/**
 * 4.3 로그아웃 (#40)
 * 성공하면 로그인 상태와 이전 사용자의 선택 경로를 지워요.
 * failForTest 가 true 면 네트워크 실패를 흉내 냅니다(실패 상태 확인용).
 */
export async function logout(failForTest = false): Promise<void> {
    if (!useMock()) {
        await logoutSession();
        clearSelectedRoute();
        return;
    }
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '로그아웃하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    signOut();
    clearSelectedRoute();
}

/**
 * 4.6 회원 탈퇴 (#41)
 * 서버: 참여 중인 모든 방에서 나가기(방장이면 승계, 마지막 멤버면 방 삭제) → soft delete → Refresh Token 모두 폐기.
 * 성공하면 로컬 인증과 이전 사용자의 선택 경로를 지워요.
 * failForTest는 mock 모드의 탈퇴 실패 확인에만 사용해요.
 */
export async function withdraw(failForTest = false): Promise<void> {
    if (!useMock()) {
        const generation = getSessionGeneration();
        await apiDelete('/users/me');
        if (generation !== getSessionGeneration()) throw new ApiError('AUTH_REQUIRED');
        await clearLocalSession(generation);
        return;
    }
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new UserError('NETWORK_ERROR', '탈퇴하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    signOut();
    clearSelectedRoute();
}
