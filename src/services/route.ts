/**
 * 경로 검색 서비스 (#34)
 *
 * 서버 모드: 명세 6.1 POST /routes/search, mock 모드: 기존 경로를 유지해요.
 * - 요청: { originStationId, destinationStationId, roomId? } (departAt은 보내지 않아요)
 * - 타임아웃: 10초 (명세 6.1, 서버가 카카오 5초 + 대체 경로 계산을 마칠 때까지 기다림)
 */

import { findMockRoutes, MOCK_STATIONS } from '@/mocks/routes';
import { resolveSlot } from '@/services/congestion';
import { post } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import { toCongestion } from '@/types/congestion';
import {
    RouteSearchError,
    type Route,
    type Congestion,
    type RouteErrorCode,
    type RouteSearchRequest,
    type RouteStationCongestion,
    type RouteStep,
    type RouteSummary,
    type RouteSearchResponse,
    type StationSummary,
} from '@/types/route';

const MOCK_DELAY_MS = 800;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** mock 역 목록 검색이에요. 지금 이 함수를 부르는 곳은 없고, 역 검색 화면은 services/station.ts 를 써요. */
export async function fetchStations(keyword = ''): Promise<StationSummary[]> {
    const query = keyword.trim();
    if (!query) return MOCK_STATIONS;
    return MOCK_STATIONS.filter(station => station.name.includes(query));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const LEVELS = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'];
const KINDS = ['PREDICTED', 'ESTIMATED', 'MOCK'];
const WAIT_KINDS = ['REALTIME', 'ESTIMATED', 'NONE', 'TIMETABLE'];

/** 6.1은 kind를 받아요. 데이터 없음은 화면이 안전하게 읽을 수 있는 모양으로 정리해요. */
function parseCongestion(value: unknown): Congestion {
    if (value === null) {
        return toCongestion({ supported: false, kind: null, pct: null, level: null, levelLabel: null });
    }
    if (!isRecord(value)
        || typeof value.supported !== 'boolean'
        || !(value.kind === null || KINDS.includes(value.kind as string))
        || !(value.pct === null || isNumber(value.pct))
        || !(value.level === null || LEVELS.includes(value.level as string))
        || !isNullableString(value.levelLabel)
        || (value.supported && (value.kind === null || value.pct === null || value.level === null || value.levelLabel === null))) {
        throw new ApiError('UNKNOWN_ERROR');
    }
    return toCongestion(value as Congestion);
}

/** 대기 필드는 없으면 그대로 두고, 내려오는 경우에만 타입을 검사해요. */
function validateWait(value: Record<string, unknown>, summary: boolean) {
    if (('waitSec' in value && value.waitSec !== null && !isNumber(value.waitSec))
        || ('waitKind' in value && value.waitKind !== null && !WAIT_KINDS.includes(value.waitKind as string))
        || (summary && 'transferWaitSec' in value && !isNumber(value.transferWaitSec))
        || (summary && 'totalWithWaitSec' in value && value.totalWithWaitSec !== null && !isNumber(value.totalWithWaitSec))
        || (!summary && 'nextTrains' in value && (!Array.isArray(value.nextTrains)
            || !value.nextTrains.every(train => isRecord(train)
                && typeof train.destinationLabel === 'string'
                && isNumber(train.secondsUntil)
                && isNullableString(train.message)
                && typeof train.receivedAt === 'string')))) {
        throw new ApiError('UNKNOWN_ERROR');
    }
}

function parseSummary(value: unknown): RouteSummary {
    if (!isRecord(value)
        || !['totalTimeSec', 'fare', 'transferCount', 'walkingMinutes'].every(key => isNumber(value[key]))
        || typeof value.arrivalAt !== 'string' || !Number.isFinite(Date.parse(value.arrivalAt))
        || !['KAKAO', 'ESTIMATED'].includes(value.fareSource as string)) {
        throw new ApiError('UNKNOWN_ERROR');
    }
    if (['noService', 'arrivesAfterAppointment'].some(key => key in value && typeof value[key] !== 'boolean')
        || ('serviceNotice' in value && !isNullableString(value.serviceNotice))
        || ('departureAt' in value && (typeof value.departureAt !== 'string' || !Number.isFinite(Date.parse(value.departureAt))))) {
        throw new ApiError('UNKNOWN_ERROR');
    }
    validateWait(value, true);
    return {
        ...value,
        noService: value.noService ?? false,
        serviceNotice: value.serviceNotice ?? null,
        arrivesAfterAppointment: value.arrivesAfterAppointment ?? false,
        congestion: parseCongestion(value.congestion),
    } as RouteSummary;
}

function parseStationCongestion(value: unknown): RouteStationCongestion {
    if (!isRecord(value) || !isNumber(value.id) || typeof value.name !== 'string'
        || typeof value.slotStart !== 'string' || !isNullableString(value.slotDate)
        || typeof value.firstTrain !== 'boolean') {
        throw new ApiError('UNKNOWN_ERROR');
    }
    return { ...value, congestion: parseCongestion(value.congestion) } as RouteStationCongestion;
}

function parseStep(value: unknown): RouteStep {
    if (!isRecord(value) || !['WALKING', 'SUBWAY'].includes(value.type as string)
        || typeof value.guidance !== 'string' || !isNumber(value.durationSec) || !isNumber(value.distanceM)
        || !isNullableString(value.direction)
        || !(value.directionCode === null || ['UP', 'DOWN', 'INNER', 'OUTER', 'LOOP'].includes(value.directionCode as string))
        || !((value.line === null && value.type === 'WALKING') || (isRecord(value.line)
            && (value.line.id === null || isNumber(value.line.id))
            && typeof value.line.name === 'string' && isNullableString(value.line.color)))
        || !Array.isArray(value.stops) || !value.stops.every(stop => isRecord(stop)
            && isNumber(stop.id) && typeof stop.name === 'string' && isNumber(stop.order))
        || !(value.path === null || Array.isArray(value.path) && value.path.every(point => Array.isArray(point)
            && point.length === 2 && point.every(isNumber)))
        || !(value.stations === null || Array.isArray(value.stations))) {
        throw new ApiError('UNKNOWN_ERROR');
    }
    validateWait(value, false);
    return { ...value, stations: (value.stations ?? []).map(parseStationCongestion) } as RouteStep;
}

/** station.ts와 같이 unknown 응답을 검사한 뒤 화면 타입으로 넘겨요. 도착 시각 등 서버 값은 계산하지 않아요. */
function parseRouteSearch(value: unknown): RouteSearchResponse {
    if (!isRecord(value) || !['KAKAO', 'INTERNAL'].includes(value.routeSource as string) || !Array.isArray(value.routes)
        || ('appointmentPassed' in value && typeof value.appointmentPassed !== 'boolean')
        || ('notice' in value && !isNullableString(value.notice))) {
        throw new ApiError('UNKNOWN_ERROR');
    }
    return {
        appointmentPassed: (value.appointmentPassed ?? false) as boolean,
        notice: (value.notice ?? null) as string | null,
        routeSource: value.routeSource as RouteSearchResponse['routeSource'],
        routes: value.routes.map(route => {
            if (!isRecord(route) || typeof route.routeId !== 'string'
                || !(route.routeType === null || ['FASTEST', 'FEWER_TRANSFERS', 'CHEAPEST'].includes(route.routeType as string))
                || !Array.isArray(route.steps)) {
                throw new ApiError('UNKNOWN_ERROR');
            }
            return {
                ...route,
                summary: parseSummary(route.summary),
                steps: route.steps.map(parseStep),
            } as Route;
        }),
    };
}

async function searchServerRoute(origin: StationSummary, destination: StationSummary, options: { roomId?: string }) {
    try {
        const body: RouteSearchRequest = {
            originStationId: origin.id,
            destinationStationId: destination.id,
            ...(options.roomId === undefined ? {} : { roomId: options.roomId }),
        };
        return parseRouteSearch(await post<unknown>('/routes/search', body));
    } catch (error) {
        // 인증 갱신·실패 처리는 기존 A-1에 맡기고 화면용 오류로 감싸지 않아요.
        if (error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error))) throw error;
        const code = error instanceof ApiError && ['STATION_UNSUPPORTED', 'ROUTE_NOT_FOUND', 'STATION_NOT_FOUND', 'NOT_ROOM_MEMBER', 'ROOM_NOT_FOUND', 'NETWORK_ERROR'].includes(error.code)
            ? error.code as RouteErrorCode : 'EXTERNAL_API_ERROR';
        const messages = {
            STATION_UNSUPPORTED: '서비스에서 지원하지 않는 역이에요.',
            ROUTE_NOT_FOUND: '지하철 경로를 찾지 못했어요.',
            STATION_NOT_FOUND: '역 정보를 찾지 못했어요.',
            NOT_ROOM_MEMBER: '참여 중인 약속방이 아니에요.',
            ROOM_NOT_FOUND: '삭제됐거나 존재하지 않는 약속방이에요.',
            NETWORK_ERROR: '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
            EXTERNAL_API_ERROR: '경로를 불러오지 못했어요.',
        };
        throw new RouteSearchError(code, messages[code]);
    }
}

