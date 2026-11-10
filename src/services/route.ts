/**
 * 경로 검색 서비스 (#34)
 *
 * TODO: 백엔드 연동 시 POST /routes/search 호출로 교체합니다.
 * - 요청: { originStationId, destinationStationId }
 * - 타임아웃: 10초 (명세 6.1, 서버가 카카오 5초 + 대체 경로 계산을 마칠 때까지 기다림)
 */

import { findMockRoutes, MOCK_STATIONS } from '@/mocks/routes';
import { resolveSlot } from '@/services/congestion';
import {
    RouteSearchError,
    type Route,
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
            ...withMockWait(withStationSlots(route, now)),
            summary: {
                ...withMockWait(route).summary,
                arrivalAt: new Date(now + route.summary.totalTimeSec * 1000).toISOString(),
            },
        })),
    };
}

/** 첫 경로에는 대기 필드를 넣고 나머지는 이전 응답 형태를 유지합니다. */
function withMockWait(route: Route): Route {
    if (route.routeId !== 'r1') return route;
    let subwayIndex = 0;
    const steps = route.steps.map(step => {
        if (step.type !== 'SUBWAY') return step;
        const first = subwayIndex++ === 0;
        return { ...step, waitSec: first ? 182 : 120, waitKind: 'ESTIMATED' as const, nextTrains: [] };
    });
    const transferWaitSec = Math.max(0, subwayIndex - 1) * 120;
    return {
        ...route,
        steps,
        summary: {
            ...route.summary,
            waitSec: 182,
            waitKind: 'ESTIMATED',
            transferWaitSec,
            totalWithWaitSec: route.summary.totalTimeSec + 182 + transferWaitSec,
        },
    };
}

/**
 * mock 전용: 각 정차역의 혼잡도 조회 시간대를 채웁니다.
 * 명세 6.2: 역의 시간대 = 출발 예정 시각 + 그 역까지 누적 소요시간이 속한 30분 구간,
 * 06:00~23:00 밖이면 첫차(06:00) 슬롯 + firstTrain·slotDate.
 * 실제 연동 후에는 서버가 내려주므로 필요 없습니다.
 */
function withStationSlots(route: Route, departAt: number): Route {
    let elapsedSec = 0;

    const steps = route.steps.map(step => {
        const startSec = elapsedSec;
        elapsedSec += step.durationSec;
        if (!step.stations?.length) return step;

        const gaps = Math.max(step.stations.length - 1, 1);
        return {
            ...step,
            stations: step.stations.map((station, index) => {
                const passAt = new Date(departAt + (startSec + (step.durationSec * index) / gaps) * 1000);
                const { slotStart, slotDate, firstTrain } = resolveSlot(passAt);
                return { ...station, slotStart, slotDate: slotDate ?? '', firstTrain };
            }),
        };
    });

    return { ...route, steps };
}
