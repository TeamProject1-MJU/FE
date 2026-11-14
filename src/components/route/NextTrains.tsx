import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { arrivalsCountdownBase, arrivalsElapsedSec, formatNextTrain } from '@/components/route/format';
import { isAuthError } from '@/services/api/errors';
import { fetchArrivals, type ArrivalsMock } from '@/services/arrivals';
import type { ArrivalsResponse } from '@/types/arrivals';
import type { RouteStep } from '@/types/route';

/** 서버가 (역, 노선)별로 10~20초 캐시하고 일일 호출 한도가 있어 15~30초 사이로 지켜요. */
const ARRIVALS_POLL_MS = 20000;

/**
 * 첫 승차 구간만 독립적으로 갱신하여 경로와 전체 목록의 재렌더링을 줄입니다.
 * available:false·열차 없음·호출 실패면 줄을 숨기고, 인증 오류는 A-1 공통 처리에 맡겨 이전 값을 그대로 둬요.
 * 남은 시간은 응답을 받은 순간의 앱 시각(baseMs)부터 지난 초만 빼요(#173, format.ts arrivalsCountdownBase).
 * 기준 시각은 새 응답을 받았을 때만 응답과 함께 바꿔요. 인증 오류로 이전 값을 유지할 때는 이전 기준 시각도 그대로 둬서
 * 카운트다운이 이어지고, 그 밖의 실패는 줄을 숨겨 기준 시각도 함께 버려요.
 */
export default function NextTrains({ step, mock }: { step: RouteStep; mock?: ArrivalsMock }) {
    const [fetched, setFetched] = useState<{ data: ArrivalsResponse; baseMs: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [now, setNow] = useState(Date.now());
    const stationId = step.stops[0]?.id;
    const nextStationId = step.stops[1]?.id;
    const lineId = step.line?.id;
    const directionCode = step.directionCode ?? undefined;

    useFocusEffect(useCallback(() => {
        let active = true;
        let pending = false;
        setFetched(null);
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
                    const baseMs = arrivalsCountdownBase();
                    setFetched({ data: response, baseMs });
                    setNow(baseMs);
                }
            } catch (error) {
                // 인증 오류는 공통 처리(갱신·로그인 이동)에 맡기고 줄이 깜빡이지 않게 이전 값을 유지해요.
                if (active && !isAuthError(error)) setFetched(null);
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

    const data = fetched?.data;
    // receivedAt 은 계산에 쓰지 않아 검사하지 않아요. available:true 응답의 receivedAt 형식은 파서가 이미 확인해요.
    if (!loading && (!data?.available || !data.trains.length)) return null;
    const elapsed = fetched ? arrivalsElapsedSec(fetched.baseMs, now) : 0;

    return (
        <View style={styles.row}>
            <Text style={styles.text}>
                다음 열차{loading ? ' 확인 중' : ` · ${data!.trains.slice(0, 2).map(train => formatNextTrain(train, elapsed)).join(' · ')}`}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { minHeight: 44, justifyContent: 'center' },
    text: { color: '#6b7488', fontSize: 13, lineHeight: 22, fontWeight: '600' },
});
