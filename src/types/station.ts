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
