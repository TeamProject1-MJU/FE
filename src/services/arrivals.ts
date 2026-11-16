/**
 * 실시간 도착정보 서비스 (#95, API 명세 6.3 GET /stations/{stationId}/arrivals)
 *
 * - 서버 모드: GET /stations/{stationId}/arrivals 를 부르고 응답을 unknown 으로 받아 검사해요. mock 인자는 무시해요.
 * - mock 모드: 아래 fetchMockArrivals 로 서버 응답을 흉내 내요. 'none'·'fail' 인자도 그대로 써요.
 * - available:false 는 오류가 아닌 정상 응답이에요. trains 는 빈 배열로 돌려주고, 화면은 "다음 열차" 줄만 숨겨요.
 * - 서버는 (역, 노선)별로 10~20초 캐시하고 일일 호출 한도가 있어요. 폴링 간격은 부르는 쪽(NextTrains, 20초)이 지켜요.
 */

import { get } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError } from '@/services/api/errors';
import type { ArrivalsQuery, ArrivalsResponse, ArrivalTrain } from '@/types/arrivals';
import type { DirectionCode } from '@/types/congestion';

/* ---------- 요청·응답 검사 ---------- */

type ArrivalsReason = NonNullable<ArrivalsResponse['reason']>;

const DIRECTIONS: readonly DirectionCode[] = ['UP', 'DOWN', 'INNER', 'OUTER', 'LOOP'];
const REASONS: readonly ArrivalsReason[] = ['UNSUPPORTED_STATION', 'NO_DATA', 'UPSTREAM_ERROR', 'DISABLED'];
const DEFAULT_LIMIT = 2;
const MIN_LIMIT = 1;
const MAX_LIMIT = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** limit 은 1~5 로 맞춰요. 숫자가 아니면 서버 기본값과 같은 2 예요. */
function clampLimit(limit: number) {
    const value = Math.trunc(limit);
    return Number.isFinite(value) ? Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, value)) : DEFAULT_LIMIT;
}

const invalid = (message: string) => new ApiError('VALIDATION_ERROR', message, null, 400);

/** 잘못된 ID 로 /stations/NaN/arrivals 같은 요청이 나가지 않도록 보내기 전에 막아요. */
function validateQuery(query: ArrivalsQuery) {
    if (!isId(query.stationId) || !isId(query.lineId)) throw invalid('역 또는 노선 정보를 확인해 주세요.');
    if (query.nextStationId !== undefined && !isId(query.nextStationId)) throw invalid('다음 역 정보를 확인해 주세요.');
    if (query.directionCode !== undefined && !isOneOf(DIRECTIONS, query.directionCode)) throw invalid('방향 값을 확인해 주세요.');
}

/**
 * 실서버 응답 기준으로 화면이 쓰는 값(행선지·secondsUntil·message)만 필수로 검사해요.
 * - secondsUntil 은 숫자 또는 null(알 수 없음, 예: "[N]번째 전역"), message 는 서버 arvlMsg2 원문 문자열이에요(null 도 받아요).
 * - 행선지는 destinationName, 없으면 이전 이름 destinationLabel 을 같은 값으로 받아요(혼잡도의 source/kind 처럼).
 * - directionCode 는 없으면 null, 있으면 5개 값 또는 null 이어야 해요.
 * - stopsAway·lastTrain·express 는 화면에서 쓰지 않아 형식이 맞을 때만 담고, 없거나 다르면 빼요.
 */
function parseTrain(value: unknown): ArrivalTrain {
    if (isRecord(value)) {
        const destinationName = typeof value.destinationName === 'string' ? value.destinationName
            : typeof value.destinationLabel === 'string' ? value.destinationLabel : null;
        const directionCode = value.directionCode === undefined ? null : value.directionCode;
        if (
            destinationName !== null
            && (directionCode === null || isOneOf(DIRECTIONS, directionCode))
            && (value.secondsUntil === null || isNumber(value.secondsUntil))
            && isNullableString(value.message)
        ) {
            return {
                destinationName,
                directionCode,
                secondsUntil: value.secondsUntil,
                message: value.message,
                ...(value.stopsAway === null || isNumber(value.stopsAway) ? { stopsAway: value.stopsAway } : {}),
                ...(typeof value.lastTrain === 'boolean' ? { lastTrain: value.lastTrain } : {}),
                ...(typeof value.express === 'boolean' ? { express: value.express } : {}),
            };
        }
    }
    throw new ApiError('UNKNOWN_ERROR');
}

