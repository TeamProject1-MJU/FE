import ArrivalFlag from '@/components/arrival-flag';
import RouteNotices from '@/components/route/RouteNotices';
import { formatArrivalSlack, formatRouteDateTime, formatRouteRelativeDateTime } from '@/utils/route-time';
import { formatClock, formatDirection, formatDurationMinutes, formatTotalTime, formatWait, formatWalkBeforeRide, routeDurationSec, shouldMergeContinuousRide, stepMinutes } from '@/components/route/format';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
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
const toMinutes = (sec: number) => Math.max(1, Math.floor(sec / 60));

export function formatFare(route: Route) {
    return `${route.summary.fare.toLocaleString('ko-KR')}원`;
}

/**
 * formatTotalTime 이 만든 문구를 시안 모양(작은 앞말 + 큰 숫자)으로 나눠요. 숫자·조건은 formatTotalTime 그대로예요.
 * "대기 포함 약 23분" → ["대기 포함 약 ", "23분"], "15분" → ["", "15분"]
 */
export function splitTotalTime(summary: RouteSummary): [string, string] {
    const text = formatTotalTime(summary);
    const match = /^(.*?)(\d+시간(?: \d+분)?|\d+분)$/.exec(text);
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
    badgeLabels?: string[];
    /** 도착 시각·약속 시각 기준 검색이면 접힌 카드에 서버 출발 시각을 굵게 보여 줘요. */
    highlightDeparture?: boolean;
    onPress: () => void;
    onStart: () => void;
};

