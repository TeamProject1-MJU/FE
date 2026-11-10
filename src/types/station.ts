export type StationLine = {
    lineId: number;
    lineName: string;
    color: string;
    stationCode: string;
};

export type Station = {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    isSupported: boolean;
    lines: StationLine[];
};

export type StationSearchOptions = {
    lineId?: number;
    page?: number;
    size?: number;
};

export type StationSearchResult = {
    items: Station[];
    page: number;
    size: number;
    totalElements: number;
};

/** 명세 5.3 GET /stations/{id} 응답. 5.2 items 한 건과 같은 모양이에요. */
export type StationDetail = Station;

/** 명세 5.1 GET /lines 응답 항목 */
export type Line = {
    id: number;
    /** 노선 코드 문자열. 서버 값은 1호선 "1" … 8호선 "8" 이에요(명세 5.1 예시 "2"). */
    lineCode: string;
    name: string;
    color: string;
};
