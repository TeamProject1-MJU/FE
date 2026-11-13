/**
 * 중간역 추천 서비스 (#49, #99, API 명세 v1.12 8.1~8.3 · BE 코드 기준)
 *
 * 서버 모드 (EXPO_PUBLIC_USE_MOCK=false, #99)
 * - POST /rooms/{roomId}/recommendations            { conditionText?, filter? }  → 8.1 (제한 시간 RECOMMENDATION_TIMEOUT_MS)
 * - GET  /rooms/{roomId}/recommendations/latest     → 8.2 (실행 기록 없으면 data: null → null 반환)
 * - GET  /rooms/{roomId}/recommendations/{runId}    → 8.3 (최근 실행이 아니면 isStale·staleReasons = null 그대로)
 * - 응답은 unknown 으로 받아 화면이 읽는 값만 필수로 검사하고, 형식 오류는 UNKNOWN_ERROR 예요.
 * - 추천역·주변 대안역 ID 는 서버 값을 그대로 써요. mock 역 목록(MOCK_STATIONS)과 방 mock 을 읽지 않아요.
 * - recommendedStation.lines 는 응답에 없어서 역 상세(5.3)로 채우고, 실패하면 배지만 숨겨요.
 * - 서버에 이전 실행 목록 API 가 없어서 listRecommendationRuns 는 이 앱 세션에서 본 실행(8.1 성공·8.2 결과)만 돌려줘요.
 * - 인증 오류(TOKEN_*·401)는 A-1 공통 처리에 맡기고 ApiError 그대로 던져요.
 * - 추천 화면은 WS RECOMMENDATION_CREATED / MEMBER_JOINED / MEMBER_LEFT / DEPARTURE_UPDATED / ROOM_UPDATED 수신 시 8.2를 다시 조회해요(#117, #136).
 *
 * mock 모드 (기본)
 * - 방 mock(services/room.ts)의 멤버·출발역·약속 시각을 읽어 메모리에서 추천을 흉내 내요.
 * - 실제 다익스트라·요금 계산·OpenAI 호출 대신 거리 기반의 단순 추정치를 써요 (값에는 화면에서 "예상" 라벨)
 * - 실행마다 criteria 스냅샷(appointmentAt, participants)을 남기고, 조회할 때 현재 방 상태와 비교해 isStale 을 계산해요 (명세 8.1)
 * - 방 정보가 바뀌어도 자동으로 다시 추천하지 않아요. 사용자가 "다시 추천받기"로 8.1 을 다시 호출해요
 */

import { MOCK_STATIONS } from '@/mocks/stations';
import type { Station } from '@/types/station';
import { getMockMembers, getMockRoom } from '@/services/room';
import { get, post } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import { fetchStation } from '@/services/station';
import { assertRoomCacheScope, getRoomCacheScope, subscribeRoomCacheReset } from '@/services/room-cache';
import { subscribeRoomMockChanges } from '@/stores/room-mock-events';
import {
    RecommendationError,
    type AppliedConstraints,
    type NearbyAlternative,
    type ParticipantTime,
    type RecommendationCriterion,
    type RecommendationErrorCode,
    type RecommendationFilter,
    type RecommendationRequest,
    type RecommendationResult,
    type RecommendationRun,
    type RecommendedStation,
    type StaleReason,
} from '@/types/recommendation';
import type { RoomMember } from '@/types/room';

const MOCK_DELAY_MS = 900;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/* ───────────── 저장소 (recommendation_runs + criteria 스냅샷) ───────────── */

type StoredRun = {
    run: Omit<RecommendationRun, 'isStale' | 'staleReasons'>;
    criteria: {
        appointmentAt: string | null;
        participants: { userId: string; departureStationId: number | null }[];
        conditionParseFailed: boolean;
        noResult: boolean;
    };
};

/** 방 id → 실행 목록 (최근 실행이 마지막) */
const runsByRoom = new Map<string, StoredRun[]>();
let runSeq = 1;

/** 실패를 흉내 내는 방 (화면 확인용). 한 번 실패한 뒤 다시 시도하면 성공 */
const createFailOnce = new Set<string>();
const latestFailOnce = new Set<string>();

subscribeRoomMockChanges(({ roomId, roomDeleted }) => {
    if (!roomDeleted) return;

    runsByRoom.delete(roomId);
    createFailOnce.delete(roomId);
    latestFailOnce.delete(roomId);
});

/* ───────────── isStale 판정 (명세 8.1 비교 규칙) ───────────── */

function sameInstant(a: string | null, b: string | null) {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return new Date(a).getTime() === new Date(b).getTime();
}

function currentParticipants(roomId: string) {
    return getMockMembers(roomId).map(member => ({ userId: member.userId, departureStationId: member.departureStation?.id ?? null }));
}

