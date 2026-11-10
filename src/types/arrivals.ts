import type { DirectionCode } from '@/types/congestion';

export type ArrivalsQuery = {
    stationId: number;
    lineId: number;
    nextStationId?: number;
    directionCode?: DirectionCode;
    limit?: number;
};

export type ArrivalsResponse = {
    stationId: number;
    lineId: number;
    available: boolean;
    reason: 'UNSUPPORTED_STATION' | 'NO_DATA' | 'UPSTREAM_ERROR' | 'DISABLED' | null;
    receivedAt: string | null;
    trains: {
        destinationLabel: string;
        directionCode: DirectionCode | null;
        nextStationName: string | null;
        secondsUntil: number;
        message: string | null;
    }[];
};