/** 화면이 쓰는 필드가 빠졌거나 형식이 다른 응답은 UNKNOWN_ERROR 로 알려요. */
function parseArrivals(value: unknown): ArrivalsResponse {
    if (isRecord(value) && typeof value.available === 'boolean') {
        // 실서버는 stationId·lineId 를 보내지 않아요. 화면에서 쓰지 않으므로 숫자로 올 때만 담아요.
        const base = {
            ...(isNumber(value.stationId) ? { stationId: value.stationId } : {}),
            ...(isNumber(value.lineId) ? { lineId: value.lineId } : {}),
        };
        // 도착정보 없음은 정상 응답이에요. reason 만 확인하고 열차는 들여다보지 않아요.
        if (!value.available) {
            if (isOneOf(REASONS, value.reason)) {
                return {
                    ...base,
                    available: false,
                    reason: value.reason,
                    receivedAt: typeof value.receivedAt === 'string' ? value.receivedAt : null,
                    trains: [],
                };
            }
        } else if (
            // receivedAt 은 서버 캐시 시각이라 남은 시간 계산에 쓰지 않아요(기준은 format.ts arrivalsCountdownBase, #173). 형식만 검사해요.
            // reason 은 available:true 면 null 이라 들여다보지 않아요.
            typeof value.receivedAt === 'string'
            && Number.isFinite(Date.parse(value.receivedAt))
            && Array.isArray(value.trains)
        ) {
            return {
                ...base,
                available: true,
                reason: null,
                receivedAt: value.receivedAt,
                trains: value.trains.map(parseTrain),
            };
        }
    }
    throw new ApiError('UNKNOWN_ERROR');
}

/* ---------- 조회 ---------- */

/**
 * 확인용 mock 상태 (mock 모드에서만, 서버 모드에서는 무시해요)
 * - 'none': available:false 응답 (줄 숨김)
 * - 'fail': 호출 실패 (줄 숨김)
 */
export type ArrivalsMock = 'none' | 'fail';

/**
 * 명세 6.3 GET /stations/{stationId}/arrivals
 * lineId 는 항상 보내고, nextStationId·directionCode·limit 은 값이 있을 때만 보내요(limit 은 1~5).
 * 오류는 서버 code 를 그대로 전달해요. 401 계열은 공통 클라이언트(A-1)가 처리한 뒤 던져요.
 */
export async function fetchArrivals(query: ArrivalsQuery, mock?: ArrivalsMock): Promise<ArrivalsResponse> {
    if (isMockMode()) return fetchMockArrivals(query, mock);

    validateQuery(query);
    const { stationId, lineId, nextStationId, directionCode, limit } = query;
    return parseArrivals(await get<unknown>(`/stations/${stationId}/arrivals`, {
        query: {
            lineId,
            ...(nextStationId !== undefined ? { nextStationId } : {}),
            ...(directionCode !== undefined ? { directionCode } : {}),
            ...(limit !== undefined ? { limit: clampLimit(limit) } : {}),
        },
    }));
}

/* ---------- mock ---------- */

/** 같은 승차 조건은 같은 열차 도착 시각을 공유하는 모듈 수준 mock 상태입니다. */
const arrivalTimes = new Map<string, number>();

async function fetchMockArrivals(query: ArrivalsQuery, mock?: ArrivalsMock): Promise<ArrivalsResponse> {
    await new Promise(resolve => setTimeout(resolve, 400));
    if (mock === 'fail') throw new Error('도착정보를 불러오지 못했어요.');
    // 실서버와 같은 모양이에요(stationId·lineId 없음).
    if (mock === 'none') {
        return { available: false, reason: 'NO_DATA', receivedAt: null, trains: [] };
    }

    const now = Date.now();
    const key = `${query.stationId}:${query.lineId}:${query.nextStationId ?? ''}:${query.directionCode ?? ''}`;
    let firstAt = arrivalTimes.get(key) ?? now + 182000;
    while (firstAt < now) firstAt += 240000;
    arrivalTimes.set(key, firstAt);
    const limit = Math.max(1, Math.min(5, Math.trunc(query.limit ?? 2) || 2));
    const destinationName = query.lineId === 7 ? '석남' : query.lineId === 4 ? '진접' : '성수';
    return {
        available: true,
        reason: null,
        receivedAt: new Date(now).toISOString(),
        trains: Array.from({ length: limit }, (_, index) => {
            const secondsUntil = Math.max(0, Math.ceil((firstAt - now) / 1000)) + index * 240;
            return {
                destinationName,
                directionCode: query.directionCode ?? null,
                secondsUntil,
                stopsAway: null,
                // 실서버처럼 arvlMsg2 원문 모양의 문구를 항상 채워요. 화면은 secondsUntil 이 있으면 이 문구를 쓰지 않아요.
                message: `${Math.floor(secondsUntil / 60)}분 ${secondsUntil % 60}초 후`,
                lastTrain: false,
                express: false,
            };
        }),
    };
}