function sameParticipants(a: StoredRun['criteria']['participants'], b: StoredRun['criteria']['participants']) {
    if (a.length !== b.length) return false;
    const key = (p: { userId: string; departureStationId: number | null }) => `${p.userId}:${p.departureStationId ?? 'null'}`;
    const setA = new Set(a.map(key));
    return b.every(p => setA.has(key(p)));
}

function withStale(roomId: string, stored: StoredRun, isLatest: boolean): RecommendationRun {
    if (!isLatest) return { ...stored.run, isStale: null, staleReasons: null };
    const room = getMockRoom(roomId);
    const reasons: StaleReason[] = [];
    if (!sameInstant(room?.appointmentAt ?? null, stored.criteria.appointmentAt)) reasons.push('APPOINTMENT_CHANGED');
    if (!sameParticipants(currentParticipants(roomId), stored.criteria.participants)) reasons.push('MEMBERS_CHANGED');
    // 조회 때마다 message 를 다시 만듭니다 (명세: message 는 저장하지 않음)
    const message = buildMessage(stored.criteria);
    return { ...stored.run, message, isStale: reasons.length > 0, staleReasons: reasons };
}

function buildMessage(criteria: StoredRun['criteria']) {
    const parts: string[] = [];
    if (criteria.conditionParseFailed) parts.push('자연어 조건을 해석하지 못해 적용하지 못했어요. 선택한 필터만 적용했어요.');
    if (criteria.noResult) parts.push('조건에 맞는 중간역이 없어요. 조건을 완화해 보세요.');
    return parts.length ? parts.join(' ') : null;
}

/* ───────────── 8.2 / 8.3 조회 ───────────── */
/** 8.2 최근 실행. 실행 기록이 없으면 null이에요. */
export async function fetchLatestRecommendation(
    roomId: string,
    mock?: 'error',
): Promise<RecommendationRun | null> {
    // 서버 모드에서는 mock 인자를 무시해요.
    if (!isMockMode()) return fetchServerLatest(roomId);
    await wait(MOCK_DELAY_MS * 0.6);

    if (!getMockRoom(roomId)) {
        throw new RecommendationError(
            'ROOM_NOT_FOUND',
            '약속방을 찾을 수 없어요.',
        );
    }

    if (mock) latestFailOnce.add(roomId);

    if (latestFailOnce.has(roomId)) {
        latestFailOnce.delete(roomId);

        throw new RecommendationError(
            'NETWORK_ERROR',
            '추천 결과를 불러오지 못했어요.',
        );
    }

    const runs = runsByRoom.get(roomId) ?? [];

    if (runs.length === 0) return null;

    return withStale(roomId, runs[runs.length - 1], true);
}

/** 8.3 특정 실행. 최근 실행이 아니면 최신 여부를 판정하지 않아요. */
export async function fetchRecommendation(
    roomId: string,
    runId: string,
): Promise<RecommendationRun> {
    if (!isMockMode()) return fetchServerRun(roomId, runId);
    await wait(MOCK_DELAY_MS * 0.6);

    if (!getMockRoom(roomId)) {
        throw new RecommendationError(
            'ROOM_NOT_FOUND',
            '약속방을 찾을 수 없어요.',
        );
    }

    const runs = runsByRoom.get(roomId) ?? [];
    const index = runs.findIndex(
        item => item.run.runId === runId,
    );

    if (index < 0) {
        throw new RecommendationError(
            'RUN_NOT_FOUND',
            '추천 결과를 찾을 수 없어요.',
        );
    }

    return withStale(
        roomId,
        runs[index],
        index === runs.length - 1,
    );
}

/**
 * 이 방의 실행 목록을 최근 순으로 반환해요.
 * 서버 모드: 서버에 목록 API 가 없어서 이 앱 세션에서 본 실행(8.1 성공·8.2 결과)만 돌려줘요. 화면은 2건 이상일 때만 목록을 보여요.
 */
export function listRecommendationRuns(
    roomId: string,
): { runId: string; createdAt: string }[] {
    if (!isMockMode()) return listServerRuns(roomId);
    if (!getMockRoom(roomId)) return [];

    return [...(runsByRoom.get(roomId) ?? [])]
        .reverse()
        .map(item => ({
            runId: item.run.runId,
            createdAt: item.run.createdAt,
        }));
}

/* ───────────── 8.1 실행 ───────────── */

/**
 * 자연어 조건 해석 mock (실제로는 서버가 OpenAI 로 filter 항목으로 변환, 범위 밖).
 * 숫자+분 → maxMinutes, 환승 적게/없이/N회 → maxTransfers, 숫자+원 → maxFareWon.
 * 아무것도 못 읽으면 해석 실패(conditionParseFailed) 로 처리합니다.
 */
