import { formatStationName } from '@/utils/station-name';
import { formatDirection, formatWait } from '@/components/route/format';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Congestion, { congestionColor } from '@/components/route/Congestion';
import LineBadge from '@/components/route/LineBadge';
import type { Congestion as CongestionData, Route, RouteStep } from '@/types/route';

const NAVY = '#0f1c3f';
const MINT_DEEP = '#12a77a';
const SECONDARY = '#6b7488';
const BACKGROUND = '#f3f5f8';
const UNSUPPORTED = '#a1a8b8';
const WALK_LINE = '#b9c0cc';

const LEVEL_ORDER = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'] as const;

const toMinutes = (sec: number) => Math.max(1, Math.round(sec / 60));
const pad = (value: number) => String(value).padStart(2, '0');
const formatClock = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 구간 안 정차역 혼잡도 중 가장 높은 값 */
function stepCongestion(step: RouteStep): CongestionData | null {
    let best: CongestionData | null = null;
    for (const station of step.stations ?? []) {
        const level = station.congestion.level;
        if (!station.congestion.supported || !level) continue;
        if (!best?.level || LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(best.level)) {
            best = station.congestion;
        }
    }
    return best;
}

/** 정차역 하나의 혼잡도 색 (데이터 없으면 회색, 명세 6.2) */
/** 정차역 하나의 혼잡도 라벨 (색만으로 구분하지 않도록 글자도 함께, 명세 6.2) */
function stopLabel(step: RouteStep, stopIndex: number) {
    const congestion = step.stations?.[stopIndex]?.congestion;
    return congestion?.supported && congestion.level ? congestion.levelLabel ?? '' : '미제공';
}

type Props = {
    route: Route;
    nextTrains?: ReactNode;
    /** 승차 구간의 '표지판으로 방향 확인' 버튼 */
    onSignCheck: (step: RouteStep) => void;
};

/**
 * 경로 구간 목록 (#35)
 * 명세 6.1 route.steps 를 순서대로 그립니다: 승차 → (중간역) → 하차 → 환승 도보 → … → 도착
 */
