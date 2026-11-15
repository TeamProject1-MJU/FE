import RouteNotices from '@/components/route/RouteNotices';
import { formatArrivalSlack, formatRouteDateTime } from '@/utils/route-time';
import { formatClock, formatDirection, formatTotalTime, formatWait, formatWalkBeforeRide, stepMinutes } from '@/components/route/format';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import CongestionBlocks from '@/components/congestion-blocks';
import Passenger from '@/components/passenger';
import type { CongestionSlot } from '@/types/congestion';
import type { Congestion as CongestionData, Route, RouteLine, RouteStep, RouteSummary } from '@/types/route';

// 라벤더 시안(#184) "03 경로 결과"
const LV_TEXT = '#25212D';
const LV_SUB = '#4A4553';
const LV_SECONDARY = '#83808B';
const LV_MAIN = '#5C3F78';
const LV_SOFT = '#EDE8F3';
const LV_CARD_BORDER = '#EEEAF2';
const LV_WALK_BAR = '#DCD7E3';
const LINE_FALLBACK = '#a1a8b8';

/** 정차역별 혼잡도 막대의 시안 톤 색 (3D 혼잡도 블록과 같은 계열). 0 은 데이터 없음 */
const LV_LEVEL_COLORS = ['#E3E0E7', '#A3D8C2', '#BCD88E', '#EBCF7E', '#EFB07A', '#E68D95'];

const LEVEL_ORDER = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'] as const;
const toMinutes = (sec: number) => Math.round(sec / 60);

export function formatFare(route: Route) {
    return `${route.summary.fare.toLocaleString('ko-KR')}원`;
}

/**
 * formatTotalTime 이 만든 문구를 시안 모양(작은 앞말 + 큰 숫자)으로 나눠요. 숫자·조건은 formatTotalTime 그대로예요.
 * "대기 포함 약 23분" → ["대기 포함 약 ", "23분"], "15분" → ["", "15분"]
 */
export function splitTotalTime(summary: RouteSummary): [string, string] {
    const text = formatTotalTime(summary);
    const match = /^(.*?)(\d+분)$/.exec(text);
    return match ? [match[1], match[2]] : ['', text];
}

