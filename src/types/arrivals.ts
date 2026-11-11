import type { DirectionCode } from '@/types/congestion';

export type ArrivalsQuery = {
    stationId: number;
    lineId: number;
    nextStationId?: number;
    directionCode?: DirectionCode;
    limit?: number;
};

/** 실서버 응답 기준 열차 한 대 (#95). 화면이 쓰는 값은 destinationName·secondsUntil·message 예요. */
export type ArrivalTrain = {
    /** 행선지 역 이름(예: "성수"). 화면에는 "성수행"으로 보여줘요. 이전 이름 destinationLabel 로 와도 이 값으로 받아요. */
    destinationName: string;
    /** 서버가 보내지 않으면 null 이에요. */
    directionCode: DirectionCode | null;
    /** 알 수 없으면 null 이에요(예: "[N]번째 전역"). 이때만 message 를 시간 대신 보여줘요. */
    secondsUntil: number | null;
    /** 서버 arvlMsg2 원문이에요(예: "2분 50초 후", "전역 출발", "[2]번째 전역"). 실서버는 항상 문자열을 보내요. */
    message: string | null;
    /** 화면에서 쓰지 않는 값이에요. 없거나 형식이 다르면 빼고 받아요. stopsAway 는 "[N]번째 전역"이 아니면 null 이에요. */
    stopsAway?: number | null;
    lastTrain?: boolean;
    express?: boolean;
};

export type ArrivalsResponse = {
    /** 실서버는 보내지 않아요. 숫자로 올 때만 담아요. */
    stationId?: number;
    lineId?: number;
    available: boolean;
    reason: 'UNSUPPORTED_STATION' | 'NO_DATA' | 'UPSTREAM_ERROR' | 'DISABLED' | null;
    receivedAt: string | null;
    trains: ArrivalTrain[];
};
