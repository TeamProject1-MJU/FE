import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';

import type { Route } from '@/types/route';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const FALLBACK = '#a1a8b8';

/** 지도 위 점 높이 (지그재그로 배치) */
const Y_PATTERN = [0.66, 0.36, 0.5, 0.3, 0.6];

type Point = { x: number; y: number; name: string; color: string };

/**
 * 경로 지도 미리보기 (#35)
 *
 * 실제 지도 SDK 연동 전까지 쓰는 정적 그림입니다.
 * 승차역·환승역·도착역만 점으로 찍고, 구간을 노선 색으로 잇습니다.
 * TODO: 카카오맵 SDK 연동 시 steps[].path 좌표로 경로 선을 그립니다 (명세 6.1).
 */
export default function RouteMapPreview({ route }: { route: Route }) {
    const [size, setSize] = useState({ width: 0, height: 0 });

    const subwaySteps = route.steps.filter(step => step.type === 'SUBWAY');
    const names = [
        ...subwaySteps.map(step => ({ name: step.stops[0]?.name ?? '', color: step.line?.color ?? FALLBACK })),
        {
            name: subwaySteps.at(-1)?.stops.at(-1)?.name ?? '',
            color: subwaySteps.at(-1)?.line?.color ?? FALLBACK,
        },
    ];

    const onLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
    };

    const points: Point[] = names.map((item, index) => ({
        ...item,
        x: size.width * (0.12 + (0.76 * index) / Math.max(names.length - 1, 1)),
        y: size.height * Y_PATTERN[index % Y_PATTERN.length],
    }));

    return (
        <View style={styles.map} onLayout={onLayout}>
            {/* 배경: 도로와 강 */}
            {[0.2, 0.5, 0.8].map(ratio => (
                <View key={`h${ratio}`} style={[styles.roadH, { top: `${ratio * 100}%` }]} />
            ))}
            {[0.17, 0.42, 0.67, 0.9].map(ratio => (
                <View key={`v${ratio}`} style={[styles.roadV, { left: `${ratio * 100}%` }]} />
            ))}
            <View style={styles.river} />

            {/* 구간 선: 다음 점의 노선 색이 아니라 출발 점의 노선 색으로 칠합니다. */}
            {size.width > 0 &&
                points.slice(0, -1).map((from, index) => {
                    const to = points[index + 1];
                    const dx = to.x - from.x;
                    const dy = to.y - from.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

                    return (
                        <View
                            key={`seg-${index}`}
                            style={[
                                styles.segment,
                                {
                                    width: length,
                                    left: (from.x + to.x) / 2 - length / 2,
                                    top: (from.y + to.y) / 2 - 3,
                                    backgroundColor: from.color,
                                    transform: [{ rotate: `${angle}deg` }],
                                },
                            ]}
                        />
                    );
                })}

            {size.width > 0 &&
                points.map((point, index) => {
                    const isEnd = index === points.length - 1;
                    return (
                        <View key={`pt-${index}`} style={[styles.pointWrap, { left: point.x - 40, top: point.y - 30 }]}>
                            <Text style={styles.pointLabel} numberOfLines={1}>
                                {point.name}
                            </Text>
                            <View style={[styles.point, isEnd && styles.endPoint]}>
                                {isEnd && <View style={styles.endInner} />}
                            </View>
                        </View>
                    );
                })}

            <View style={styles.previewChip}>
                <Text style={styles.previewText}>지도 미리보기</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    map: {
        height: 150,
        overflow: 'hidden',
        borderRadius: 18,
        backgroundColor: '#e9eef3',
    },

    roadH: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 9,
        backgroundColor: '#f7f9fb',
    },

    roadV: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 9,
        backgroundColor: '#f7f9fb',
    },

    river: {
        position: 'absolute',
        left: -20,
        right: -20,
        top: '52%',
        height: 16,
        borderRadius: 8,
        backgroundColor: '#cfe3f2',
        transform: [{ rotate: '-4deg' }],
    },

    segment: {
        position: 'absolute',
        height: 6,
        borderRadius: 3,
    },

    pointWrap: {
        position: 'absolute',
        width: 80,
        alignItems: 'center',
    },

    pointLabel: {
        marginBottom: 3,
        paddingHorizontal: 4,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.85)',
        color: NAVY,
        fontSize: 12,
        fontWeight: '800',
    },

    point: {
        width: 14,
        height: 14,
        borderWidth: 3,
        borderColor: NAVY,
        borderRadius: 7,
        backgroundColor: '#ffffff',
    },

    endPoint: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    endInner: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: MINT,
    },

    previewChip: {
        position: 'absolute',
        right: 10,
        bottom: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.92)',
    },

    previewText: {
        color: '#6b7488',
        fontSize: 11,
        fontWeight: '700',
    },
});