function parseConditionText(text: string): { filter: RecommendationFilter; failed: boolean } {
    const filter: RecommendationFilter = {};
    const minutes = text.match(/(\d{1,3})\s*분/);
    if (minutes) filter.maxMinutes = Number(minutes[1]);
    const transfers = text.match(/환승\s*(\d)\s*(회|번)/);
    if (transfers) filter.maxTransfers = Number(transfers[1]);
    else if (/환승\s*(없|안|적)/.test(text)) filter.maxTransfers = /없|안/.test(text) ? 0 : 1;
    const fare = text.match(/([\d,]{4,6})\s*원/);
    if (fare) filter.maxFareWon = Number(fare[1].replace(/,/g, ''));
    const failed = Object.keys(filter).length === 0;
    return { filter, failed };
}

const KM = 1000;
function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
    const r = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(h));
}

/** 요금 mock: 명세 8.1 규칙 (기본 1,550원/10km, 10km 초과 5km 마다 +100, 50km 초과 8km 마다 +100, 구간 올림) */
function estimateFare(distanceM: number) {
    const km = distanceM / KM;
    if (km <= 10) return 1550;
    if (km <= 50) return 1550 + Math.ceil((km - 10) / 5) * 100;
    return 1550 + 8 * 100 + Math.ceil((km - 50) / 8) * 100;
}

function stationLines(station: Station) {
    return station.lines.map(line => ({ lineId: line.lineId, lineName: line.lineName, color: line.color }));
}

/** 참여자 → 후보역 추정 이동 정보 (직선거리 × 1.35 를 지하철 거리로, 평균 2.3분/km, 노선이 다르면 환승 1회) */
function estimateTrip(member: RoomMember, from: Station, to: Station, appointmentAt: string | null): ParticipantTime {
    const distanceM = Math.round(distanceMeters(from, to) * 1.35);
    const sharedLine = from.lines.find(line => to.lines.some(other => other.lineId === line.lineId));
    const transferCount = from.id === to.id ? 0 : sharedLine ? 0 : 1;
    const travelMinutes = from.id === to.id ? 0 : Math.max(4, Math.round((distanceM / KM) * 2.3 + transferCount * 5));
    const fareWon = estimateFare(distanceM);
    const base = appointmentAt ? new Date(appointmentAt).getTime() : Date.now();
    const departureAt = new Date(base - travelMinutes * 60_000).toISOString();

    // 혼잡도 mock: 거리와 출발 시각으로 단순 분배
    const hour = new Date(departureAt).getHours();
    const peak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
    const pct = Math.round((peak ? 95 : 55) + (distanceM / KM) * 2.2);
    const level = pct < 35 ? 'COMFORTABLE' : pct < 50 ? 'RELAXED' : pct < 100 ? 'NORMAL' : pct < 150 ? 'CROWDED' : 'VERY_CROWDED';
    const levelLabel = { COMFORTABLE: '쾌적', RELAXED: '여유', NORMAL: '보통', CROWDED: '혼잡', VERY_CROWDED: '매우 혼잡' }[level];

    const firstLine = sharedLine ?? from.lines[0];
    const lastLine = sharedLine ?? to.lines[0];
    const segments = sharedLine || from.id === to.id
        ? [{ lineId: firstLine.lineId, lineName: firstLine.lineName, color: firstLine.color, direction: 'UP' as const, fromStationName: from.name, toStationName: to.name, stationCount: Math.max(1, Math.round(distanceM / 1100)) }]
        : [
            { lineId: firstLine.lineId, lineName: firstLine.lineName, color: firstLine.color, direction: 'UP' as const, fromStationName: from.name, toStationName: '환승역', stationCount: Math.max(1, Math.round(distanceM / 2200)) },
            { lineId: lastLine.lineId, lineName: lastLine.lineName, color: lastLine.color, direction: 'DOWN' as const, fromStationName: '환승역', toStationName: to.name, stationCount: Math.max(1, Math.round(distanceM / 2200)) },
        ];

    return {
        userId: member.userId,
        nickname: member.nickname,
        departureStation: { id: from.id, name: from.name },
        travelMinutes,
        transferCount,
        fareWon,
        distanceM,
        departureAt,
        congestion: { pct, level, levelLabel },
        segments,
    };
}

function passesConstraints(trips: ParticipantTime[], constraints: AppliedConstraints) {
    if (constraints.maxMinutes !== undefined && trips.some(t => t.travelMinutes > constraints.maxMinutes!)) return false;
    if (constraints.maxTransfers !== undefined && trips.some(t => t.transferCount > constraints.maxTransfers!)) return false;
    if (constraints.maxFareWon !== undefined && trips.some(t => t.fareWon > constraints.maxFareWon!)) return false;
    for (const limit of constraints.memberLimits ?? []) {
        const trip = trips.find(t => t.userId === limit.userId);
        if (trip && trip.travelMinutes > limit.maxMinutes) return false;
    }
    return true;
}

