import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Redirect, usePathname } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useMock } from '@/services/api/config';
import { refreshSession } from '@/services/auth';
import { ApiError, isAuthError } from '@/services/api/errors';
import { hasTokenDeletionFailed, subscribeTokenStorage } from '@/services/token-storage';
import { signOut, startRestoring, useAuthStatus } from '@/stores/auth-store';

let started = false;

/** 로그인 없이 열 수 있는 경로: 시작 화면, 온보딩, 권한 안내, 로그인 */
export function isPublicRoute(pathname: string) {
    return pathname === '/' || pathname === '/login' || pathname === '/permission' || pathname.startsWith('/onboarding-');
}

export default function AuthGate({ children }: { children: ReactNode }) {
    const status = useAuthStatus();
    const pathname = usePathname();
    const [failure, setFailure] = useState('');
    const deletionFailed = useSyncExternalStore(subscribeTokenStorage, hasTokenDeletionFailed, hasTokenDeletionFailed);
    async function restore() {
        startRestoring(); setFailure('');
        try { await refreshSession(); }
        catch (error) {
            if (!isAuthError(error)) setFailure(error instanceof ApiError && error.code === 'REFRESH_UNCERTAIN'
                ? '로그인 갱신 결과를 확인하지 못했어요. 카카오로 다시 로그인해 주세요.'
                : '로그인을 복원하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
        }
    }
    useEffect(() => { if (!useMock() && !started) { started = true; void restore(); } }, []);
    if (useMock()) return children;
    if (status === 'restoring') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        {failure ? <><Text>{failure}</Text><Pressable onPress={() => void restore()}><Text>다시 시도해요</Text></Pressable>
            <Pressable onPress={signOut}><Text>카카오로 다시 로그인해요</Text></Pressable></> : <ActivityIndicator accessibilityLabel="로그인을 복원하고 있어요" />}
    </View>;
    // 로그인 전에도 시작 화면(/)·온보딩·권한 안내·로그인은 열려요(#130). 그 밖은 로그인으로 보내요.
    const publicRoute = isPublicRoute(pathname);
    if (status !== 'signedIn' && !publicRoute) return <Redirect href="/login" />;
    return <>{deletionFailed && <Text accessibilityRole="alert">기기에서 로그인 정보를 지우지 못했어요. 앱을 다시 켜면 로그인이 복원될 수 있어요.</Text>}{children}</>;
}
