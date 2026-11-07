/**
 * 혼잡도 조회 타입 (API 명세 v1.12 6.2 GET /congestion 기준)
 */

import type { Congestion, CongestionLevel } from '@/types/route';

export type DirectionCode = 'UP' | 'DOWN' | 'INNER' | 'OUTER' | 'LOOP';
export type DayType = 'WEEKDAY' | 'SATURDAY' | 'SUNDAY';
export type CongestionSource = 'PREDICTED' | 'MOCK';

export type CongestionQuery = {
    stationId: number;
    lineId: number;
    direction: DirectionCode;
    dayType: DayType;
    /** HH:mm */
    time: string;
    /** yyyy-MM-dd (선택, 23:30 이후 조회에서 다음 날 dayType 을 구할 때 필요) */
    date?: string;
};

/**
 * 6.2 응답 data
 *
 * 명세 예시에는 supported 가 없고 출처 이름이 source 입니다(6.1 은 kind).
 * 백엔드 확정 전이라 supported·kind 도 선택으로 받아 둡니다.
 */
export type CongestionResponse = {
    stationId: number;
    lineId: number;
    direction: DirectionCode;
    dayType: DayType;
    slotStart: string;
    /** 첫차 시간대로 바꿔 조회했을 때 실제로 조회한 날짜 */
    slotDate: string | null;
    firstTrain: boolean;
    pct: number | null;
    level: CongestionLevel | null;
    levelLabel: string | null;
    source?: CongestionSource | null;
    kind?: CongestionSource | null;
    supported?: boolean;
};

/** 혼잡도를 어느 시간대 기준으로 조회했는지 (6.1 stations[], 6.2 응답 공통) */
export type CongestionSlot = {
    slotStart: string;
    slotDate: string | null;
    firstTrain: boolean;
};

/** 6.2 응답을 6.1 과 같은 congestion 모양으로 바꿉니다. 단계·라벨은 서버 값을 그대로 씁니다. */
export function toCongestion(data: CongestionResponse): Congestion {
    const supported = data.supported ?? data.level != null;
    return {
        supported,
        kind: supported ? data.kind ?? data.source ?? null : null,
        pct: supported ? data.pct : null,
        level: supported ? data.level : null,
        levelLabel: supported ? data.levelLabel : null,
    };
}