import { post, setAccessTokenProvider, setTokenRefresher, setAuthFailureHandler, setSessionGenerationProvider } from '@/services/api/client';
import { useMock } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import { getKakaoAccessToken } from '@/services/kakao';
import { clearTokens, getAccessToken, readRefreshToken, saveTokens } from '@/services/token-storage';
import { getSession, resetToLogin, signIn, signOut } from '@/stores/auth-store';
import { mockUser } from '@/mocks/user';
import { clearSelectedRoute } from '@/stores/route-store';

let generation = 0;
/** 이전 로그인에서 시작한 사용자 요청의 늦은 응답을 구분해요. */
export function getSessionGeneration() { return generation; }
let pending: { generation: number; promise: Promise<void> } | null = null;
let uncertain = false;
const stale = () => new ApiError('AUTH_REQUIRED');
function parseTokens(value: unknown) {
    const v = value as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || Array.isArray(v)
        || typeof v.accessToken !== 'string' || !v.accessToken
        || typeof v.refreshToken !== 'string' || !v.refreshToken
        || typeof v.accessTokenExpiresIn !== 'number' || !Number.isFinite(v.accessTokenExpiresIn) || v.accessTokenExpiresIn <= 0) {
        throw new ApiError('UNKNOWN_ERROR');
    }
    return { accessToken: v.accessToken, refreshToken: v.refreshToken, accessTokenExpiresIn: v.accessTokenExpiresIn };
}
async function invalidate(expected: number, navigate: boolean) {
    if (expected !== generation) return;
    generation++; uncertain = false;
    const cleared = clearTokens();
    signOut();
    clearSelectedRoute();
    if (navigate) resetToLogin();
    await cleared;
}
/** 서버가 탈퇴를 완료한 뒤 로컬 인증만 정리해요. 로그아웃 API는 호출하지 않아요. */
export function clearLocalSession(expected: number = generation): Promise<void> {
    return invalidate(expected, true);
}
export async function loginWithKakao(): Promise<void> {
    const current = ++generation;
    uncertain = false;
    await clearTokens();
    if (useMock()) {
        if (current === generation) signIn({ userId: mockUser.id, nickname: mockUser.nickname });
        return;
    }
    if (current !== generation) throw stale();
    signOut();
    const kakaoAccessToken = await getKakaoAccessToken();
    if (current !== generation) throw stale();
    const raw = await post<unknown>('/auth/kakao', { kakaoAccessToken }, { auth: false });
    if (current !== generation) throw stale();
    const tokens = parseTokens(raw);
    const value = raw as { user?: { id?: unknown; nickname?: unknown }; isNewUser?: unknown };
    if (!value.user || typeof value.user.id !== 'string' || typeof value.user.nickname !== 'string' || typeof value.isNewUser !== 'boolean') throw new ApiError('UNKNOWN_ERROR');
    if (!await saveTokens(tokens.accessToken, tokens.refreshToken, () => current === generation)) {
        if (current === generation) { await invalidate(current, false); throw new ApiError('TOKEN_STORAGE_ERROR'); }
        throw stale();
    }
    if (current !== generation) throw stale();
    signIn({ userId: value.user.id, nickname: value.user.nickname });
}
export function refreshSession(): Promise<void> {
    if (useMock()) return Promise.resolve();
    if (pending?.generation === generation) return pending.promise;
    const current = generation;
    const promise = (async () => {
        // 응답 유실 뒤 같은 회전 토큰을 자동 재전송하지 않고 카카오 재로그인을 요청해요.
        if (uncertain) throw new ApiError('REFRESH_UNCERTAIN');
        const refreshToken = await readRefreshToken();
        if (current !== generation) throw stale();
        if (!refreshToken) { await invalidate(current, false); throw stale(); }
        try {
            const raw = await post<unknown>('/auth/refresh', { refreshToken }, { auth: false });
            if (current !== generation) throw stale();
            const tokens = parseTokens(raw);
            if (!await saveTokens(tokens.accessToken, tokens.refreshToken, () => current === generation)) {
                if (current === generation) { await invalidate(current, false); throw new ApiError('TOKEN_STORAGE_ERROR'); }
                throw stale();
            }
            if (current !== generation) throw stale();
            signIn(getSession() ?? { userId: null, nickname: null });
        } catch (error) {
            if (current === generation) {
                if (isAuthError(error)) await invalidate(current, true);
                else if (error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'UNKNOWN_ERROR')) uncertain = true;
            }
            throw error;
        }
    })();
    pending = { generation: current, promise };
    void promise.finally(() => { if (pending?.promise === promise) pending = null; }).catch(() => {});
    return promise;
}
export async function logoutSession(): Promise<{ server: 'success' | 'failed' | 'skipped'; storageCleared: boolean }> {
    const current = ++generation;
    uncertain = false;
    const refresh = readRefreshToken();
    const cleared = clearTokens();
    signOut();
    let server: 'success' | 'failed' | 'skipped' = 'skipped';
    if (!useMock()) resetToLogin();
    try {
        const refreshToken = await refresh;
        if (refreshToken && !useMock()) {
            await post('/auth/logout', { refreshToken }, { auth: false });
            server = 'success';
        }
    } catch { server = 'failed'; }
    const storageCleared = await cleared;
    if (current === generation) signOut();
    return { server, storageCleared };
}
setAccessTokenProvider(getAccessToken);
setSessionGenerationProvider(() => generation);
setTokenRefresher(refreshSession);
setAuthFailureHandler(() => invalidate(generation, true));