export async function searchRoute(
    origin: StationSummary,
    destination: StationSummary,
    options: { roomId?: string } = {},
): Promise<RouteSearchResponse> {
    if (!isMockMode()) return searchServerRoute(origin, destination, options);

    await wait(MOCK_DELAY_MS);

    if (!origin.isSupported || !destination.isSupported) {
        throw new RouteSearchError('STATION_UNSUPPORTED', '서비스에서 지원하지 않는 역이에요.');
    }

    // 동일 역도 정상 상태예요. mock에서는 이동 경로를 만들지 않아요.
    if (origin.id === destination.id) {
        return { appointmentPassed: false, notice: null, routeSource: 'INTERNAL', routes: [] };
    }

    const result = findMockRoutes(origin.name, destination.name);

    if (result.kind === 'error') {
        throw new RouteSearchError('EXTERNAL_API_ERROR', '경로를 불러오지 못했어요.');
    }

    if (result.kind === 'notFound') {
        throw new RouteSearchError('ROUTE_NOT_FOUND', '지하철 경로를 찾지 못했어요.');
    }

    // mock 서버의 도착 시각을 만듭니다. 화면에서는 이 값을 다시 계산하지 않습니다.
    const now = Date.now();
    return {
        ...result.data,
        routes: result.data.routes.map(route => {
            const prepared = withMockWait(withStationSlots(route, now));
            return {
                ...prepared,
                summary: {
                    ...prepared.summary,
                    arrivalAt: new Date(now + (prepared.summary.totalWithWaitSec ?? prepared.summary.totalTimeSec) * 1000).toISOString(),
                },
            };
        }),
    };
}

