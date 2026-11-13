/**
 * 마이페이지 앱 권한 표시 (#130)
 *
 * 권한은 서버 데이터가 아니라 기기 상태예요. mock·서버 모드 모두 실제 조회 결과를 표시 상태로 바꿔요.
 */
export type AppPermissionKey = 'camera' | 'location';
export type AppPermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';

export const APP_PERMISSIONS: { key: AppPermissionKey; label: string }[] = [
    { key: 'camera', label: '카메라' },
    { key: 'location', label: '위치' },
];

/** expo 권한 응답({ status, granted }) → 표시 상태. 응답이 없거나 형식이 틀리면 확인할 수 없음이에요. */
export function toPermissionState(response: unknown): AppPermissionState {
    if (!response || typeof response !== 'object') return 'unknown';
    const { status, granted } = response as { status?: unknown; granted?: unknown };
    if (status === 'granted' || (status === undefined && granted === true)) return 'granted';
    if (status === 'denied') return 'denied';
    if (status === 'undetermined') return 'undetermined';
    return 'unknown';
}

/** 상태별 글자·안내·누를 때 동작 */
export const PERMISSION_DISPLAY: Record<AppPermissionState, { text: string; hint: string; action: 'settings' | 'request' | 'refresh'; spoken: string }> = {
    granted: { text: '허용', hint: '', action: 'settings', spoken: '허용, 설정 열기' },
    denied: { text: '허용 안 함', hint: '설정에서 바꿀 수 있어요', action: 'settings', spoken: '허용 안 함, 설정에서 바꿀 수 있어요. 설정 열기' },
    undetermined: { text: '아직 묻지 않음', hint: '눌러서 허용할 수 있어요', action: 'request', spoken: '아직 묻지 않음, 눌러서 권한 요청' },
    unknown: { text: '확인할 수 없음', hint: '눌러서 다시 확인해요', action: 'refresh', spoken: '확인할 수 없음, 눌러서 다시 확인' },
};

export function permissionAccessibilityLabel(label: string, state: AppPermissionState | 'loading') {
    return state === 'loading' ? `${label} 권한 확인 중` : `${label} 권한 ${PERMISSION_DISPLAY[state].spoken}`;
}
