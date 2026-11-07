/**
 * 로그인 상태 저장소 (#40)
 *
 * route-store 와 같은 방식(모듈 변수)으로 mock 로그인 상태를 관리합니다.
 * TODO: 카카오 로그인(명세 4.1) 연동 시 Access·Refresh Token 을 보안 저장소(iOS Keychain)에 보관하고,
 *       앱 시작 때 저장된 토큰으로 상태를 복원합니다.
 */

import { useEffect } from 'react';
import { router } from 'expo-router';

export type Session = {
    userId: string;
    nickname: string;
};

/**
 * unknown  : 앱을 막 켰거나 웹에서 주소로 바로 연 상태 (개발 중 화면 확인을 위해 막지 않음)
 * signedIn : 로그인함
 * signedOut: 로그아웃·탈퇴함 → 보호 화면에 들어오면 로그인 화면으로 보냄
 */
type AuthStatus = 'unknown' | 'signedIn' | 'signedOut';

let status: AuthStatus = 'unknown';
let session: Session | null = null;

export function signIn(value: Session) {
    session = value;
    status = 'signedIn';
}

export function signOut() {
    session = null;
    status = 'signedOut';
}

export function getSession(): Session | null {
    return session;
}

export function isSignedOut() {
    return status === 'signedOut';
}

/**
 * 로그인 화면으로 이동하면서 이전 화면 기록을 지웁니다.
 * (로그아웃 후 뒤로 가기로 이전 사용자 화면에 돌아가지 않도록)
 */
export function resetToLogin() {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/login');
}

/** 보호 화면(홈·마이 등)에서 호출: 로그아웃한 상태면 로그인 화면으로 보냅니다. */
export function useRedirectIfSignedOut() {
    useEffect(() => {
        if (isSignedOut()) resetToLogin();
    }, []);
}