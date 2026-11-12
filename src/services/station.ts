import { get } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError } from '@/services/api/errors';
import { isMapBounds, type MapBounds } from '@/utils/home-map';
import { MOCK_LINES, MOCK_STATIONS, searchStations as searchMockStations } from '@/mocks/stations';
import type { Line, Station, StationDetail, StationSearchOptions, StationSearchResult } from '@/types/station';

/** 명세 5.2: keyword 는 50자를 넘으면 서버가 400 VALIDATION_ERROR 로 거절해요. 서버는 코드 포인트로 글자 수를 세요. */
export const STATION_KEYWORD_MAX_LENGTH = 50;
/** 명세 5.2: keyword 만 쓸 때 size 최대값 */
export const STATION_PAGE_MAX_SIZE = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 화면이 바로 쓰는 필드가 빠진 응답은 화면 오류 대신 UNKNOWN_ERROR 로 알려요. */
function parseStation(value: unknown): Station {
    if (
        isRecord(value)
        && isNumber(value.id)
        && typeof value.name === 'string'
        && isNumber(value.latitude)
        && isNumber(value.longitude)
        && typeof value.isSupported === 'boolean'
        && Array.isArray(value.lines)
        && value.lines.every(line => isRecord(line)
            && isNumber(line.lineId)
            && typeof line.lineName === 'string'
            && typeof line.color === 'string'
            && typeof line.stationCode === 'string')
    ) {
        return value as Station;
    }
    throw new ApiError('UNKNOWN_ERROR');
}

function parseSearchResult(value: unknown): StationSearchResult {
    if (isRecord(value) && Array.isArray(value.items) && isNumber(value.page) && isNumber(value.size) && isNumber(value.totalElements)) {
        return { items: value.items.map(parseStation), page: value.page, size: value.size, totalElements: value.totalElements };
    }
    throw new ApiError('UNKNOWN_ERROR');
}

function parseLines(value: unknown): Line[] {
    if (Array.isArray(value) && value.every(line => isRecord(line)
        && isNumber(line.id)
        && typeof line.lineCode === 'string'
        && typeof line.name === 'string'
        && typeof line.color === 'string')) {
        return value as Line[];
    }
    throw new ApiError('UNKNOWN_ERROR');
}

const cloneStation = (station: Station): Station => ({ ...station, lines: station.lines.map(line => ({ ...line })) });

/** 명세 5.2: 지도에 보이는 범위, 첫 페이지 최대 500개. */
export async function fetchStationsInBounds(bounds: MapBounds, options: { size?: number } = {}): Promise<StationSearchResult> {
    if (!isMapBounds(bounds)) throw new ApiError('VALIDATION_ERROR', null, null, 400);
    const size = Number.isFinite(options.size) ? Math.max(1, Math.min(500, Math.trunc(options.size!))) : 500;
    if (isMockMode()) {
        const matches = MOCK_STATIONS.filter(s => s.longitude >= bounds.minLng && s.longitude <= bounds.maxLng
            && s.latitude >= bounds.minLat && s.latitude <= bounds.maxLat);
        return { items: matches.slice(0, size).map(cloneStation), page: 0, size, totalElements: matches.length };
    }
    const bbox = [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat].join(',');
    return parseSearchResult(await get<unknown>('/stations', { query: { bbox, size } }));
}

/** 명세 5.2 GET /stations keyword 검색. */
export async function searchStations(keyword: string, options: StationSearchOptions = {}): Promise<StationSearchResult> {
    const query = keyword.trim();
    const page = Number.isFinite(options.page) ? Math.max(0, Math.trunc(options.page!)) : 0;
    const size = Number.isFinite(options.size)
        ? Math.max(1, Math.min(STATION_PAGE_MAX_SIZE, Math.trunc(options.size!)))
        : STATION_PAGE_MAX_SIZE;
    if (!query) return { items: [], page, size, totalElements: 0 };
    // 서버가 400 으로 거절할 요청은 보내지 않고 같은 코드로 알려요.
    if (Array.from(query).length > STATION_KEYWORD_MAX_LENGTH) {
        throw new ApiError('VALIDATION_ERROR', `역 이름은 ${STATION_KEYWORD_MAX_LENGTH}자까지 입력할 수 있어요.`, null, 400);
    }

    if (isMockMode()) {
        const matches = searchMockStations(query, Number.MAX_SAFE_INTEGER)
            .filter(station => options.lineId === undefined || station.lines.some(line => line.lineId === options.lineId));
        return { items: matches.slice(page * size, (page + 1) * size), page, size, totalElements: matches.length };
    }

    return parseSearchResult(await get<unknown>('/stations', { query: { keyword: query, lineId: options.lineId, page, size } }));
}

/**
 * 명세 5.3 GET /stations/{id}. 없는 역은 code 가 STATION_NOT_FOUND 인 ApiError 를 던져요.
 * 서버 모드에서는 mock 목록을 보지 않아요.
 */
export async function fetchStation(id: number): Promise<StationDetail> {
    // 잘못된 id 로 /stations/NaN 같은 요청을 보내지 않아요.
    if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError('STATION_NOT_FOUND', null, null, 404);

    if (isMockMode()) {
        const station = MOCK_STATIONS.find(item => item.id === id);
        if (!station) throw new ApiError('STATION_NOT_FOUND', null, null, 404);
        return cloneStation(station);
    }

    return parseStation(await get<unknown>(`/stations/${id}`));
}

/**
 * 명세 5.1 GET /lines.
 * 노선 색·이름은 화면 장식에 쓰이므로, 서버 호출이 실패하면(401 포함) 오류 대신 기존 노선 값을 돌려줘요.
 * 이때 돌려주는 MOCK_LINES 는 표시용이며, 서버 요청의 ID(예: lineId 필터)로 쓰지 않아요.
 */
export async function fetchLines(): Promise<Line[]> {
    if (isMockMode()) return MOCK_LINES.map(line => ({ ...line }));
    try {
        return parseLines(await get<unknown>('/lines'));
    } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        return MOCK_LINES.map(line => ({ ...line }));
    }
}
