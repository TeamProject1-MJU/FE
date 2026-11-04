/**
 * 경로 탐색 → 경로 안내 화면으로 선택한 경로를 넘기는 저장소 (#34)
 *
 * 명세 6.1: "프론트는 사용자가 고른 route 객체를 경로 안내 화면에 그대로 넘긴다."
 * expo-router params 는 문자열만 넘길 수 있어서, route 객체는 여기에 두고
 * 화면 이동 시에는 routeId 만 넘깁니다.
 */

import type { Route, RouteSource, StationSummary } from '@/types/route';

export type SelectedRoute = {
    route: Route;
    routeSource: RouteSource;
    origin: StationSummary;
    destination: StationSummary;
};

let selected: SelectedRoute | null = null;

export function setSelectedRoute(value: SelectedRoute) {
    selected = value;
}

export function getSelectedRoute(routeId?: string): SelectedRoute | null {
    if (!selected) return null;
    if (routeId && selected.route.routeId !== routeId) return null;
    return selected;
}