const EXPLANATIONS: Record<RecommendationCriterion, (name: string, m: RecommendationResult['metrics']) => string> = {
    TIME: (name, m) => `${name}역은 가장 오래 걸리는 사람이 ${m.maxMinutes}분으로 모두에게 가장 공평한 역이에요. 이동 시간 편차도 ${m.maxDifferenceMinutes}분으로 작아요.`,
    FARE: (name, m) => `${name}역은 참여자 평균 예상 요금이 ${m.averageFare.toLocaleString()}원으로 가장 저렴해요. 환승 합계는 ${m.totalTransfers}회예요.`,
    DISTANCE: (name, m) => `${name}역은 참여자들의 지하철 이동 거리 합이 가장 짧아요. 평균 예상 시간은 ${m.averageMinutes}분이에요.`,
};

/**
 * 8.1 추천 실행
 * - 멤버 2명 미만 TOO_FEW_MEMBERS(422), 출발역 없는 멤버가 있으면 DEPARTURE_MISSING(422, details.missingUserIds) — 둘 다 실행 기록을 남기지 않음
 * - 조건에 맞는 역이 없으면 에러가 아니라 results: [] + message (실행 기록은 남김)
 * mock: 'error' 면 한 번 NETWORK_ERROR (다시 시도하면 성공)
 */
