import { formatDirection } from '@/components/route/format';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import Congestion from '@/components/route/Congestion';
import CongestionBar from '@/components/route/CongestionBar';
import LineBadge from '@/components/route/LineBadge';
import type { Congestion as CongestionData, Route, RouteStep } from '@/types/route';

const NAVY = '#0f1c3f';
const MINT_DEEP = '#12a77a';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const WALK = '#c9ced8';

const LEVEL_ORDER = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'] as const;

const pad = (value: number) => String(value).padStart(2, '0');
const toMinutes = (sec: number) => Math.round(sec / 60);
const formatClock = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function formatFare(route: Route) {
    return `${route.summary.fare.toLocaleString('ko-KR')}원`;
}

/** 단계(SUBWAY) 안 정차역 혼잡도 중 가장 높은 값 */
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

type Props = {
    route: Route;
    expanded: boolean;
    /** 펼친 카드 왼쪽 위 배지 (현재 탭 이름). 탭 기준 1등 경로에만 넘깁니다. */
    badgeLabel?: string;
    onPress: () => void;
    onStart: () => void;
};

export default function RouteCard({ route, expanded, badgeLabel, onPress, onStart }: Props) {
    const { summary } = route;
    const estimated = summary.fareSource === 'ESTIMATED';

    if (!expanded) {
        return (
            <Pressable
                style={({ pressed }) => [styles.collapsed, pressed && styles.pressed]}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={`${toMinutes(summary.totalTimeSec)}분 경로 펼치기`}
            >
                <Text style={styles.collapsedMinutes}>{toMinutes(summary.totalTimeSec)}분</Text>
                <Text style={styles.collapsedMeta} numberOfLines={1}>
                    {estimated ? '예상 ' : ''}
                    {formatFare(route)} · 환승 {summary.transferCount}회
                </Text>
                <Congestion congestion={summary.congestion} compact />
                <Ionicons name="chevron-down" size={17} color={NAVY} />
            </Pressable>
        );
    }

    const subwaySteps = route.steps.filter(step => step.type === 'SUBWAY');
    const firstLine = subwaySteps[0]?.line ?? null;
    const lastLine = subwaySteps.length > 1 ? subwaySteps[subwaySteps.length - 1].line : null;
    const lastStop = subwaySteps[subwaySteps.length - 1]?.stops.at(-1)?.name ?? '';
    const arrival = formatClock(summary.arrivalAt);

    return (
        <View style={styles.card}>
            {/* 배지 + 경로 전체 혼잡도 */}
            <View style={styles.row}>
                {route.routeType !== null && !!badgeLabel && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{badgeLabel}</Text>
                    </View>
                )}
                <View style={styles.flex} />
                <Congestion congestion={summary.congestion} slot={subwaySteps[0]?.stations?.[0]} />
            </View>

            {/* 소요 시간 + 노선 막대 */}
            <View style={styles.headline}>
                <View style={styles.timeBox}>
                    <Text style={styles.minutes}>
                        {toMinutes(summary.totalTimeSec)}
                        <Text style={styles.minutesUnit}> 분</Text>
                    </Text>
                    {!!arrival && <Text style={styles.arrival}>{arrival} 도착</Text>}
                </View>

                <View style={styles.flex}>
                    {/* 정차역별 혼잡도 색 (명세 6.2) */}
                    <View style={styles.lineBar}>
                        <CongestionBar route={route} />
                    </View>

                    <View style={styles.lineLabels}>
                        <LineBadge line={firstLine} withName />
                        {lastLine && (
                            <>
                                <Ionicons name="arrow-forward" size={14} color="#8b93a5" />
                                <View style={styles.flex} />
                                <LineBadge line={lastLine} withName />
                            </>
                        )}
                    </View>
                </View>
            </View>

            <View style={styles.divider} />

            {/* 요금 · 환승 · 도보 */}
            <View style={styles.row}>
                {estimated && (
                    <View style={styles.estimateChip}>
                        <Text style={styles.estimateText}>예상</Text>
                    </View>
                )}
                <Text style={styles.metaText}>
                    {formatFare(route)} · 환승 {summary.transferCount}회
                    {summary.walkingMinutes > 0 ? ` · 도보 ${summary.walkingMinutes}분` : ''}
                </Text>
            </View>

            <View style={styles.divider} />

            {/* 단계 목록 */}
            {route.steps.map((step, index) => {
                if (step.type !== 'SUBWAY') return null;
                const previous = route.steps[index - 1];
                const transferWalk = index > 0 && previous?.type === 'WALKING' ? toMinutes(previous.durationSec) : null;
                const color = step.line?.color ?? WALK;

                return (
                    <View key={`${route.routeId}-step-${index}`} style={styles.stepRow}>
                        <View style={styles.gutter}>
                            <View style={[styles.ring, { borderColor: color }]} />
                            <View style={[styles.rail, { backgroundColor: color }]} />
                        </View>

                        <View style={styles.stepBody}>
                            <View style={styles.row}>
                                <Text style={styles.stationName}>{step.stops[0]?.name}</Text>
                                {transferWalk != null && (
                                    <Text style={styles.greenText}>  환승 도보 {transferWalk}분</Text>
                                )}
                            </View>

                            <View style={[styles.row, styles.stepMeta]}>
                                <LineBadge line={step.line} />
                                <Text style={styles.stepText} numberOfLines={1}>
                                    {formatDirection(step)} · {Math.max(step.stops.length - 1, 0)}개역 {toMinutes(step.durationSec)}분
                                </Text>
                                <View style={styles.flex} />
                                <Congestion congestion={stepCongestion(step)} slot={step.stations?.[0]} compact />
                            </View>
                        </View>
                    </View>
                );
            })}

            <View style={styles.stepRow}>
                <View style={styles.gutter}>
                    <View style={[styles.endDot, { backgroundColor: subwaySteps.at(-1)?.line?.color ?? NAVY }]} />
                </View>
                <View style={[styles.row, styles.stepBody]}>
                    <Text style={styles.stationName}>{lastStop} 도착</Text>
                    {!!arrival && <Text style={styles.greenText}>  {arrival} 도착 예정</Text>}
                </View>
            </View>

            <Pressable
                style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}
                onPress={onStart}
                accessibilityRole="button"
            >
                <Text style={styles.startText}>이 경로로 안내 시작</Text>
            </Pressable>
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
        marginTop: 12,
        padding: 16,
        borderWidth: 2,
        borderColor: NAVY,
        borderRadius: 14,
        backgroundColor: '#ffffff',
    },

    badge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 7,
        backgroundColor: NAVY,
    },

    badgeText: {
        color: '#ffffff',
        fontSize: 12.5,
        fontWeight: '700',
    },

    headline: {
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },

    timeBox: {
        width: 96,
    },

    minutes: {
        color: NAVY,
        fontSize: 35,
        fontWeight: '800',
        letterSpacing: -0.5,
    },

    minutesUnit: {
        fontSize: 13,
        fontWeight: '700',
    },

    arrival: {
        marginTop: 2,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '600',
    },

    lineBar: {
        marginTop: 12,
    },

    lineLabels: {
        marginTop: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },

    divider: {
        height: 1,
        marginVertical: 11,
        backgroundColor: BORDER,
    },

    estimateChip: {
        marginRight: 5,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 5,
        backgroundColor: '#fff3d6',
    },

    estimateText: {
        color: '#8a5a00',
        fontSize: 11,
        fontWeight: '700',
    },

    metaText: {
        color: '#4b5468',
        fontSize: 13.5,
        fontWeight: '600',
    },

    stepRow: {
        flexDirection: 'row',
    },

    gutter: {
        width: 30,
        alignItems: 'flex-start',
    },

    ring: {
        width: 14,
        height: 14,
        marginTop: 3,
        borderWidth: 2.5,
        borderRadius: 7,
        backgroundColor: '#ffffff',
    },

    rail: {
        flex: 1,
        width: 3,
        marginLeft: 5.5,
    },

    endDot: {
        width: 13,
        height: 13,
        marginTop: 3,
        marginLeft: 0.5,
        borderRadius: 7,
    },

    stepBody: {
        flex: 1,
        paddingBottom: 12,
    },

    stationName: {
        color: NAVY,
        fontSize: 16.5,
        fontWeight: '800',
    },

    greenText: {
        color: MINT_DEEP,
        fontSize: 13,
        fontWeight: '700',
    },

    stepMeta: {
        marginTop: 8,
        gap: 6,
    },

    stepText: {
        flexShrink: 1,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '500',
    },

    startButton: {
        height: 48,
        marginTop: 4,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    startText: {
        color: '#ffffff',
        fontSize: 15.5,
        fontWeight: '700',
    },

    collapsed: {
        height: 44,
        marginTop: 8,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 12,
        backgroundColor: '#ffffff',
    },

    collapsedMinutes: {
        width: 40,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    collapsedMeta: {
        flex: 1,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
    },
});