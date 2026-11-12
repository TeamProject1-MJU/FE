import { useEffect, useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { useMock } from '@/services/api/config';

export type Session = { userId: string; nickname: string } | { userId: null; nickname: null };
export type AuthStatus = 'unknown' | 'restoring' | 'signedIn' | 'signedOut';
let status: AuthStatus = useMock() ? 'unknown' : 'restoring';
let session: Session | null = null;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(fn => fn()); }
export function subscribeAuthState(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function signIn(value: Session) { session = value; status = 'signedIn'; emit(); }
/** 인증 상태는 유지하고 서버에서 확인한 내 정보만 갱신해요. */
export function updateSession(value: { userId: string; nickname: string }) {
    if (status !== 'signedIn') return;
    session = value;
    emit();
}
export function signOut() { session = null; status = 'signedOut'; emit(); }
export function startRestoring() { status = 'restoring'; emit(); }
export function getSession() { return session; }
export function getAuthStatus() { return status; }
export function useAuthStatus() {
    return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getAuthStatus, getAuthStatus);
}
export function isSignedOut() { return status === 'signedOut'; }
export function resetToLogin() {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/login');
}
export function useRedirectIfSignedOut() {
    useEffect(() => { if (isSignedOut() && useMock()) resetToLogin(); }, []);
}