export async function createRecommendation(
    roomId: string,
    request: RecommendationRequest,
    mock?: 'error',
): Promise<RecommendationRun> {
    // 서버 모드에서는 mock 인자를 무시하고 mock 계산(MOCK_STATIONS·방 mock)을 타지 않아요.
    if (!isMockMode()) return createServerRecommendation(roomId, request);
    await wait(MOCK_DELAY_MS * 1.6);
    if (mock) createFailOnce.add(roomId);

    const room = getMockRoom(roomId);
    if (!room) throw new RecommendationError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
    const members = getMockMembers(roomId);

    // 계산 전 검사 (명세 8.1): 실행 기록도 남기지 않음
    if (members.length < 2) throw new RecommendationError('TOO_FEW_MEMBERS', '중간역을 추천하려면 멤버가 2명 이상이어야 해요.');
    const missing = members.filter(member => !member.departureStation).map(member => member.userId);
    if (missing.length > 0) throw new RecommendationError('DEPARTURE_MISSING', '출발역을 설정하지 않은 멤버가 있어요.', missing);

    if (createFailOnce.has(roomId)) {
        createFailOnce.delete(roomId);
        throw new RecommendationError('NETWORK_ERROR', '추천을 실행하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }

    // 조건: conditionText → filter 변환(mock), 같은 항목은 filter 우선
    const conditionText = request.conditionText?.trim() || null;
    const parsed = conditionText ? parseConditionText(conditionText) : { filter: {}, failed: false };
    const applied: AppliedConstraints = { ...parsed.filter, ...(request.filter ?? {}) };
    for (const key of Object.keys(applied) as (keyof AppliedConstraints)[]) {
        if (applied[key] === undefined) delete applied[key];
    }

    const departures = members.map(member => {
        const station = MOCK_STATIONS.find(item => item.id === member.departureStation!.id);
        if (!station || !station.isSupported || !station.lines.length) throw new RecommendationError('STATION_UNSUPPORTED', `${member.nickname}님의 출발역은 지원하지 않는 역이에요.`);
        return { member, station };
    });

    // 후보 집합: 지원 역 전체 − 제외 역, 각 참여자 추정 이동 정보 계산
    // TODO(백엔드 확인): 참여자 출발역 자체를 후보에서 빼는지. mock 은 "중간"역 취지로 제외
    const excluded = new Set([...(applied.excludeStationIds ?? []), ...departures.map(({ station }) => station.id)]);
    const candidates = MOCK_STATIONS.filter(station => station.isSupported && !excluded.has(station.id)).map(station => {
        const trips = departures.map(({ member, station: from }) => estimateTrip(member, from, station, room.appointmentAt));
        return { station, trips };
    }).filter(candidate => passesConstraints(candidate.trips, applied));

    const createdAt = new Date().toISOString();
    const runId = `run-${runSeq++}`;
    const criteria: StoredRun['criteria'] = {
        appointmentAt: room.appointmentAt,
        participants: currentParticipants(roomId),
        conditionParseFailed: parsed.failed,
        noResult: candidates.length === 0,
    };

    const results: RecommendationResult[] = [];
    if (candidates.length > 0) {
        const metricsOf = (trips: ParticipantTime[]) => {
            const minutes = trips.map(t => t.travelMinutes);
            const fares = trips.map(t => t.fareWon);
            return {
                averageMinutes: Math.round((minutes.reduce((a, b) => a + b, 0) / minutes.length) * 10) / 10,
                maxDifferenceMinutes: Math.max(...minutes) - Math.min(...minutes),
                maxMinutes: Math.max(...minutes),
                averageFare: Math.round(fares.reduce((a, b) => a + b, 0) / fares.length),
                totalTransfers: trips.reduce((a, t) => a + t.transferCount, 0),
            };
        };
        const timeKey = (c: typeof candidates[number]) => {
            const m = metricsOf(c.trips);
            return [m.maxMinutes, m.maxDifferenceMinutes, m.averageMinutes];
        };
        const compare = (a: number[], b: number[]) => a.reduce((acc, v, i) => acc || v - b[i], 0);
        const pick = (criterion: RecommendationCriterion) => {
            const sorted = [...candidates].sort((a, b) => {
                if (criterion === 'FARE') {
                    const fa = a.trips.reduce((s, t) => s + t.fareWon, 0), fb = b.trips.reduce((s, t) => s + t.fareWon, 0);
                    if (Math.abs(fa - fb) > 100) return fa - fb; // 허용 폭 100원 이내는 동점 → TIME 규칙
                } else if (criterion === 'DISTANCE') {
                    const da = a.trips.reduce((s, t) => s + t.distanceM, 0), db = b.trips.reduce((s, t) => s + t.distanceM, 0);
                    if (Math.abs(da - db) > 1000) return da - db; // 허용 폭 1km
                }
                return compare(timeKey(a), timeKey(b));
            });
            return sorted[0];
        };

        for (const criterion of ['TIME', 'FARE', 'DISTANCE'] as RecommendationCriterion[]) {
            const best = pick(criterion);
            const metrics = metricsOf(best.trips);
            // 주변 대안역: 같은 노선의 가까운 지원 역 앞·뒤 1개씩 (mock: 거리순)
            const line = best.station.lines[0];
            const nearby: NearbyAlternative[] = candidates
                .filter(c => c.station.id !== best.station.id && c.station.lines.some(l => l.lineId === line.lineId))
                .sort((a, b) => distanceMeters(a.station, best.station) - distanceMeters(b.station, best.station))
                .slice(0, 2)
                .map((c, index) => ({
                    station: { id: c.station.id, name: c.station.name },
                    lineId: line.lineId,
                    relation: index === 0 ? 'PREV' : 'NEXT',
                    relationLabel: '최적역에서 1정거장',
                    maxMinutes: Math.max(...c.trips.map(t => t.travelMinutes)),
                    totalFareWon: c.trips.reduce((s, t) => s + t.fareWon, 0),
                }));
            results.push({
                resultId: `${runId}-${criterion.toLowerCase()}`,
                criterion,
                recommendedStation: {
                    id: best.station.id,
                    name: best.station.name,
                    latitude: best.station.latitude,
                    longitude: best.station.longitude,
                    isSupported: true,
                    lines: stationLines(best.station),
                },
                metrics,
                participantTimes: best.trips,
                nearbyAlternatives: nearby,
                explanation: EXPLANATIONS[criterion](best.station.name, metrics),
                explanationSource: 'TEMPLATE', // mock 은 템플릿 설명이에요. 서버 모드는 응답의 explanationSource 를 받아요.
            });
        }
    }

    const stored: StoredRun = {
        run: { runId, createdAt, conditionText, appliedConstraints: applied, message: null, results },
        criteria,
    };
    runsByRoom.set(roomId, [...(runsByRoom.get(roomId) ?? []), stored]);
    return withStale(roomId, stored, true);
}

/* ───────────── 서버 모드 (#99) ───────────── */

/**
 * 8.1 요청 제한 시간. 조건 해석·설명 생성에 AI 호출이 있어 기본 10초보다 길게 둬요.
 * 30초는 실서버에서 재지 않은 임시값이에요. TODO: 실서버 측정 후 조정
 */
export const RECOMMENDATION_TIMEOUT_MS = 30000;

/** 8.1 시간 초과·연결 실패: 서버는 계산을 끝내고 저장했을 수 있어요. 화면에 다시 들어오면 8.2 로 확인돼요. */
const CREATE_NETWORK_MESSAGE = '추천 결과를 받지 못했어요. 결과가 저장됐을 수 있어요. 최근 결과를 확인해 보세요.';
const READ_NETWORK_MESSAGE = '추천 결과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

const SERVER_ERROR_MESSAGES: Record<Exclude<RecommendationErrorCode, 'NETWORK_ERROR'>, string> = {
    TOO_FEW_MEMBERS: '중간역을 추천하려면 멤버가 2명 이상이어야 해요.',
    DEPARTURE_MISSING: '출발역을 설정하지 않은 멤버가 있어요.',
    STATION_UNSUPPORTED: '지원하지 않는 출발역이 있어요. 출발역을 확인해 주세요.',
    NOT_ROOM_MEMBER: '참여하지 않은 약속방이에요.',
    ROOM_NOT_FOUND: '약속방을 찾을 수 없어요.',
    RUN_NOT_FOUND: '추천 결과를 찾을 수 없어요.',
    APPOINTMENT_PASSED: '약속 시각이 이미 지나서 추천할 수 없어요. 약속 시각을 바꿔 주세요.',
    NO_SERVICE_TIME: '약속 시각 전에 도착하는 열차가 없어요. 약속 시각을 조정해 주세요.',
    RECOMMENDATION_IN_PROGRESS: '다른 멤버가 추천을 계산하고 있어요. 잠시 후 다시 시도해 주세요.',
    VALIDATION_ERROR: '추천 조건을 확인해 주세요.',
    UNKNOWN_ERROR: '추천 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

const isAuthFailure = (error: unknown) => error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error));

/** 서버 오류 → RecommendationError. 인증 오류는 A-1 처리에 맡기려고 ApiError 그대로 던져요. 모르는 코드는 UNKNOWN_ERROR 예요. */
function toRecommendationError(error: unknown, action: 'create' | 'read'): never {
    if (isAuthFailure(error) || error instanceof RecommendationError) throw error;
    if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
        throw new RecommendationError('NETWORK_ERROR', action === 'create' ? CREATE_NETWORK_MESSAGE : READ_NETWORK_MESSAGE);
    }
    const code = error instanceof ApiError && Object.prototype.hasOwnProperty.call(SERVER_ERROR_MESSAGES, error.code)
        ? error.code as keyof typeof SERVER_ERROR_MESSAGES : 'UNKNOWN_ERROR';
    // DEPARTURE_MISSING 은 error.details.missingUserIds 가 문자열 배열일 때만 넘겨요.
    const details = error instanceof ApiError ? error.details : null;
    const missing = code === 'DEPARTURE_MISSING' && isRecord(details) && Array.isArray(details.missingUserIds)
        && details.missingUserIds.every(id => typeof id === 'string') ? [...details.missingUserIds as string[]] : undefined;
    throw new RecommendationError(code, SERVER_ERROR_MESSAGES[code], missing);
}

