import { Fragment, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/app-text';
import RouteMapMarker from '@/components/route/RouteMapMarker';
import RouteMapLegend from '@/components/route/RouteMapLegend';
import { buildRouteMap } from '@/utils/route-map';
import { layoutRouteMapPreview, PREVIEW_LABEL_FONT_SIZE, PREVIEW_LABEL_LINE_HEIGHT } from '@/utils/route-map-preview';
import type { Route } from '@/types/route';

const FALLBACK = '#a1a8b8';

/** 실제 좌표를 쓰지 않는 예시 지도예요. 이름 길이와 화면 폭에 맞춰 표시 공간을 나눠요. */
export default function RouteMapPreview({ route }: { route: Route }) {
    const [width, setWidth] = useState(0);
    const { fontScale } = useWindowDimensions();
    const legend = useMemo(() => buildRouteMap(route), [route]);
    const subwaySteps = route.steps.filter(step => step.type === 'SUBWAY');
    const stations = subwaySteps.length ? [
        ...subwaySteps.map(step => ({ name: step.stops[0]?.name ?? '', color: step.line?.color ?? FALLBACK })),
        { name: subwaySteps.at(-1)?.stops.at(-1)?.name ?? '', color: subwaySteps.at(-1)?.line?.color ?? FALLBACK },
    ] : [];
    const layout = layoutRouteMapPreview(stations.map(station => station.name), width, fontScale);
    const points = layout.points;

    const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

    return (
        <View style={styles.preview}>
            <View style={[styles.map, { height: layout.height }]} onLayout={onLayout}>
                {/* 배경: 도로와 강 */}
                {[0.2, 0.5, 0.8].map(ratio => (
                    <View key={`h${ratio}`} style={[styles.roadH, { top: `${ratio * 100}%` }]} />
                ))}
                {[0.17, 0.42, 0.67, 0.9].map(ratio => (
                    <View key={`v${ratio}`} style={[styles.roadV, { left: `${ratio * 100}%` }]} />
                ))}
                <View style={styles.river} />

                {/* 각 구간의 출발 노선 색으로 연결하고, 아이콘의 실제 기준점에 선을 맞춰요. */}
                {points.slice(0, -1).map((from, index) => {
                    const to = points[index + 1];
                    const dx = to.x - from.x;
                    const dy = to.y - from.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                    return <View key={`seg-${index}`} style={[styles.segment, {
                        width: length,
                        left: (from.x + to.x) / 2 - length / 2,
                        top: (from.y + to.y) / 2 - 3,
                        backgroundColor: stations[index].color,
                        transform: [{ rotate: `${angle}deg` }],
                    }]} />;
                })}

                {points.map((point, index) => (
                    <Fragment key={`pt-${index}`}>
                        <View style={[styles.pointWrap, point.marker]}>
                            <RouteMapMarker kind={point.kind} size={point.marker.width} />
                        </View>
                        {/* 이름표는 작은 아이콘 상자 밖에서 독립적인 폭을 가져요. */}
                        {!!point.name && <View style={[styles.pointLabel, {
                            left: point.label.left, top: point.label.top,
                            width: point.label.width, height: point.label.height,
                        }]}>
                            <Text style={styles.pointLabelText} accessibilityLabel={point.name}>{point.label.text}</Text>
                        </View>}
                    </Fragment>
                ))}

                <View style={styles.previewChip}>
                    <Text style={styles.previewText}>지도 미리보기</Text>
                </View>
            </View>
            <RouteMapLegend compact map={legend} />
        </View>
    );
}

const styles = StyleSheet.create({
    preview: { gap: 8 },
    map: { overflow: 'hidden', borderRadius: 18, backgroundColor: '#e9eef3' },
    roadH: { position: 'absolute', left: 0, right: 0, height: 9, backgroundColor: '#f7f9fb' },
    roadV: { position: 'absolute', top: 0, bottom: 0, width: 9, backgroundColor: '#f7f9fb' },
    river: {
        position: 'absolute', left: -20, right: -20, top: '52%', height: 16,
        borderRadius: 8, backgroundColor: '#cfe3f2', transform: [{ rotate: '-4deg' }],
    },
    segment: { position: 'absolute', height: 6, borderRadius: 3 },
    pointWrap: { position: 'absolute' },
    pointLabel: {
        position: 'absolute', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5,
        backgroundColor: 'rgba(255,255,255,0.9)',
    },
    pointLabelText: {
        textAlign: 'center', color: '#4A4553', fontSize: PREVIEW_LABEL_FONT_SIZE,
        lineHeight: PREVIEW_LABEL_LINE_HEIGHT, fontWeight: '600',
    },
    previewChip: {
        position: 'absolute', right: 10, bottom: 10, paddingHorizontal: 8,
        paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.92)',
    },
    previewText: { color: '#6b7488', fontSize: 11, fontWeight: '700' },
});
