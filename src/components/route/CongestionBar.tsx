import { StyleSheet, View } from 'react-native';

import { congestionColor } from '@/components/route/Congestion';
import type { Route } from '@/types/route';

const WALK = '#e3e6ec';

type Props = {
    route: Route;
    height?: number;
};

/**
 * 경로 혼잡도 바 (#36)
 *
 * 명세 6.2: 경로 바를 단계별 색으로 칠한다. 역과 역 사이 구간은 출발 쪽 역의 단계 색,
 * 데이터가 없는 역(supported: false)은 회색. 도보 구간은 연한 회색입니다.
 * 구간 길이는 소요 시간 비율입니다.
 */
export default function CongestionBar({ route, height = 6 }: Props) {
    return (
        <View style={[styles.bar, { height, borderRadius: height / 2 }]}>
            {route.steps.flatMap((step, stepIndex) => {
                const weight = Math.max(step.durationSec, 60);
                const stations = step.stations ?? [];

                if (step.type === 'WALKING' || stations.length < 2) {
                    return [
                        <View
                            key={`${stepIndex}`}
                            style={{
                                flex: weight,
                                backgroundColor:
                                    step.type === 'WALKING' ? WALK : congestionColor(stations[0]?.congestion),
                            }}
                        />,
                    ];
                }

                // 정차역 사이 구간마다 출발 쪽 역 색
                return stations.slice(0, -1).map((station, index) => (
                    <View
                        key={`${stepIndex}-${index}`}
                        style={{
                            flex: weight / (stations.length - 1),
                            backgroundColor: congestionColor(station.congestion),
                        }}
                    />
                ));
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        overflow: 'hidden',
        gap: 1,
    },
});