/** 첫 경로에는 대기 필드를 넣고 나머지는 이전 응답 형태를 유지합니다. */
function withMockWait(route: Route): Route {
    if (route.routeId !== 'r1') return route;
    let subwayIndex = 0;
    const steps = route.steps.map(step => {
        if (step.type !== 'SUBWAY') return step;
        const first = subwayIndex++ === 0;
        return { ...step, waitSec: first ? 180 : 120, waitKind: 'ESTIMATED' as const, nextTrains: [] };
    });
    // 환승 경로는 이동 23분·대기 포함 28분, 직통 경로는 이동 42분·대기 포함 45분입니다.
    const transferWaitSec = route.summary.transferCount > 0 ? 120 : 0;
    const totalWithWaitSec = route.summary.transferCount > 0 ? 1680 : 2700;
    return {
        ...route,
        steps,
        summary: {
            ...route.summary,
            waitSec: 180,
            waitKind: 'ESTIMATED',
            transferWaitSec,
            totalWithWaitSec,
        },
    };
}

/**
 * mock 전용: 각 정차역의 혼잡도 조회 시간대를 채웁니다.
 * 명세 6.2: 역의 시간대 = 출발 예정 시각 + 그 역까지 누적 소요시간이 속한 30분 구간,
 * 05:30 시작(막차 이후 첫차): 운행 시간 밖이면 첫차(05:30) 슬롯 + firstTrain·slotDate.
 * 서버 모드는 서버가 내려준 시간대를 그대로 쓰고 이 함수를 부르지 않아요.
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
