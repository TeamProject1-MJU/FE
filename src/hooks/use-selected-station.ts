import { formatStationName } from '@/utils/station-name';
import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ApiError, isAuthError } from '@/services/api/errors';
import { getSessionGeneration } from '@/services/auth';

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

    const actionId = useRef(0);
    const currentRoom = useRef(detail?.id);
    useFocusEffect(useCallback(() => {
        currentRoom.current = detail?.id;
        mounted.current = true;
        if (!inFlight.current) setBusy(false);
        return () => { mounted.current = false; actionId.current++; };
    }, [detail?.id]));

    const choose = (station: RoomStation | null) => {
        if (!detail || currentRoom.current !== detail.id || detail.myRole !== 'OWNER' || inFlight.current) return;
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

        const generation = getSessionGeneration();
        openStationPicker(
            {
                purpose: 'selected-station',
                contextLabel: detail.name,
                selectedStationId: detail.selectedStation?.id,
            },
            station => {
                if (generation === getSessionGeneration() && currentRoom.current === detail.id) choose(station);
            },
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

        const id = ++actionId.current;
        const generation = getSessionGeneration();
        const isCurrent = () => mounted.current && id === actionId.current
            && currentRoom.current === request.roomId && generation === getSessionGeneration();
        try {
            await setSelectedStation(request.roomId, request.station, failure);
            if (!isCurrent()) return;

            // API 7.4·7.15를 재조회해요.
            // 방 목록은 기존 useFocusEffect로 복귀할 때 재조회해요.
            await onChanged();
            if (!isCurrent()) return;

            setRequest(null);
            setNotice({
                roomId: request.roomId,
                text: request.station && request.previous?.id === request.station.id
                    ? `${selectedStationName(request.station)}의 확정 시각을 갱신했어요.`
                    : request.station
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
            if (!isCurrent() || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;

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

            if (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') {
                router.replace('/rooms');
            } else if (code === 'NOT_ROOM_OWNER') {
                await onChanged();
            }
        } finally {
            inFlight.current = false;
            if (mounted.current && currentRoom.current === request.roomId && generation === getSessionGeneration()) setBusy(false);
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