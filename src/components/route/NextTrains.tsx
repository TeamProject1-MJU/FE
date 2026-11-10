import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { fetchArrivals, type ArrivalsMock } from '@/services/arrivals';
import type { ArrivalsResponse } from '@/types/arrivals';
import type { RouteStep } from '@/types/route';

const ARRIVALS_POLL_MS = 20000;

/** 첫 승차 구간만 독립적으로 갱신하여 경로와 전체 목록의 재렌더링을 줄입니다. */
export default function NextTrains({ step, mock }: { step: RouteStep; mock?: ArrivalsMock }) {
    const [data, setData] = useState<ArrivalsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(Date.now());
    const stationId = step.stops[0]?.id;
    const nextStationId = step.stops[1]?.id;
    const lineId = step.line?.id;
    const directionCode = step.directionCode ?? undefined;

    useFocusEffect(useCallback(() => {
        let active = true;
        let pending = false;
        setData(null);
        setLoading(true);
        if (stationId == null || lineId == null) {
            setLoading(false);
            return;
        }

        const refresh = async () => {
            if (pending) return;
            pending = true;
            try {
                const response = await fetchArrivals({ stationId, lineId, nextStationId, directionCode, limit: 2 }, mock);
                if (active) {
                    setData(response);
                    setNow(Date.now());
                }
            } catch {
                if (active) setData(null);
            } finally {
                pending = false;
                if (active) setLoading(false);
            }
        };
        void refresh();
        const polling = setInterval(() => { void refresh(); }, ARRIVALS_POLL_MS);
        const ticking = setInterval(() => setNow(Date.now()), 1000);
        return () => {
            active = false;
            clearInterval(polling);
            clearInterval(ticking);
        };
    }, [stationId, lineId, nextStationId, directionCode, mock]));

    const receivedAt = data?.receivedAt ? Date.parse(data.receivedAt) : NaN;
    if (!loading && (!data?.available || !data.trains.length || !Number.isFinite(receivedAt))) return null;
    const elapsed = Number.isFinite(receivedAt) ? Math.max(0, Math.floor((now - receivedAt) / 1000)) : 0;

    return (
        <View style={styles.row}>
            <Text style={styles.text}>
                다음 열차{loading ? ' 확인 중' : ` · ${data!.trains.slice(0, 2).map(train => {
                    const seconds = Math.max(0, train.secondsUntil - elapsed);
                    return `${train.destinationLabel} ${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
                }).join(' · ')}`}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { minHeight: 44, justifyContent: 'center' },
    text: { color: '#6b7488', fontSize: 13, lineHeight: 22, fontWeight: '600' },
});
