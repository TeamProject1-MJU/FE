/**
 * 경로 검색 서비스 (#34)
 *
 * TODO: 백엔드 연동 시 POST /routes/search 호출로 교체합니다.
 * - 요청: { originStationId, destinationStationId }
 * - 타임아웃: 10초 (명세 6.1, 서버가 카카오 5초 + 대체 경로 계산을 마칠 때까지 기다림)
 */

import { findMockRoutes, MOCK_STATIONS } from '@/mocks/routes';
import {
    RouteSearchError,
    type RouteSearchResponse,
    type StationSummary,
} from '@/types/route';

const MOCK_DELAY_MS = 800;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 역 선택용 목록 (공통 역 검색 화면 연동 전까지 mock) */
export async function fetchStations(keyword = ''): Promise<StationSummary[]> {
    const query = keyword.trim();
    if (!query) return MOCK_STATIONS;
    return MOCK_STATIONS.filter(station => station.name.includes(query));
}

export async function searchRoute(
    origin: StationSummary,
    destination: StationSummary,
): Promise<RouteSearchResponse> {
    await wait(MOCK_DELAY_MS);

    if (!origin.isSupported || !destination.isSupported) {
        throw new RouteSearchError('STATION_UNSUPPORTED', '서비스에서 지원하지 않는 역이에요.');
    }

    const result = findMockRoutes(origin.name, destination.name);

    if (result.kind === 'error') {
        throw new RouteSearchError('EXTERNAL_API_ERROR', '경로를 불러오지 못했어요.');
    }

    if (result.kind === 'notFound') {
        throw new RouteSearchError('ROUTE_NOT_FOUND', '지하철 경로를 찾지 못했어요.');
    }

    // 도착 시각 = 지금 + 소요 시간 (명세: summary.arrivalAt = departAt(생략 시 현재 시각) + totalTimeSec)
    const now = Date.now();
    return {
        ...result.data,
        routes: result.data.routes.map(route => ({
            ...route,
            summary: {
                ...route.summary,
                arrivalAt: new Date(now + route.summary.totalTimeSec * 1000).toISOString(),
            },
        })),
    };
}