/* ---------- 응답 검사: 화면이 읽는 값만 필수로 보고, 안 쓰는 값은 없거나 달라도 통과시켜요 ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const invalid = (): never => { throw new ApiError('UNKNOWN_ERROR'); };
const CRITERION_VALUES: readonly RecommendationCriterion[] = ['TIME', 'FARE', 'DISTANCE'];

/** null·undefined 는 null, 문자열은 그대로, 그 밖은 형식 오류예요. */
function parseOptionalText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'string' ? value : invalid();
}

/** null 인 값과 빈 배열은 "조건 없음"으로 빼서, 화면의 "적용된 제약 없음" 판단과 표시가 그대로 동작하게 해요. */
function parseConstraints(value: unknown): AppliedConstraints {
    if (value === null || value === undefined) return {};
    if (!isRecord(value)) return invalid();
    const constraints: AppliedConstraints = {};
    for (const key of ['maxMinutes', 'maxTransfers', 'maxFareWon'] as const) {
        const item = value[key];
        if (isNumber(item)) constraints[key] = item;
    }
    const excluded = Array.isArray(value.excludeStationIds) ? value.excludeStationIds.filter(isNumber) : [];
    if (excluded.length) constraints.excludeStationIds = excluded;
    const limits = Array.isArray(value.memberLimits)
        ? value.memberLimits.flatMap(limit => isRecord(limit) && typeof limit.userId === 'string' && isNumber(limit.maxMinutes)
            ? [{ userId: limit.userId, maxMinutes: limit.maxMinutes }] : [])
        : [];
    if (limits.length) constraints.memberLimits = limits;
    return constraints;
}

function parseSegment(value: unknown) {
    if (!isRecord(value) || !isNumber(value.lineId) || typeof value.lineName !== 'string' || typeof value.color !== 'string'
        || typeof value.fromStationName !== 'string' || typeof value.toStationName !== 'string' || !isNumber(value.stationCount)) return invalid();
    return { ...value } as ParticipantTime['segments'][number];
}

