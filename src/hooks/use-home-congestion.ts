import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getSessionGeneration } from '@/services/auth';
import { fetchCongestion } from '@/services/congestion';
import type { CongestionResponse } from '@/types/congestion';
import { toCongestion } from '@/types/congestion';
import type { Station } from '@/types/station';
import type { Coordinate } from '@/utils/home-map';
import {
    highestHomeCongestion, homeCongestionDirections, homeCongestionPreview, homeCongestionTime,
    nearestHomeStation, type HomeCongestionState,
} from '@/utils/home-congestion';

export function useHomeCongestion({ serverMode, account, location, locationLoading, stations, mock }: {
    serverMode: boolean;
    account: string | null;
    location: Coordinate | null;
    locationLoading: boolean;
    stations: readonly Station[];
    mock?: string | string[];
}): HomeCongestionState {
    const station = useMemo(() => serverMode ? nearestHomeStation(location, stations) : null, [serverMode, location, stations]);
    const line = station?.lines[0];
    const stationId = station?.id;
    const stationName = station?.name ?? '';
    const lineId = line?.lineId;
    const lineName = line?.lineName ?? '';
    const lineColor = line?.color ?? '';
    const stationCode = line?.stationCode ?? '';
    const hasLocation = !!location;
    const [result, setResult] = useState<{ generation: number; account: string | null; state: HomeCongestionState } | null>(null);
    // Screen-local memory only. No coordinates, storage, timers, or additional station requests.
    const cache = useRef(new Map<string, Promise<CongestionResponse | null>>());
    const cacheScope = useRef<string | null>(null);

    useFocusEffect(useCallback(() => {
        if (!serverMode) return;
        const generation = getSessionGeneration();
        const scope = `${generation}:${account}`;
        if (cacheScope.current !== scope) { cache.current.clear(); cacheScope.current = scope; }
        let active = true;
        let releasePending: (() => void) | undefined;
        const valid = () => active && generation === getSessionGeneration();
        const show = (state: HomeCongestionState) => {
            if (valid()) setResult({ generation, account, state });
        };
        if (!account) show({ kind: 'hidden' });
        else if (!hasLocation) show({ kind: 'off' });
        else if (!stationId || !lineId) show({ kind: 'hidden' });
        else {
            const { date, time, slot } = homeCongestionTime(new Date());
            const key = `${generation}:${account}:${stationId}:${lineId}:${date}:${slot}`;
            let pending = cache.current.get(key);
            if (!pending) {
                pending = Promise.all(homeCongestionDirections(lineName).map(direction => fetchCongestion({
                    stationId, lineId, direction, date, time,
                }))).then(highestHomeCongestion).catch(() => null);
                cache.current.set(key, pending);
            }
            show({ kind: 'loading' });
            let completed = false;
            releasePending = () => {
                if (!completed && cache.current.get(key) === pending) cache.current.delete(key);
            };
            void pending.then(response => {
                completed = true;
                show(response ? {
                    kind: 'ready', data: { station: { id: stationId, name: stationName }, line: { lineId, lineName, color: lineColor, stationCode }, direction: response.direction, congestion: toCongestion(response) },
                } : { kind: 'hidden' });
            });
        }
        return () => { active = false; releasePending?.(); };
    }, [serverMode, account, hasLocation, stationId, stationName, lineId, lineName, lineColor, stationCode]));

    if (!serverMode) {
        const preview = homeCongestionPreview(serverMode, mock);
        return preview ? { kind: 'ready', data: preview } : { kind: 'off' };
    }
    if (!result || result.account !== account || result.generation !== getSessionGeneration()) return { kind: 'hidden' };
    if (locationLoading) return { kind: 'loading' };
    return result.state;
}
