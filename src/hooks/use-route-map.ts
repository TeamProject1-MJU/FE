import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getSessionGeneration } from '@/services/auth';
import type { Route } from '@/types/route';
import { buildRouteMap } from '@/utils/route-map';

/**
 * 경로 안내 지도 (#129)
 *
 * - 서버 모드에서만 경로를 지도용 값으로 바꿔요. 서버를 더 부르지 않아요.
 * - 지도에서 온 메시지(영역 변경·실패)는 이 화면에 포커스가 있고, 로그인 세대와 계정이 그대로일 때만 처리해요
 *   (use-home-map.ts 와 같은 방식). 처리 결과는 범례를 보일지(지도가 살아 있는지)에만 써요.
 * - 지도 key 에 계정과 경로를 넣어 계정·경로가 바뀌면 지도를 새로 만들고, 새 지도는 한 번만 경로 범위에 맞춰요.
 */
export function useRouteMap(route: Route | null, enabled: boolean, account: string | null) {
    const data = useMemo(() => (enabled && route ? buildRouteMap(route) : null), [enabled, route]);
    const [status, setStatus] = useState<{ failed: boolean; account: string | null }>({ failed: false, account });
    const focused = useRef(false);
    const activeAccount = useRef(account);

    useFocusEffect(useCallback(() => {
        activeAccount.current = account;
        focused.current = true;
        return () => { focused.current = false; };
    }, [account]));

    const handler = useCallback((failed: boolean) => {
        const generation = getSessionGeneration();
        return () => {
            if (!focused.current || generation !== getSessionGeneration() || activeAccount.current !== account) return;
            setStatus(prev => (prev.failed === failed && prev.account === account ? prev : { failed, account }));
        };
    }, [account]);
    const onRegionChange = useMemo(() => handler(false), [handler]);
    const onError = useMemo(() => handler(true), [handler]);

    return {
        data,
        mapKey: `${account ?? ''}:${route?.routeId ?? ''}`,
        /** 새 지도마다 처음 한 번 범위를 맞춰요(지도 key 가 바뀌면 지도도 새로 만들어져요). */
        fitRevision: 1,
        failed: status.account === account && status.failed,
        onRegionChange,
        onError,
    };
}
