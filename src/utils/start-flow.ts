import type { AuthStatus } from '@/stores/auth-store';

export type StartDestination = '/onboarding-1' | '/home' | '/login';

/**
 * 시작 화면 다음에 갈 곳 (#130)
 *
 * - mock 모드: 항상 온보딩부터(이전과 같아요).
 * - 서버 모드 + 로그인 세션 있음(복원 성공): 홈
 * - 서버 모드 + 세션 없음 + 본 적 없음: 온보딩 → 권한 안내 → 로그인
 * - 서버 모드 + 세션 없음 + 본 적 있음: 로그인
 * 토큰 만료·탈퇴·로그아웃은 기존 처리(auth-gate·resetToLogin)가 로그인으로 보내요.
 */
export function startDestination({ mock, status, seen }: { mock: boolean; status: AuthStatus; seen: boolean }): StartDestination {
    if (mock) return '/onboarding-1';
    if (status === 'signedIn') return '/home';
    return seen ? '/login' : '/onboarding-1';
}
