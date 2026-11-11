import { formatStationName } from '@/utils/station-name';
import { useEffect, useRef, useState } from 'react';

import { openStationPicker } from '@/app/station-search';
import { setSelectedStation } from '@/services/room';
import {
    RoomError,
    type RoomDetail,
    type RoomStation,
    type SelectedStationMock,
} from '@/types/room';

type Request = {
    roomId: string;
    station: RoomStation | null;
    previous: RoomStation | null;
};

type Notice = {
    roomId: string;
    text: string;
    error: boolean;
    retry: boolean;
    pick: boolean;
};

export function selectedStationName(station: RoomStation) {
    return formatStationName(station.name);
}

/** 기존 조회 실패 쿼리는 유지하고, 저장 실패를 별도로 제어해요. */
function mockFor(
    value: string | undefined,
    clearing: boolean,
): SelectedStationMock | undefined {
    if (clearing) return value === 'clear-error' ? 'busy' : undefined;
    if (value === 'select-error') return 'busy';
    if (value === 'select-unsupported') return 'unsupported';
    if (value === 'select-missing') return 'missing';
    if (value === 'select-owner-lost') return 'owner-lost';
}

export function useSelectedStation({
                                       detail,
                                       mock,
                                       onChanged,
                                   }: {
    detail: RoomDetail | null;
    mock?: string;
    onChanged: () => Promise<void>;
}) {
    const [request, setRequest] = useState<Request | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);
    const inFlight = useRef(false);
    const consumed = useRef(new Set<string>());
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
        };
    }, []);

    const choose = (station: RoomStation | null) => {
        if (!detail || detail.myRole !== 'OWNER' || inFlight.current) return;
        if (station === null && detail.selectedStation === null) return;

        setNotice(null);
        setRequest({
            roomId: detail.id,
            station,
            previous: detail.selectedStation,
        });
    };

    const pick = () => {
        if (!detail || detail.myRole !== 'OWNER' || inFlight.current) return;

        setRequest(null);
        setNotice(null);

        openStationPicker(
            {
                purpose: 'selected-station',
                contextLabel: detail.name,
                selectedStationId: detail.selectedStation?.id,
            },
            choose,
        );
    };

    const submit = async () => {
        if (
            !request ||
            !detail ||
            request.roomId !== detail.id ||
            detail.myRole !== 'OWNER' ||
            inFlight.current
        ) {
            return;
        }

        inFlight.current = true;
        setBusy(true);
        setNotice(null);

        const key = `${request.roomId}:${mock ?? ''}`;
        const failure = consumed.current.has(key)
            ? undefined
            : mockFor(mock, request.station === null);

        if (failure) consumed.current.add(key);

        try {
            await setSelectedStation(request.roomId, request.station, failure);
            if (!mounted.current) return;

            // API 7.4·7.15를 재조회해요.
            // 방 목록은 기존 useFocusEffect로 복귀할 때 재조회해요.
            await onChanged();
            if (!mounted.current) return;

            setRequest(null);
            setNotice({
                roomId: request.roomId,
                text: request.station
                    ? `${selectedStationName(request.station)}${
                        request.previous
                            ? '으로 약속역을 변경했어요.'
                            : '으로 약속역을 확정했어요.'
                    }`
                    : '약속역 확정을 해제했어요. 후보와 투표는 그대로 유지돼요.',
                error: false,
                retry: false,
                pick: false,
            });
        } catch (error) {
            if (!mounted.current) return;

            const code = error instanceof RoomError ? error.code : null;
            const retry =
                code === 'ROOM_BUSY' ||
                code === 'NETWORK_ERROR' ||
                code === null;
            const pickAgain =
                code === 'STATION_NOT_FOUND' ||
                code === 'STATION_UNSUPPORTED';

            setNotice({
                roomId: request.roomId,
                text:
                    error instanceof RoomError
                        ? error.message
                        : '요청을 완료하지 못했어요. 다시 시도해 주세요.',
                error: true,
                retry,
                pick: pickAgain,
            });

            if (!retry) setRequest(null);

            if (
                code === 'NOT_ROOM_OWNER' ||
                code === 'NOT_ROOM_MEMBER' ||
                code === 'ROOM_NOT_FOUND'
            ) {
                await onChanged();
            }
        } finally {
            inFlight.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    const cancel = () => {
        if (inFlight.current) return;

        setRequest(null);
        setNotice(null);
    };

    return {
        busy,
        choose,
        pick,
        submit,
        cancel,
        request:
            detail?.myRole === 'OWNER' && request?.roomId === detail.id
                ? request
                : null,
        notice: notice?.roomId === detail?.id ? notice : null,
    };
}