/** boardingTrain·legs·source·arriveAt·slackSeconds 같은 추가 값은 화면에 쓰지 않고 그대로 통과시켜요. */
function parseParticipant(value: unknown): ParticipantTime {
    if (!isRecord(value) || typeof value.userId !== 'string' || typeof value.nickname !== 'string'
        || !isRecord(value.departureStation) || !isNumber(value.departureStation.id) || typeof value.departureStation.name !== 'string'
        || !isNumber(value.travelMinutes) || !isNumber(value.transferCount) || !isNumber(value.fareWon) || !isNumber(value.distanceM)
        || !isDate(value.departureAt)) return invalid();
    let congestion: ParticipantTime['congestion'] = null;
    if (value.congestion !== null && value.congestion !== undefined) {
        const raw = value.congestion;
        if (!isRecord(raw) || typeof raw.level !== 'string' || typeof raw.levelLabel !== 'string') return invalid();
        congestion = { level: raw.level as NonNullable<ParticipantTime['congestion']>['level'], levelLabel: raw.levelLabel, ...(isNumber(raw.pct) ? { pct: raw.pct } : {}) };
    }
    const segments = value.segments === null || value.segments === undefined ? []
        : Array.isArray(value.segments) ? value.segments.map(parseSegment) : invalid();
    return {
        ...value,
        userId: value.userId,
        nickname: value.nickname,
        departureStation: { id: value.departureStation.id, name: value.departureStation.name },
        travelMinutes: value.travelMinutes,
        transferCount: value.transferCount,
        fareWon: value.fareWon,
        distanceM: value.distanceM,
        departureAt: value.departureAt,
        congestion,
        segments,
    };
}

function parseNearby(value: unknown): NearbyAlternative {
    if (!isRecord(value) || !isRecord(value.station) || !isNumber(value.station.id) || typeof value.station.name !== 'string'
        || !isNumber(value.lineId) || typeof value.relation !== 'string' || typeof value.relationLabel !== 'string'
        || !isNumber(value.maxMinutes) || !isNumber(value.totalFareWon)) return invalid();
    return {
        station: { id: value.station.id, name: value.station.name },
        lineId: value.lineId,
        relation: value.relation as NearbyAlternative['relation'],
        relationLabel: value.relationLabel,
        maxMinutes: value.maxMinutes,
        totalFareWon: value.totalFareWon,
    };
}

function parseResult(value: unknown): RecommendationResult {
    if (!isRecord(value) || typeof value.resultId !== 'string'
        || !CRITERION_VALUES.includes(value.criterion as RecommendationCriterion)
        || typeof value.explanation !== 'string' || !Array.isArray(value.participantTimes)) return invalid();
    const station = value.recommendedStation;
    if (!isRecord(station) || !isNumber(station.id) || typeof station.name !== 'string') return invalid();
    const metrics = value.metrics;
    if (!isRecord(metrics) || !isNumber(metrics.averageMinutes) || !isNumber(metrics.maxDifferenceMinutes)
        || !isNumber(metrics.maxMinutes) || !isNumber(metrics.averageFare)) return invalid();
    const nearby = value.nearbyAlternatives === null || value.nearbyAlternatives === undefined ? []
        : Array.isArray(value.nearbyAlternatives) ? value.nearbyAlternatives.map(parseNearby) : invalid();
    // 서버 응답에 lines 가 없어요. 노선 배지는 attachStationLines 가 역 상세로 채워요.
    const recommendedStation: RecommendedStation = {
        id: station.id,
        name: station.name,
        ...(isNumber(station.latitude) ? { latitude: station.latitude } : {}),
        ...(isNumber(station.longitude) ? { longitude: station.longitude } : {}),
        ...(typeof station.isSupported === 'boolean' ? { isSupported: station.isSupported } : {}),
    };
    return {
        resultId: value.resultId,
        criterion: value.criterion as RecommendationCriterion,
        recommendedStation,
        metrics: {
            averageMinutes: metrics.averageMinutes,
            maxDifferenceMinutes: metrics.maxDifferenceMinutes,
            maxMinutes: metrics.maxMinutes,
            averageFare: metrics.averageFare,
            ...(isNumber(metrics.totalTransfers) ? { totalTransfers: metrics.totalTransfers } : {}),
        },
        participantTimes: value.participantTimes.map(parseParticipant),
        nearbyAlternatives: nearby,
        explanation: value.explanation,
        explanationSource: value.explanationSource === 'AI' ? 'AI' : 'TEMPLATE',
    };
}

/** 8.1·8.2·8.3 공통 응답. isStale·staleReasons 의 null 은 null 그대로 둬요(false·빈 배열로 바꾸지 않아요). */
function parseRun(value: unknown): RecommendationRun {
    if (!isRecord(value) || typeof value.runId !== 'string' || !value.runId || !isDate(value.createdAt)
        || !(value.isStale === null || typeof value.isStale === 'boolean')
        || !(value.staleReasons === null || value.staleReasons === undefined
            || (Array.isArray(value.staleReasons) && value.staleReasons.every(reason => typeof reason === 'string')))
        || !Array.isArray(value.results)) return invalid();
    return {
        runId: value.runId,
        createdAt: value.createdAt,
        isStale: value.isStale,
        staleReasons: Array.isArray(value.staleReasons) ? [...value.staleReasons] as StaleReason[] : null,
        conditionText: parseOptionalText(value.conditionText),
        appliedConstraints: parseConstraints(value.appliedConstraints),
        message: parseOptionalText(value.message),
        results: value.results.map(parseResult),
    };
}