export default function RouteTimeline({ route, onSignCheck, nextTrains }: Props) {
    const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});

    const lastSubwayIndex = route.steps.reduce(
        (last, step, index) => (step.type === 'SUBWAY' ? index : last),
        -1,
    );
    const arrival = formatClock(route.summary.arrivalAt);

    const toggle = (index: number) => {
        setOpenSteps(prev => ({ ...prev, [index]: !prev[index] }));
    };

    return (
        <View style={styles.card}>
            {route.steps.map((step, index) => {
                if (step.type === 'WALKING') {
                    return (
                        <View key={`walk-${index}`} style={styles.walkRow}>
                            <View style={styles.walkRail} />
                            <View style={styles.walkBox}>
                                <Ionicons name="walk-outline" size={18} color={MINT_DEEP} />
                                <Text style={styles.walkText}>
                                    {step.guidance} · 도보 {toMinutes(step.durationSec)}분
                                    {step.distanceM > 0 ? ` · ${step.distanceM}m` : ''}
                                </Text>
                            </View>
                        </View>
                    );
                }

                const color = step.line?.color ?? UNSUPPORTED;
                const first = step.stops[0];
                const last = step.stops.at(-1);
                const middle = step.stops.slice(1, -1);
                const open = !!openSteps[index];
                const isLastSubway = index === lastSubwayIndex;

                return (
                    <View key={`ride-${index}`}>
                        {/* 승차 */}
                        <View style={styles.segment}>
                            <View style={styles.gutter}>
                                <View style={[styles.ring, { borderColor: color }]} />
                                <View style={[styles.rail, { backgroundColor: color }]} />
                            </View>

                            <View style={styles.body}>
                                <View style={styles.row}>
                                    <Tag label="승차" color={color} />
                                    <Text style={styles.stationName} numberOfLines={1}>
                                        {formatStationName(first?.name)}
                                    </Text>
                                    <View style={styles.flex} />
                                    <Congestion congestion={stepCongestion(step)} slot={step.stations?.[0]} compact />
                                </View>

                                <View style={[styles.row, styles.meta]}>
                                    <LineBadge line={step.line} />
                                    <Text style={styles.metaText} numberOfLines={2}>
                                        {step.line?.name ?? ''} {formatDirection(step)} · {Math.max(step.stops.length - 1, 0)}개역{' '}
                                        {toMinutes(step.durationSec)}분
                                    </Text>
                                </View>

                                {!!formatWait(step, route.steps.slice(0, index).some(previous => previous.type === 'SUBWAY')) && (
                                    <Text style={styles.metaText}>{formatWait(step, route.steps.slice(0, index).some(previous => previous.type === 'SUBWAY'))}</Text>
                                )}

                                {index === route.steps.findIndex(item => item.type === 'SUBWAY') && nextTrains}

                                {middle.length > 0 && (
                                    <Pressable
                                        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
                                        onPress={() => toggle(index)}
                                        accessibilityRole="button"
                                        accessibilityState={{ expanded: open }}
                                    >
                                        <Text style={styles.toggleText}>
                                            {open ? '중간역 접기' : `중간역 ${middle.length}개 보기`}
                                        </Text>
                                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#4b5468" />
                                    </Pressable>
                                )}

                                {open &&
                                    middle.map((stop, stopIndex) => (
                                        <View key={`${index}-${stop.id}-${stop.order}`} style={styles.stopRow}>
                                            <View style={[styles.stopDot, { borderColor: color }]} />
                                            <Text style={styles.stopName} numberOfLines={1}>
                                                {formatStationName(stop.name)}
                                            </Text>
                                            <View
                                                style={[
                                                    styles.stopLevel,
                                                    {
                                                        backgroundColor: congestionColor(
                                                            step.stations?.[stopIndex + 1]?.congestion,
                                                        ),
                                                    },
                                                ]}
                                            />
                                            <Text
                                                style={[
                                                    styles.stopLevelText,
                                                    {
                                                        color: congestionColor(
                                                            step.stations?.[stopIndex + 1]?.congestion,
                                                        ),
                                                    },
                                                ]}
                                            >
                                                {stopLabel(step, stopIndex + 1)}
                                            </Text>
                                        </View>
                                    ))}

                                <Pressable
                                    style={({ pressed }) => [styles.signButton, pressed && styles.pressed]}
                                    onPress={() => onSignCheck(step)}
                                    accessibilityRole="button"
                                >
                                    <Ionicons name="camera-outline" size={17} color={NAVY} />
                                    <Text style={styles.signText}>표지판으로 방향 확인</Text>
                                </Pressable>
                            </View>
                        </View>

                        {/* 하차 또는 도착 */}
                        {isLastSubway ? (
                            <View style={styles.segment}>
                                <View style={styles.gutter}>
                                    <View style={[styles.endDot, { backgroundColor: color }]}>
                                        <View style={styles.endInner} />
                                    </View>
                                </View>
                                <View style={styles.body}>
                                    <View style={styles.row}>
                                        <Tag label="도착" color={MINT_DEEP} background="#e8f8f1" />
                                        <Text style={styles.stationName} numberOfLines={1}>
                                            {formatStationName(last?.name)}
                                        </Text>
                                    </View>
                                    {!!arrival && <Text style={styles.arrivalText}>{arrival} 도착 예정</Text>}
                                </View>
                            </View>
                        ) : (
                            <View style={styles.segment}>
                                <View style={styles.gutter}>
                                    <View style={[styles.ring, { borderColor: color }]} />
                                </View>
                                <View style={styles.body}>
                                    <View style={styles.row}>
                                        <Tag label="하차" color="#4b5468" background="#eef1f5" />
                                        <Text style={styles.stationName} numberOfLines={1}>
                                            {formatStationName(last?.name)}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

function Tag({ label, color, background }: { label: string; color: string; background?: string }) {
    return (
        <View style={[styles.tag, { backgroundColor: background ?? `${color}1f` }]}>
            <Text style={[styles.tagText, { color }]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    card: {
        paddingTop: 16,
        paddingHorizontal: 16,
        paddingBottom: 4,
        borderWidth: 1,
        borderColor: '#e6e9ef',
        borderRadius: 18,
        backgroundColor: '#ffffff',
    },

    segment: {
        flexDirection: 'row',
    },

    gutter: {
        width: 32,
    },

    ring: {
        width: 16,
        height: 16,
        marginTop: 2,
        borderWidth: 3,
        borderRadius: 8,
        backgroundColor: '#ffffff',
    },

    rail: {
        flex: 1,
        width: 4,
        marginLeft: 6,
        borderRadius: 2,
    },

    endDot: {
        width: 17,
        height: 17,
        marginTop: 1,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },

    endInner: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: '#ffffff',
    },

    body: {
        flex: 1,
        paddingBottom: 14,
    },

    tag: {
        marginRight: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },

    tagText: {
        fontSize: 11,
        fontWeight: '800',
    },

    stationName: {
        flexShrink: 1,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    meta: {
        marginTop: 6,
        gap: 6,
    },

    metaText: {
        flexShrink: 1,
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
    },

    toggle: {
        marginTop: 8,
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 9,
        backgroundColor: BACKGROUND,
    },

    toggleText: {
        color: '#4b5468',
        fontSize: 12.5,
        fontWeight: '700',
    },

    stopRow: {
        height: 28,
        flexDirection: 'row',
        alignItems: 'center',
    },

    stopDot: {
        position: 'absolute',
        left: -29,
        width: 11,
        height: 11,
        borderWidth: 2,
        borderRadius: 6,
        backgroundColor: '#ffffff',
    },

    stopName: {
        flex: 1,
        color: '#4b5468',
        fontSize: 13.5,
        fontWeight: '600',
    },

    stopLevel: {
        width: 8,
        height: 8,
        marginRight: 5,
        borderRadius: 4,
    },

    stopLevelText: {
        minWidth: 44,
        fontSize: 12,
        fontWeight: '700',
    },

    signButton: {
        height: 38,
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 1.5,
        borderColor: NAVY,
        borderRadius: 11,
        backgroundColor: '#ffffff',
    },

    signText: {
        color: NAVY,
        fontSize: 13.5,
        fontWeight: '800',
    },

    arrivalText: {
        marginTop: 6,
        color: MINT_DEEP,
        fontSize: 13,
        fontWeight: '700',
    },

    walkRow: {
        paddingLeft: 32,
        paddingBottom: 14,
    },

    walkRail: {
        position: 'absolute',
        left: 7,
        top: -14,
        bottom: 0,
        borderLeftWidth: 2.5,
        borderStyle: 'dashed',
        borderColor: WALK_LINE,
    },

    walkBox: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 12,
        backgroundColor: '#effaf5',
    },

    walkText: {
        flex: 1,
        color: MINT_DEEP,
        fontSize: 13.5,
        fontWeight: '700',
    },

    pressed: {
        opacity: 0.72,
    },
});