export default function RouteCard({ route, expanded, badgeLabels = [], highlightDeparture = false, onPress, onStart, showDates = false }: Props) {
    const { summary } = route;
    const subwaySteps = route.steps.filter(step => step.type === 'SUBWAY');
    const lineSteps = route.steps.filter((step, index, steps) =>
        step.type === 'SUBWAY' && !shouldMergeContinuousRide(steps[index - 1], step));
    const firstSlot = subwaySteps[0]?.stations?.[0];
    const arrival = formatRouteRelativeDateTime(summary.arrivalAt);
    const departure = summary.departureAt ? formatRouteRelativeDateTime(summary.departureAt) : '';
    const firstTrainInfo = summary.noService && departure ? `${departure} 출발 ~`
        : firstSlot?.firstTrain ? `첫차 ${formatSlot(firstSlot)} 기준` : '';
    const showDeparture = highlightDeparture && !!departure && !summary.noService;
    const totalSec = route.steps.reduce((sum, step) => sum + Math.max(step.durationSec, 0), 0);
    const lastStop = subwaySteps.at(-1)?.stops.at(-1)?.name ?? '';

    return (
        <View style={styles.card}>
            <View style={styles.topRow}>
                <View style={[styles.tags, styles.flex]}>
                    {badgeLabels.map(label => <View key={label} style={[styles.tag, styles.tagMain]}><Text style={[styles.tagText, styles.tagMainText]}>{label}</Text></View>)}
                </View>
                <CongestionMark congestion={summary.congestion} />
            </View>
            {showDeparture && <Text style={styles.highlightDeparture}>{departure} 출발</Text>}
            <View style={[styles.headline, showDeparture ? styles.headlineGapTight : styles.headlineGap]}>
                <Text style={styles.time} accessibilityLabel={`총 소요 시간 ${formatTotalTime(summary)}`}>{formatDurationMinutes(routeDurationSec(summary) / 60)}</Text>
                {!!arrival && <Text style={styles.arrival}>{arrival} 도착</Text>}
            </View>
            {!!firstTrainInfo && <View style={styles.firstDeparture}>
                <Ionicons name="information-circle-outline" size={16} color={LV_MAIN} />
                <Text style={styles.firstDepartureText}>{firstTrainInfo}</Text>
            </View>}
            <Text style={styles.meta}>
                {summary.fareSource === 'ESTIMATED' && <Text>예상</Text>}{summary.fareSource === 'ESTIMATED' ? ' ' : ''}{formatFare(route)} · 환승 {summary.transferCount}회
                {summary.walkingMinutes > 0 ? ` · 도보 ${summary.walkingMinutes}분` : ''}
            </Text>
            {showDates && summary.slackSeconds != null && <Text style={styles.slack}>{formatArrivalSlack(summary.slackSeconds)}</Text>}
            <RouteNotices summary={summary} />
            <View style={styles.lineFlow}>
                {lineSteps.map((step, index) => <View key={index} style={styles.lineMark}>
                    {index > 0 && <Ionicons name="arrow-forward" size={14} color={LV_SECONDARY} />}
                    {lineMark(step.line)}
                </View>)}
            </View>
            <View style={styles.segments}>
                {route.steps.map((step, index) => <View key={index} style={[styles.segment, {
                    flex: Math.max(step.durationSec, totalSec * 0.08, 1),
                    backgroundColor: step.type === 'WALKING' ? LV_WALK_BAR : step.line?.color ?? LINE_FALLBACK,
                }]}>
                    <Text style={[styles.segmentText, step.type === 'WALKING' && styles.walkSegmentText]} numberOfLines={1}>{step.type === 'WALKING' ? stepMinutes(step.durationSec) : toMinutes(step.durationSec)}분</Text>
                </View>)}
            </View>
            {congestionStrip(route)}
            {expanded && <View style={styles.steps}>
                {!!departure && <Text style={[styles.arrival, styles.timelineDeparture]}>{departure} 출발</Text>}
                {route.steps.map((step, index) => {
                    if (step.type !== 'SUBWAY') return null;
                    const transfer = subwaySteps.indexOf(step) > 0;
                    const previous = route.steps[index - 1];
                    const walkLabel = index > 0 && previous?.type === 'WALKING' ? formatWalkBeforeRide(route.steps, index - 1) : null;
                    const wait = formatWait(step, transfer);
                    const direction = formatDirection(step);
                    const color = step.line?.color ?? LINE_FALLBACK;
                    return <View key={index} style={styles.timelineGroup}>
                        <View style={[styles.timelineLine, { backgroundColor: color }, step === subwaySteps.at(-1) && styles.lastTimelineLine]} />
                        <View style={[styles.timelineDot, { borderColor: color }]} />
                        <View style={styles.timelineContent}>
                            <Text style={styles.stationTitle}>{step.stops[0]?.name} {transfer ? '환승' : '승차'}</Text>
                            {walkLabel != null && <View style={styles.walkRow}><Passenger tone="me" size={18} shadow={false} /><Text style={styles.walkText}>{walkLabel}</Text></View>}
                            {!!wait && <Text style={styles.timelineHint}>{wait}</Text>}
                            <View style={styles.timelineRide}>
                                {lineMark(step.line)}
                                <Text style={styles.rideSub}>{Math.max(step.stops.length - 1, 0)}개역 · {toMinutes(step.durationSec)}분{direction ? ` · ${direction}` : ''}</Text>
                            </View>
                            <CongestionMark congestion={stepCongestion(step)} compact />
                        </View>
                    </View>;
                })}
                <View style={styles.timelineArrival}>
                    <View style={styles.arrivalFlag}><ArrivalFlag size={22} /></View>
                    <View style={styles.flex}><Text style={styles.stationTitle}>{lastStop} 도착</Text>{!!arrival && <Text style={styles.timelineHint}>{arrival} 도착 예정</Text>}</View>
                </View>
            </View>}
            <View style={styles.buttons}>
                <Pressable style={({ pressed }) => [styles.detailButton, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded }}>
                    <Text style={styles.detailText}>{expanded ? '접기' : '상세 보기'}</Text>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={LV_MAIN} />
                </Pressable>
                <Pressable style={({ pressed }) => [styles.startButton, pressed && styles.pressed]} onPress={onStart} accessibilityRole="button">
                    <Text style={styles.startText}>이 경로로 안내 시작</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    firstDeparture: { flexDirection: 'row', alignItems: 'center', gap: 5, marginVertical: 8 },
    firstDepartureText: { flexShrink: 1, color: LV_MAIN, fontSize: 13, fontWeight: '700' },
    timelineDeparture: { marginBottom: 16 },
    lastTimelineLine: { bottom: 0 },
    timelineArrival: { paddingLeft: 26, minHeight: 36, position: 'relative' },
    arrivalFlag: { position: 'absolute', left: 3, top: 2 },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 14 },
    detailButton: { flex: 1, height: 46, borderRadius: 23, backgroundColor: '#F4F1F7', flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' },
    detailText: { color: LV_MAIN, fontSize: 13, fontWeight: '700' },
    walkSegmentText: { color: LV_SECONDARY },
    timelineGroup: { paddingLeft: 26, paddingBottom: 20, position: 'relative' },
    timelineLine: { position: 'absolute', left: 7, top: 10, bottom: -10, width: 3 },
    timelineDot: { position: 'absolute', left: 2, top: 4, width: 13, height: 13, borderRadius: 7, borderWidth: 3, backgroundColor: '#FFFFFF' },
    timelineContent: { gap: 7 },
    stationTitle: { color: LV_TEXT, fontSize: 15, fontWeight: '700' },
    timelineHint: { color: LV_SECONDARY, fontSize: 12, marginTop: 2 },
    timelineRide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7 },
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
        borderRadius: 12,
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

    headlineGapTight: {
        marginTop: 2,
    },

    highlightDeparture: {
        marginTop: 10,
        color: LV_MAIN,
        fontSize: 17,
        fontWeight: '800',
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
        fontSize: 32,
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
        height: 24,
        marginTop: 10,
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
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: LV_CARD_BORDER,
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
        flex: 1.35,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LV_MAIN,
    },

    startText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
    },
});
