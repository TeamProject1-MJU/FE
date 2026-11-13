import { StyleSheet, Text, View } from 'react-native';

import { CONGESTION_STYLE } from '@/components/route/Congestion';
import LineBadge from '@/components/route/LineBadge';
import {
    CONGESTION_LEVEL_LABEL,
    CONGESTION_LEVELS,
    ROUTE_MARKER_COLOR,
    ROUTE_MARKER_LABEL,
    WALK_LINE_COLOR,
    type RouteMap,
    type RouteMapLegendLine,
    type RouteMarkerKind,
} from '@/utils/route-map';

const NAVY = '#0f1c3f';
const SECONDARY = '#6b7488';
const MARKERS: RouteMarkerKind[] = ['origin', 'transfer', 'destination'];

function Swatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
    return dashed
        ? <View style={styles.dashRow}>{[0, 1, 2].map(i => <View key={i} style={[styles.dash, { backgroundColor: color }]} />)}</View>
        : <View style={[styles.swatch, { backgroundColor: color }]} />;
}

function LineEntry({ line }: { line: RouteMapLegendLine }) {
    // 노선 번호와 색이 있으면 기존 노선 배지, 아니면 있는 값(색·이름)만 보여줘요.
    if (line.color && line.id != null) {
        return <LineBadge line={{ id: line.id, name: line.name ?? '', color: line.color }} withName={!!line.name} size={16} />;
    }
    return <View style={styles.item}>
        {!!line.color && <Swatch color={line.color} />}
        {!!line.name && <Text style={styles.lineName}>{line.name}</Text>}
    </View>;
}

/**
 * 경로 지도 범례 (#129)
 *
 * 색만으로 구분하지 않도록 모든 색 옆에 글자를 붙이고, 작은 화면·큰 글꼴에서는 줄바꿈해요.
 * 혼잡도 색으로 칠하면 선 색으로 노선을 구분할 수 없으니 타는 순서대로 노선 색과 이름을 함께 보여줘요.
 */
export default function RouteMapLegend({ map }: { map: RouteMap }) {
    return (
        <View style={styles.legend} accessibilityLabel="경로 지도 범례">
            <View style={styles.row}>
                <Text style={styles.title}>혼잡도</Text>
                {CONGESTION_LEVELS.map(level => (
                    <View key={level} style={styles.item}>
                        <Swatch color={CONGESTION_STYLE[level].color} />
                        <Text style={styles.text}>{CONGESTION_LEVEL_LABEL[level]}</Text>
                    </View>
                ))}
                {map.estimated && <View style={styles.tag}><Text style={styles.tagText}>추정</Text></View>}
                {map.mock && <View style={styles.tag}><Text style={styles.tagText}>임시</Text></View>}
            </View>

            <View style={styles.row}>
                <View style={styles.item}>
                    <Swatch color={WALK_LINE_COLOR} dashed />
                    <Text style={styles.text}>도보</Text>
                </View>
                {MARKERS.map(kind => (
                    <View key={kind} style={styles.item}>
                        <View style={[styles.marker, { backgroundColor: ROUTE_MARKER_COLOR[kind] }]} />
                        <Text style={styles.text}>{ROUTE_MARKER_LABEL[kind]}</Text>
                    </View>
                ))}
            </View>

            {map.routeLines.length > 0 && (
                <View style={styles.row}>
                    <Text style={styles.title}>노선</Text>
                    {map.routeLines.map((line, index) => <LineEntry key={`${index}-${line.id ?? line.name}`} line={line} />)}
                </View>
            )}

            {map.usesLineColor && <Text style={styles.note}>혼잡도 정보가 없는 구간은 노선 색으로 그려요.</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    legend: {
        gap: 6,
        paddingHorizontal: 4,
    },

    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 10,
        rowGap: 4,
    },

    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },

    title: {
        color: NAVY,
        fontSize: 12,
        fontWeight: '800',
    },

    text: {
        color: SECONDARY,
        fontSize: 12,
        fontWeight: '600',
    },

    lineName: {
        color: NAVY,
        fontSize: 12,
        fontWeight: '700',
    },

    swatch: {
        width: 14,
        height: 5,
        borderRadius: 3,
    },

    dashRow: {
        flexDirection: 'row',
        gap: 2,
    },

    dash: {
        width: 4,
        height: 4,
        borderRadius: 2,
    },

    marker: {
        width: 11,
        height: 11,
        borderWidth: 2,
        borderColor: '#ffffff',
        borderRadius: 6,
    },

    tag: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: '#d9dde4',
        borderRadius: 5,
    },

    tagText: {
        color: SECONDARY,
        fontSize: 10.5,
        fontWeight: '700',
    },

    note: {
        color: SECONDARY,
        fontSize: 11.5,
    },
});