/** 카드·결과 요약의 출발·도착 시각 표기 (기존 카드와 같은 규칙) */
export function formatRouteTime(iso: string | null | undefined, showDates: boolean) {
    if (!iso) return '';
    return showDates ? formatRouteDateTime(iso) : formatClock(iso);
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

/** 3D 혼잡도 블록 단계: 쾌적 1 ~ 매우 혼잡 5, 데이터 없음 0 */
function blockLevel(congestion: CongestionData | null | undefined) {
    const level = congestion?.supported ? congestion.level : null;
    return level ? LEVEL_ORDER.indexOf(level) + 1 : 0;
}

/** "11/08 06:00" (기존 Congestion 컴포넌트의 첫차 기준 표기와 같아요) */
function formatSlot(slot: CongestionSlot) {
    const [, month, day] = (slot.slotDate ?? '').split('-');
    const date = month && day ? `${Number(month)}/${Number(day)} ` : '';
    return `${date}${slot.slotStart}`;
}

/**
 * 혼잡도 라벨 + 3D 블록. 라벨은 서버 levelLabel 그대로예요.
 * 기존 Congestion 컴포넌트와 같은 규칙: 데이터 없음은 '혼잡도 데이터 미제공'(compact 는 '미제공'),
 * 추정(ESTIMATED)은 항상 '추정' 태그, 임시(MOCK)는 compact 가 아닐 때만 '임시' 태그예요.
 */
function CongestionMark({ congestion, compact = false }: { congestion: CongestionData | null | undefined; compact?: boolean }) {
    const level = blockLevel(congestion);
    const kind = level ? congestion?.kind : null;
    const showKind = kind === 'ESTIMATED' || (!compact && kind === 'MOCK');
    return (
        <View style={styles.congestion}>
            <Text style={styles.congestionLabel}>{level ? congestion?.levelLabel ?? '' : compact ? '미제공' : '혼잡도 데이터 미제공'}</Text>
            {showKind && (
                <View style={styles.kindTag}>
                    <Text style={styles.kindText}>{kind === 'ESTIMATED' ? '추정' : '임시'}</Text>
                </View>
            )}
            <CongestionBlocks level={level} size={11} />
        </View>
    );
}

/** 노선 원 + 이름 (예: ⑦ 7호선) */
function lineMark(line: RouteLine | null) {
    return (
        <View style={styles.lineMark}>
            <View style={[styles.lineCircle, { backgroundColor: line?.color ?? LINE_FALLBACK }]}>
                <Text style={styles.lineNumber}>{line?.id != null ? String(line.id) : '?'}</Text>
            </View>
            <Text style={styles.lineName}>{line?.name ?? '노선 정보 없음'}</Text>
        </View>
    );
}

/**
 * 정차역별 혼잡도 막대 (기존 CongestionBar 와 같은 나눔 규칙, 색만 시안 톤)
 * 역과 역 사이는 출발 쪽 역 단계 색, 데이터 없는 역은 회보라, 도보는 연한 보라. 길이는 소요 시간 비율이에요.
 */
function congestionStrip(route: Route) {
    return (
        <View style={styles.strip}>
            {route.steps.flatMap((step, stepIndex) => {
                const weight = Math.max(step.durationSec, 60);
                const stations = step.stations ?? [];
                if (step.type === 'WALKING' || stations.length < 2) {
                    return [
                        <View
                            key={`${stepIndex}`}
                            style={{ flex: weight, backgroundColor: step.type === 'WALKING' ? LV_WALK_BAR : LV_LEVEL_COLORS[blockLevel(stations[0]?.congestion)] }}
                        />,
                    ];
                }
                return stations.slice(0, -1).map((station, index) => (
                    <View
                        key={`${stepIndex}-${index}`}
                        style={{ flex: weight / (stations.length - 1), backgroundColor: LV_LEVEL_COLORS[blockLevel(station.congestion)] }}
                    />
                ));
            })}
        </View>
    );
}

/** "대기 포함 약" + 큰 시간. 하나의 글자 줄이라 formatTotalTime 문구가 그대로 읽혀요(함수로 그려 검사에서도 바로 보여요). */
function totalTime(summary: RouteSummary, large = false) {
    const [prefix, minutes] = splitTotalTime(summary);
    return (
        <Text style={[styles.timePrefix, large && styles.timePrefixLarge]}>
            {prefix}
            <Text style={large ? styles.timeLarge : styles.time}>{minutes}</Text>
        </Text>
    );
}

/** 결과 요약(맨 위 경로). 시안의 큰 시간 + 예상 요금, 환승, 도보 줄이에요. */
export function RouteResultSummary({ topRoute: route, showDates = false }: { topRoute: Route; showDates?: boolean }) {
    const { summary } = route;
    const estimated = summary.fareSource === 'ESTIMATED';
    const arrival = formatRouteTime(summary.arrivalAt, showDates);
    return (
        <View style={styles.summary}>
            <View style={styles.headline}>
                {totalTime(summary, true)}
                {!!arrival && <Text style={styles.summaryArrival}>{arrival} 도착</Text>}
            </View>
            <Text style={styles.summaryMeta}>
                {estimated ? '예상 ' : ''}
                {formatFare(route)}, 환승 {summary.transferCount}회
                {summary.walkingMinutes > 0 ? `, 도보 ${summary.walkingMinutes}분` : ''}
            </Text>
        </View>
    );
}

type Props = {
    route: Route;
    expanded: boolean;
    showDates?: boolean;
    /** 카드 왼쪽 위 태그 (현재 탭 이름). 탭 기준 1등 경로에만 넘깁니다. */
    badgeLabel?: string;
    onPress: () => void;
    onStart: () => void;
};

export default function RouteCard({ route, expanded, badgeLabel, onPress, onStart, showDates = false }: Props) {
    const { summary } = route;
    const estimated = summary.fareSource === 'ESTIMATED';
    const subwaySteps = route.steps.filter(step => step.type === 'SUBWAY');
    const firstSlot = subwaySteps[0]?.stations?.[0];
    const arrival = formatRouteTime(summary.arrivalAt, showDates);
    const departure = formatRouteTime(summary.departureAt, showDates);
    const tag = route.routeType !== null && !!badgeLabel;

    const tags = (tag || !!firstSlot?.firstTrain) && (
        <View style={styles.tags}>
            {tag && (
                <View style={[styles.tag, styles.tagMain]}>
                    <Text style={[styles.tagText, styles.tagMainText]}>{badgeLabel}</Text>
                </View>
            )}
            {!!firstSlot?.firstTrain && (
                <View style={styles.tag}>
                    <Text style={styles.tagText}>첫차 {formatSlot(firstSlot)} 기준</Text>
                </View>
            )}
        </View>
    );

    if (!expanded) {
        return (
            <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={`${formatTotalTime(summary)} 경로 펼치기`}
            >
                {tags}
                <View style={[styles.headline, !!tags && styles.headlineGap]}>
                    {totalTime(summary)}
                    {!!arrival && <Text style={styles.arrival}>{arrival} 도착</Text>}
                    <View style={styles.flex} />
                    <Ionicons name="chevron-down" size={17} color={LV_SECONDARY} />
                </View>
                <View style={styles.metaRow}>
                    <Text style={styles.meta} numberOfLines={1}>
                        {estimated ? '예상 ' : ''}
                        {formatFare(route)}, 환승 {summary.transferCount}회
                    </Text>
                    <CongestionMark congestion={summary.congestion} compact />
                </View>
                <RouteNotices summary={summary} />
            </Pressable>
        );
    }

    const totalSec = route.steps.reduce((sum, step) => sum + Math.max(step.durationSec, 0), 0);
    const firstLine = subwaySteps[0]?.line ?? null;
    const lastLine = subwaySteps.length > 1 ? subwaySteps[subwaySteps.length - 1].line : null;
    const lastStop = subwaySteps[subwaySteps.length - 1]?.stops.at(-1)?.name ?? '';

    return (
        <View style={styles.card}>
            {/* 태그 + 경로 전체 혼잡도 */}
            <View style={styles.topRow}>
                <View style={styles.flex}>{tags}</View>
                <CongestionMark congestion={summary.congestion} />
            </View>

            {/* 소요 시간 + 출발·도착 */}
            <View style={[styles.headline, styles.headlineGap]}>
                {totalTime(summary)}
                {!!departure && <Text style={styles.arrival}>{departure} 출발</Text>}
                {!!arrival && <Text style={styles.arrival}>{arrival} 도착</Text>}
            </View>

            {/* 예상 요금, 환승, 도보 */}
            <Text style={styles.meta}>
                {estimated && <Text>예상</Text>}
                {estimated ? ' ' : ''}
                {formatFare(route)}, 환승 {summary.transferCount}회
                {summary.walkingMinutes > 0 ? `, 도보 ${summary.walkingMinutes}분` : ''}
            </Text>
            {showDates && summary.slackSeconds != null && <Text style={styles.slack}>{formatArrivalSlack(summary.slackSeconds)}</Text>}

            <RouteNotices summary={summary} />

            {/* 구간 막대: 노선색(도보는 연한 보라) 칸에 분 */}
            <View style={styles.segments}>
                {route.steps.map((step, index) => (
                    <View
                        key={`${route.routeId}-bar-${index}`}
                        style={[
                            styles.segment,
                            {
                                flex: Math.max(step.durationSec, totalSec * 0.08, 1),
                                backgroundColor: step.type === 'WALKING' ? LV_WALK_BAR : step.line?.color ?? LINE_FALLBACK,
                            },
                        ]}
                    >
                        <Text style={styles.segmentText} numberOfLines={1}>
                            {step.type === 'WALKING' ? stepMinutes(step.durationSec) : toMinutes(step.durationSec)}분
                        </Text>
                    </View>
                ))}
            </View>

            {/* 노선 흐름 + 정차역별 혼잡도 막대 (명세 6.2) */}
            <View style={styles.lineFlow}>
                {lineMark(firstLine)}
                {lastLine && (
                    <>
                        <Ionicons name="arrow-forward" size={14} color={LV_SECONDARY} />
                        {lineMark(lastLine)}
                    </>
                )}
            </View>
            {congestionStrip(route)}

            {/* 단계 목록 */}
            <View style={styles.steps}>
                {route.steps.map((step, index) => {
                    if (step.type !== 'SUBWAY') return null;
                    const previous = route.steps[index - 1];
                    // 바로 앞 WALKING: 환승 도보 / 환승 소요 / 도보 (#146, format.ts formatWalkBeforeRide)
                    const walkLabel = index > 0 && previous?.type === 'WALKING' ? formatWalkBeforeRide(route.steps, index - 1) : null;
                    const wait = formatWait(step, subwaySteps.indexOf(step) > 0);
                    const direction = formatDirection(step);
                    const stopCount = Math.max(step.stops.length - 1, 0);

                    return (
                        <View key={`${route.routeId}-step-${index}`} style={styles.stepGroup}>
                            {walkLabel != null && (
                                <View style={styles.walkRow}>
                                    <Passenger tone="me" size={18} shadow={false} />
                                    <Text style={styles.walkText}>{walkLabel}</Text>
                                </View>
                            )}
                            {!!wait && <Text style={styles.waitText}>{wait}</Text>}

                            <View style={styles.rideRow}>
                                <View style={[styles.lineCircle, { backgroundColor: step.line?.color ?? LINE_FALLBACK }]}>
                                    <Text style={styles.lineNumber}>{step.line?.id != null ? String(step.line.id) : '?'}</Text>
                                </View>
                                <Text style={styles.rideText}>
                                    {step.stops[0]?.name} 승차{' '}
                                    <Text style={styles.rideSub}>
                                        {stopCount}개역 {toMinutes(step.durationSec)}분{direction ? `, ${direction}` : ''}
                                    </Text>
                                </Text>
                                <CongestionMark congestion={stepCongestion(step)} compact />
                            </View>
                        </View>
                    );
                })}

                {/* 마지막 도착 */}
                <View style={styles.rideRow}>
                    <View style={[styles.endDot, { borderColor: subwaySteps.at(-1)?.line?.color ?? LV_MAIN }]} />
                    <Text style={styles.rideText}>
                        {lastStop} 도착
                        {!!arrival && <Text style={styles.rideSub}> {arrival} 도착 예정</Text>}
                    </Text>
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

    // 결과 요약
    summary: {
        paddingTop: 4,
        paddingHorizontal: 4,
        paddingBottom: 16,
    },

    summaryArrival: {
        color: LV_SUB,
        fontSize: 14,
    },

    summaryMeta: {
        marginTop: 4,
        color: LV_SECONDARY,
        fontSize: 13.5,
    },

    // 카드
    card: {
        marginBottom: 10,
        padding: 16,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        borderRadius: 18,
        backgroundColor: '#FFFFFF',
    },

    tags: {
        minHeight: 20,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },

    tag: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: LV_SOFT,
    },

    tagMain: {
        backgroundColor: LV_MAIN,
    },

    tagText: {
        color: LV_MAIN,
        fontSize: 11.5,
        fontWeight: '700',
    },

    tagMainText: {
        color: '#FFFFFF',
    },

    headline: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: 8,
    },

    headlineGap: {
        marginTop: 10,
    },

    timePrefix: {
        color: LV_SUB,
        fontSize: 12.5,
    },

    timePrefixLarge: {
        fontSize: 13,
    },

    time: {
        color: LV_TEXT,
        fontSize: 22,
        fontWeight: '800',
    },

    timeLarge: {
        color: LV_TEXT,
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -1,
    },

    arrival: {
        color: LV_SUB,
        fontSize: 13,
    },

    metaRow: {
        marginTop: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    meta: {
        flexShrink: 1,
        marginTop: 4,
        color: LV_SECONDARY,
        fontSize: 13,
    },

    slack: {
        marginTop: 4,
        color: LV_SUB,
        fontSize: 12.5,
    },

    segments: {
        height: 22,
        marginTop: 12,
        flexDirection: 'row',
        gap: 2,
        borderRadius: 11,
        overflow: 'hidden',
    },

    segment: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    segmentText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '700',
    },

    steps: {
        marginTop: 12,
        gap: 8,
    },

    stepGroup: {
        gap: 8,
    },

    walkRow: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        backgroundColor: LV_SOFT,
    },

    walkText: {
        flex: 1,
        minWidth: 0,
        color: LV_MAIN,
        fontSize: 12.5,
        fontWeight: '600',
        lineHeight: 17.5,
    },

    waitText: {
        paddingLeft: 26,
        color: LV_SECONDARY,
        fontSize: 12.5,
    },

    rideRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    lineCircle: {
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },

    lineNumber: {
        color: '#FFFFFF',
        fontSize: 10.5,
        fontWeight: '700',
    },

    rideText: {
        flex: 1,
        minWidth: 0,
        color: LV_TEXT,
        fontSize: 14,
    },

    rideSub: {
        color: LV_SECONDARY,
    },

    congestion: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    congestionLabel: {
        color: LV_SECONDARY,
        fontSize: 11.5,
    },

    kindTag: {
        marginLeft: -4,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 5,
        backgroundColor: LV_SOFT,
    },

    kindText: {
        color: LV_MAIN,
        fontSize: 10.5,
        fontWeight: '700',
    },

    topRow: {
        minHeight: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    lineFlow: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },

    lineMark: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },

    lineName: {
        color: LV_TEXT,
        fontSize: 13,
        fontWeight: '600',
    },

    strip: {
        height: 6,
        marginTop: 8,
        flexDirection: 'row',
        gap: 1,
        borderRadius: 3,
        overflow: 'hidden',
    },

    endDot: {
        width: 18,
        height: 18,
        borderWidth: 4,
        borderRadius: 9,
        backgroundColor: '#FFFFFF',
    },

    startButton: {
        height: 46,
        marginTop: 14,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LV_MAIN,
    },

    startText: {
        color: '#FFFFFF',
        fontSize: 14.5,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
    },
});