/**
 * 추천역 노선 배지: 결과 최대 3곳을 역 상세(5.3)로 병렬 조회하고, 같은 역은 한 번만 불러요.
 * 실패하면 그 역의 배지만 숨겨요(lines 없음). 인증 오류는 A-1 처리에 맡기려고 그대로 던져요.
 */
async function attachStationLines(run: RecommendationRun): Promise<RecommendationRun> {
    const ids = [...new Set(run.results.map(item => item.recommendedStation.id))].slice(0, 3);
    const found = new Map<number, NonNullable<RecommendedStation['lines']>>();
    await Promise.all(ids.map(async id => {
        try {
            const station = await fetchStation(id);
            found.set(id, station.lines.map(line => ({ lineId: line.lineId, lineName: line.lineName, color: line.color })));
        } catch (error) {
            if (isAuthFailure(error)) throw error;
        }
    }));
    return {
        ...run,
        results: run.results.map(item => {
            const lines = found.get(item.recommendedStation.id);
            return lines ? { ...item, recommendedStation: { ...item.recommendedStation, lines: lines.map(line => ({ ...line })) } } : item;
        }),
    };
}

/** 서버 모드에서 이 앱 세션 안에서 본 실행이에요. 방 id → runId → createdAt (계정이 바뀌면 비워요) */
const serverRunsByRoom = new Map<string, Map<string, string>>();

function rememberServerRun(roomId: string, run: RecommendationRun) {
    const runs = serverRunsByRoom.get(roomId) ?? new Map<string, string>();
    runs.set(run.runId, run.createdAt);
    serverRunsByRoom.set(roomId, runs);
}

function listServerRuns(roomId: string) {
    return [...(serverRunsByRoom.get(roomId) ?? new Map<string, string>()).entries()]
        .map(([runId, createdAt]) => ({ runId, createdAt }))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

const recommendationsPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}/recommendations`;

/** 요청 전 계정·방 캐시 범위를 잡고, 응답 뒤 계정이 바뀌었으면 늦은 응답을 버려요(AUTH_REQUIRED). */
async function requestServerRun(action: 'create' | 'read', call: () => Promise<unknown>, allowEmpty: boolean): Promise<RecommendationRun | null> {
    try {
        const scope = getRoomCacheScope();
        const raw = await call();
        assertRoomCacheScope(scope);
        if (raw === null && allowEmpty) return null;
        const run = await attachStationLines(parseRun(raw));
        assertRoomCacheScope(scope);
        return run;
    } catch (error) {
        return toRecommendationError(error, action);
    }
}

async function fetchServerLatest(roomId: string): Promise<RecommendationRun | null> {
    if (!roomId) throw new RecommendationError('ROOM_NOT_FOUND', SERVER_ERROR_MESSAGES.ROOM_NOT_FOUND);
    const run = await requestServerRun('read', () => get<unknown>(`${recommendationsPath(roomId)}/latest`), true);
    if (run) rememberServerRun(roomId, run);
    return run;
}

async function fetchServerRun(roomId: string, runId: string): Promise<RecommendationRun> {
    if (!roomId) throw new RecommendationError('ROOM_NOT_FOUND', SERVER_ERROR_MESSAGES.ROOM_NOT_FOUND);
    if (!runId) throw new RecommendationError('RUN_NOT_FOUND', SERVER_ERROR_MESSAGES.RUN_NOT_FOUND);
    const run = await requestServerRun('read', () => get<unknown>(`${recommendationsPath(roomId)}/${encodeURIComponent(runId)}`), false);
    return run!;
}

/** 8.1 body: 값이 있는 항목만 보내고, 둘 다 없으면 빈 객체 {} 예요. */
function buildServerBody(request: RecommendationRequest): RecommendationRequest {
    const body: RecommendationRequest = {};
    const conditionText = request.conditionText?.trim();
    if (conditionText) body.conditionText = conditionText;
    const filter: RecommendationFilter = {};
    for (const [key, value] of Object.entries(request.filter ?? {}) as [keyof RecommendationFilter, unknown][]) {
        if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue;
        (filter as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(filter).length) body.filter = filter;
    return body;
}

async function createServerRecommendation(roomId: string, request: RecommendationRequest): Promise<RecommendationRun> {
    if (!roomId) throw new RecommendationError('ROOM_NOT_FOUND', SERVER_ERROR_MESSAGES.ROOM_NOT_FOUND);
    const run = await requestServerRun('create', () => post<unknown>(recommendationsPath(roomId), buildServerBody(request), { timeoutMs: RECOMMENDATION_TIMEOUT_MS }), false);
    rememberServerRun(roomId, run!);
    return run!;
}

subscribeRoomCacheReset(() => {
    runsByRoom.clear();
    createFailOnce.clear();
    latestFailOnce.clear();
    serverRunsByRoom.clear();
});
