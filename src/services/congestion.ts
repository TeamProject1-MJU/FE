/**
 * 혼잡도 조회 서비스 (#36, #86, API 명세 v1.12 6.2 GET /congestion)
 *
 * - 서버 모드: GET /congestion 을 부르고 응답을 검사해요. 응답은 toCongestion() 으로 6.1 과 같은 모양으로 바꿔 화면에 넘겨요.
 * - mock 모드: 아래 resolveSlot 규칙으로 서버 응답을 흉내 내요.
 * - 서버가 400 으로 거절할 요청은 두 모드 모두 서버를 부르지 않고 VALIDATION_ERROR(400)로 알려요.
 * - direction 은 서버 값을 그대로 보내고 받아요(1호선 UP = 소요산 방향, DOWN = 인천·신창 방향). 프론트에서 방향을 바꾸지 않아요.
 */

import { get } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError } from '@/services/api/errors';
import type {
    CongestionQuery,
    CongestionResponse,
    CongestionSlot,
    CongestionSource,
    DayType,
    DirectionCode,
} from '@/types/congestion';
import type { CongestionLevel } from '@/types/route';

/* ---------- 영업일과 30분 칸 (명세 6.2 "운행일과 dayType") ---------- */

/**
 * 영업일은 05:30 에 시작해 다음 날 00:30 칸까지예요.
 * 칸은 30분 단위 39개: 05:30, 06:00, …, 23:30, 00:00, 00:30
 */
export const FIRST_TRAIN_SLOT = '05:30';
const BUSINESS_DAY_START_MIN = 5 * 60 + 30;
/** 00:00 ≤ t < 01:00 은 전날 영업일의 00:00·00:30 칸이에요. */
const AFTER_MIDNIGHT_END_MIN = 60;

const pad = (value: number) => String(value).padStart(2, '0');
const toTimeString = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const toDateString = (date: Date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const CONGESTION_SLOT_STARTS: readonly string[] = [
    ...Array.from({ length: (24 * 60 - BUSINESS_DAY_START_MIN) / 30 }, (_, index) => toTimeString(BUSINESS_DAY_START_MIN + index * 30)),
    '00:00',
    '00:30',
];

function toDayType(date: Date): DayType {
    // mock 은 공휴일을 모르므로 요일로만 정해요. 서버는 공휴일을 SUNDAY 로 판단해요.
    const day = date.getDay();
    if (day === 0) return 'SUNDAY';
    if (day === 6) return 'SATURDAY';
    return 'WEEKDAY';
}

/**
 * 통과 시각 → 조회할 영업일과 30분 칸 (명세 6.2)
 * ① 05:30 ≤ t ≤ 23:59 → 그날 영업일의 t 가 속한 30분 칸 (firstTrain: false)
 * ② 00:00 ≤ t < 01:00 → 전날 영업일의 00:00 또는 00:30 칸 (firstTrain: false)
 * ③ 01:00 ≤ t < 05:30 → 그날 영업일의 05:30 칸 (firstTrain: true)
 * dayType 과 slotDate 는 영업일 기준이에요(예: 토요일 00:10 → 금요일 영업일, WEEKDAY).
 *
 * mock 에서 단순화한 부분:
 * - 막차 이후(예: 00:30 칸에 열차가 없는 역)에 다음 영업일 05:30 칸으로 바꾸는 규칙은 서버가 데이터를 보고 판단해요.
 *   mock 은 열차 데이터가 없어서 이 대체를 하지 않고 ①②③ 시각 규칙만 따라요.
 * - 공휴일을 모르고, 기기의 현지 시각(at 의 getHours 등)으로 계산해요.
 *
 * 서버가 계산해 내려주는 값이라 mock(이 파일, services/route.ts)에서만 써요.
 */
export function resolveSlot(at: Date): CongestionSlot & { dayType: DayType } {
    const minutes = at.getHours() * 60 + at.getMinutes();
    const businessDay = new Date(at);
    let slotStart: string;
    let firstTrain = false;

    if (minutes >= BUSINESS_DAY_START_MIN) {
        slotStart = toTimeString(Math.floor(minutes / 30) * 30);
    } else if (minutes < AFTER_MIDNIGHT_END_MIN) {
        slotStart = toTimeString(Math.floor(minutes / 30) * 30);
        businessDay.setDate(businessDay.getDate() - 1);
    } else {
        slotStart = FIRST_TRAIN_SLOT;
        firstTrain = true;
    }

    return {
        slotStart,
        slotDate: toDateString(businessDay),
        firstTrain,
        dayType: toDayType(businessDay),
    };
}

/* ---------- 요청·응답 검사 ---------- */

const DIRECTIONS: readonly DirectionCode[] = ['UP', 'DOWN', 'INNER', 'OUTER', 'LOOP'];
const DAY_TYPES: readonly DayType[] = ['WEEKDAY', 'SATURDAY', 'SUNDAY'];
const LEVEL_CODES: readonly CongestionLevel[] = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'];
const SOURCES: readonly CongestionSource[] = ['PREDICTED', 'ESTIMATED', 'MOCK'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);
const isId = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;

/** 2026-02-30 처럼 없는 날짜는 거절해요. */
function isValidDate(value: string) {
    if (!DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

const invalid = (message: string) => new ApiError('VALIDATION_ERROR', message, null, 400);

/** 서버가 400 VALIDATION_ERROR 로 거절할 요청은 보내지 않고 같은 코드로 알려요. */
function validateQuery(query: CongestionQuery) {
    if (!isId(query.stationId) || !isId(query.lineId)) throw invalid('역 또는 노선 정보를 확인해 주세요.');
    if (!isOneOf(DIRECTIONS, query.direction)) throw invalid('방향 값을 확인해 주세요.');
    if (typeof query.time !== 'string' || !TIME_PATTERN.test(query.time)) {
        throw invalid('시각은 00:00~23:59 사이의 HH:mm 형식이어야 해요.');
    }
    if (query.date !== undefined) {
        if (typeof query.date !== 'string' || !isValidDate(query.date)) throw invalid('날짜는 yyyy-MM-dd 형식이어야 해요.');
    } else if (!isOneOf(DAY_TYPES, query.dayType)) {
        throw invalid('날짜가 없으면 요일 구분(dayType)이 필요해요.');
    }
}

/** 화면이 쓰는 필드가 빠졌거나 형식이 다른 응답은 화면 오류 대신 UNKNOWN_ERROR 로 알려요. */
function parseCongestion(value: unknown): CongestionResponse {
    if (
        isRecord(value)
        && isNumber(value.stationId)
        && isNumber(value.lineId)
        && isOneOf(DIRECTIONS, value.direction)
        && isOneOf(DAY_TYPES, value.dayType)
        && typeof value.slotStart === 'string' && TIME_PATTERN.test(value.slotStart)
        && (value.slotDate === null || (typeof value.slotDate === 'string' && DATE_PATTERN.test(value.slotDate)))
        && typeof value.firstTrain === 'boolean'
        && typeof value.supported === 'boolean'
    ) {
        const base = {
            stationId: value.stationId,
            lineId: value.lineId,
            direction: value.direction,
            dayType: value.dayType,
            slotStart: value.slotStart,
            slotDate: value.slotDate,
            firstTrain: value.firstTrain,
        };
        // 데이터 없음은 정상 응답이에요. 네 값은 들여다보지 않고 null 로 돌려줘요.
        if (!value.supported) {
            return { ...base, supported: false, pct: null, level: null, levelLabel: null, source: null };
        }
        if (
            isNumber(value.pct)
            && isOneOf(LEVEL_CODES, value.level)
            && typeof value.levelLabel === 'string'
            && isOneOf(SOURCES, value.source)
        ) {
            return {
                ...base,
                supported: true,
                pct: value.pct,
                level: value.level,
                levelLabel: value.levelLabel,
                source: value.source,
            };
        }
    }
    throw new ApiError('UNKNOWN_ERROR');
}

/* ---------- 조회 ---------- */

/**
 * 확인용 mock 상태 (mock 모드에서만, 서버 모드에서는 무시해요)
 * - 'error': 서버 오류(500)
 * - 'network': 네트워크 실패(NETWORK_ERROR)
 * 정상(여러 단계)·데이터 없음(역 109, 노선에 없는 방향)·첫차(01:00~05:29)는 인자 없이 확인해요.
 */
export type CongestionMock = 'error' | 'network';

/**
 * 명세 6.2 GET /congestion
 * 오류는 서버 code 를 그대로 전달해요: VALIDATION_ERROR(400), AUTH_REQUIRED·TOKEN_EXPIRED·TOKEN_INVALID(401),
 * STATION_NOT_FOUND(404), NOT_FOUND(404, 지원 역인데 그 노선에 속하지 않음, details.lineId).
 */
export async function fetchCongestion(query: CongestionQuery, mock?: CongestionMock): Promise<CongestionResponse> {
    validateQuery(query);

    if (isMockMode()) return fetchMockCongestion(query, mock);

    const { stationId, lineId, direction, time, date } = query;
    return parseCongestion(await get<unknown>('/congestion', {
        // date 가 있으면 서버가 dayType 을 무시하므로 보내지 않아요.
        query: { stationId, lineId, direction, time, ...(date !== undefined ? { date } : { dayType: query.dayType }) },
    }));
}

/* ---------- mock ---------- */

const MOCK_DELAY_MS = 500;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const LEVELS: { level: CongestionLevel; label: string; pct: number }[] = [
    { level: 'COMFORTABLE', label: '쾌적', pct: 28 },
    { level: 'RELAXED', label: '여유', pct: 42 },
    { level: 'NORMAL', label: '보통', pct: 78 },
    { level: 'CROWDED', label: '혼잡', pct: 118 },
    { level: 'VERY_CROWDED', label: '매우 혼잡', pct: 162 },
];

/** 혼잡도 데이터가 없는 역 (mock) */
const UNSUPPORTED_STATION_IDS = new Set([109]);

/**
 * 노선에 있는 방향 (mock 단순화: 2호선은 INNER/OUTER, 나머지는 UP/DOWN 으로 보고 LOOP 는 회색이에요)
 * 그 노선에 없는 방향은 서버처럼 오류가 아닌 데이터 없음(회색)으로 돌려줘요.
 */
const hasDirection = (lineId: number, direction: DirectionCode) =>
    lineId === 2 ? direction === 'INNER' || direction === 'OUTER' : direction === 'UP' || direction === 'DOWN';

async function fetchMockCongestion(query: CongestionQuery, mock?: CongestionMock): Promise<CongestionResponse> {
    await wait(MOCK_DELAY_MS);
    if (mock === 'network') throw new ApiError('NETWORK_ERROR');
    if (mock === 'error') throw new ApiError('INTERNAL_ERROR', null, null, 500);

    const [hour, minute] = query.time.split(':').map(Number);
    // date 가 없으면 날짜를 모르므로 오늘 날짜에 시각만 얹어 칸을 고르고, dayType 은 요청 값, slotDate 는 null 이에요.
    const at = query.date !== undefined ? new Date(`${query.date}T00:00:00`) : new Date();
    at.setHours(hour, minute, 0, 0);
    const slot = resolveSlot(at);
    const hasDate = query.date !== undefined;

    const base = {
        stationId: query.stationId,
        lineId: query.lineId,
        direction: query.direction,
        // date 가 있으면 요청의 dayType 은 무시하고 영업일로 정해요.
        dayType: hasDate ? slot.dayType : query.dayType!,
        slotStart: slot.slotStart,
        slotDate: hasDate ? slot.slotDate : null,
        firstTrain: slot.firstTrain,
    };

    if (UNSUPPORTED_STATION_IDS.has(query.stationId) || !hasDirection(query.lineId, query.direction)) {
        return { ...base, supported: false, pct: null, level: null, levelLabel: null, source: null };
    }

    // 출퇴근 시간대일수록 붐비게 보이도록 만든 예시 값
    const slotHour = Number(slot.slotStart.slice(0, 2));
    const rush = (slotHour >= 7 && slotHour <= 9) || (slotHour >= 18 && slotHour <= 19) ? 2 : 0;
    const index = Math.min((query.stationId + query.lineId + rush) % 3 + rush, LEVELS.length - 1);
    const picked = LEVELS[index];

    return {
        ...base,
        supported: true,
        pct: picked.pct,
        level: picked.level,
        levelLabel: picked.label,
        source: 'MOCK',
    };
}
