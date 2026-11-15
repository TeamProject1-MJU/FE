import ArrivalFlag from '@/components/arrival-flag';
import TrainBlock from '@/components/train-block';
import { formatRouteDateTime } from '@/utils/route-time';
import { formatClock, formatDirection, formatWait, formatWalkBeforeRide, formatWalkingStep, isTransferStep } from '@/components/route/format';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import Ionicons from '@expo/vector-icons/Ionicons';

import CongestionBlocks from '@/components/congestion-blocks';
import Passenger from '@/components/passenger';
import type { CongestionSlot } from '@/types/congestion';
import type { Congestion as CongestionData, Route, RouteLine, RouteStep } from '@/types/route';

// 라벤더 시안(#196) "경로 안내" 타임라인
const LV_TEXT = '#25212D';
const LV_SUB = '#4A4553';
const LV_SECONDARY = '#83808B';
const LV_MAIN = '#5C3F78';
const LV_RIDE_BG = '#EDE8F3';
const LV_BOX_BG = '#F4F1F7';
const LV_CARD_BORDER = '#EEEAF2';
const LV_SIGN_BORDER = '#D9CCE4';
const LV_KIND_BORDER = '#DCD7E3';
const UNSUPPORTED = '#a1a8b8';
const WALK_LINE = '#DCD7E3';

const LEVEL_ORDER = ['COMFORTABLE', 'RELAXED', 'NORMAL', 'CROWDED', 'VERY_CROWDED'] as const;

const toMinutes = (sec: number) => Math.max(1, Math.round(sec / 60));

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

/** 정차역 하나의 혼잡도 라벨 (색만으로 구분하지 않도록 글자도 함께, 명세 6.2) */
function stopLabel(step: RouteStep, stopIndex: number) {
    const congestion = step.stations?.[stopIndex]?.congestion;
    return congestion?.supported && congestion.level ? congestion.levelLabel ?? '' : '미제공';
}

/** 3D 혼잡도 블록 단계: 쾌적 1 ~ 매우 혼잡 5, 데이터 없음 0 (기존 단계 값을 그대로 옮겨요) */
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
 * 혼잡도 라벨 + 3D 블록 (경로 안내 화면용). 표시 규칙은 기존 Congestion 컴포넌트와 같아요.
 * - 라벨은 서버 levelLabel 그대로, 데이터 없음은 '혼잡도 데이터 미제공'(compact 는 '미제공')
 * - firstTrain 이면 '첫차' 표시(compact 가 아니면 조회 날짜·시각도), 추정(ESTIMATED)은 항상 '추정', 임시(MOCK)는 compact 가 아닐 때만 '임시'
 * 함수로 그려서(컴포넌트가 아니라) 화면 검사에서도 글자가 바로 보여요.
 */
export function congestionMark(congestion: CongestionData | null | undefined, { compact = false, slot, size = 12 }: { compact?: boolean; slot?: CongestionSlot | null; size?: number } = {}) {
    const level = blockLevel(congestion);
    const label = level ? congestion?.levelLabel ?? '' : compact ? '미제공' : '혼잡도 데이터 미제공';
    const firstTrain = !!slot?.firstTrain;
    const isMock = !!level && congestion?.kind === 'MOCK';
    const isEstimated = !!level && congestion?.kind === 'ESTIMATED';
    const spoken = [
        `혼잡도 ${level ? label : '혼잡도 데이터 미제공'}`,
        firstTrain && slot ? `첫차 ${formatSlot(slot)} 기준` : '',
        isMock ? '임시 데이터' : isEstimated ? '추정 데이터' : '',
    ].filter(Boolean).join(', ');

    return (
        <View style={styles.congestion} accessible accessibilityLabel={spoken}>
            {firstTrain && (
                <View style={styles.firstTrainTag}>
                    <Text style={styles.firstTrainText}>첫차</Text>
                </View>
            )}
            <Text style={styles.congestionLabel}>{label}</Text>
            {!compact && firstTrain && slot && <Text style={styles.slotText}>{formatSlot(slot)} 기준</Text>}
            {(isEstimated || (!compact && isMock)) && (
                <View style={styles.kindTag}>
                    <Text style={styles.kindText}>{isEstimated ? '추정' : '임시'}</Text>
                </View>
            )}
            <CongestionBlocks level={level} size={size} />
        </View>
    );
}

/** 노선 원 (시안: 노선색 원 + 노선 번호) */
function lineCircle(line: RouteLine | null) {
    return (
        <View style={[styles.lineCircle, { backgroundColor: line?.color ?? UNSUPPORTED }]}>
            <Text style={styles.lineNumber}>{line?.id != null ? String(line.id) : '?'}</Text>
        </View>
    );
}

/** 역 점의 세로선 칸. top·bottom 은 위아래 선 색(null 이면 선 없음), filled 면 속이 찬 도착 점이에요. */
function nodeGutter(dot: string, top: string | null, bottom: string | null, filled = false) {
    return (
        <View style={styles.gutter}>
            <View style={[styles.nodeTop, { backgroundColor: top ?? 'transparent' }]} />
            <View style={[styles.dot, filled ? { backgroundColor: dot, borderWidth: 0 } : { borderColor: dot }]} />
            {bottom ? <View style={[styles.nodeBottom, { backgroundColor: bottom }]} /> : null}
        </View>
    );
}

/**
 * formatWalkingStep 문구 끝의 구분 기호(" · 도보 N분" / " · 환승 소요 N분")만 쉼표로 바꿔요.
 * 문구·숫자는 formatWalkingStep(#146) 그대로이고, 서버 안내(guidance) 안의 글자는 건드리지 않아요.
 */
function walkingText(steps: readonly RouteStep[], index: number) {
    const step = steps[index];
    const text = formatWalkingStep(steps, index).replace(/ · (?=(?:도보|환승 소요) \d+분$)/, ', ');
    return `${text}${step.distanceM > 0 ? `, ${step.distanceM}m` : ''}`;
}

type Props = {
    route: Route;
    nextTrains?: ReactNode;
    showDates?: boolean;
    /** 승차 구간의 '표지판으로 방향 확인' 버튼 */
    onSignCheck: (step: RouteStep) => void;
    getSignCheckIssue?: (step: RouteStep) => string | null;
};

/**
 * 경로 구간 목록 (#35, 라벤더 시안 #196)
 * 명세 6.1 route.steps 를 순서대로 그립니다: 승차역 → 노선 구간(중간역) → 환승역 → … → 도착
 * WALKING 은 "도보 N분"이고, 다음 열차 대기가 따로 표시되지 않는 환승 단계만 "환승 소요 N분"이에요(#146, format.ts formatWalkingStep).
 * 환승역 이름 옆 문구는 경로 카드와 같은 formatWalkBeforeRide("환승 도보 N분" / "환승 소요 N분")예요.
 */
export default function RouteTimeline({ route, onSignCheck, nextTrains, showDates = false, getSignCheckIssue }: Props) {
    const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});

    const steps = route.steps;
    const lastSubwayIndex = steps.reduce((last, step, index) => (step.type === 'SUBWAY' ? index : last), -1);
    const firstSubwayIndex = steps.findIndex(item => item.type === 'SUBWAY');
    const arrival = showDates ? formatRouteDateTime(route.summary.arrivalAt) : formatClock(route.summary.arrivalAt);
    const previousSubway = (index: number) => steps.slice(0, index).reverse().find(step => step.type === 'SUBWAY');
    const nextSubway = (index: number) => steps.slice(index + 1).find(step => step.type === 'SUBWAY');
    /** 환승 단계에서 내린 역과 다음 열차 승차역이 같으면 한 줄(환승역)로 합쳐요. */
    const mergedTransfer = (index: number) =>
        isTransferStep(steps, index) && previousSubway(index)?.stops.at(-1)?.name === nextSubway(index)?.stops[0]?.name;

    const toggle = (index: number) => {
        setOpenSteps(prev => ({ ...prev, [index]: !prev[index] }));
    };

    return (
        <View style={styles.card}>
            <View style={styles.hereRow}>
                <Passenger tone="me" size={26} />
                <View style={styles.headingBody}>
                    <Text style={styles.hereLabel}>지금 여기</Text>
                    <Text style={styles.hereTitle}>{steps[firstSubwayIndex]?.stops[0]?.name} {showDates ? formatRouteDateTime(route.summary.departureAt ?? '') : formatClock(route.summary.departureAt ?? '')} 출발</Text>
                </View>
            </View>
            {steps.map((step, index) => {
                if (step.type === 'WALKING') {
                    if (isTransferStep(steps, index)) {
                        const from = previousSubway(index);
                        const to = nextSubway(index);
                        const merged = mergedTransfer(index);
                        const wait = merged && to ? formatWait(to, true) : '';
                        const fromColor = from?.line?.color ?? UNSUPPORTED;
                        const toColor = to?.line?.color ?? UNSUPPORTED;
                        return (
                            <View key={`walk-${index}`} style={styles.rowWrap}>
                                {nodeGutter(merged ? toColor : fromColor, fromColor, merged ? toColor : WALK_LINE)}
                                <View style={styles.nodeBody}>
                                    <View style={styles.nameRow}>
                                        <Text style={styles.stationName}>{from?.stops.at(-1)?.name}</Text>
                                        <Text style={styles.chip}>환승</Text>
                                        <Text style={styles.subMain}>
                                            {formatWalkBeforeRide(steps, index)}
                                            {step.distanceM > 0 ? ` 약 ${step.distanceM}m` : ''}
                                        </Text>
                                    </View>
                                    {!!wait && <Text style={styles.note}>{wait}</Text>}
                                    <View style={styles.guideBox}>
                                        <Text style={styles.guideText}>{from?.stops.at(-1)?.name}에서 {to?.line?.name}으로 갈아타요 · 걸어서 {toMinutes(step.durationSec)}분{step.distanceM > 0 ? ` · ${step.distanceM}m` : ''}</Text>
                                    </View>
                                </View>
                            </View>
                        );
                    }
                    return (
                        <View key={`walk-${index}`} style={styles.rowWrap}>
                            <View style={styles.gutter}>
                                <View style={styles.walkRail} />
                            </View>
                            <View style={[styles.nodeBody, styles.walkBody]}>
                                <View style={styles.walkBox}>
                                    <Ionicons name="walk-outline" size={17} color={LV_MAIN} />
                                    <Text style={styles.walkText}>{walkingText(steps, index)}</Text>
                                </View>
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
                const signCheckIssue = getSignCheckIssue?.(step);
                const transfer = steps.slice(0, index).some(previous => previous.type === 'SUBWAY');
                const wait = formatWait(step, transfer);
                // 바로 앞이 합쳐진 환승역이면 승차역 줄은 그 환승역 줄이 대신해요(대기도 거기서 보여요).
                const showBoard = !(index > 0 && mergedTransfer(index - 1));
                const nextIsTransfer = isTransferStep(steps, index + 1);

                return (
                    <View key={`ride-${index}`}>
                        {/* 승차역 */}
                        {showBoard && (
                            <View style={styles.rowWrap}>
                                {nodeGutter(color, null, color)}
                                <View style={styles.nodeBody}>
                                    <View style={styles.nameRow}>
                                        <Text style={styles.stationName} numberOfLines={1}>{first?.name}</Text>
                                        <Text style={styles.subMuted}>승차</Text>
                                    </View>
                                    {!!wait && <Text style={styles.note}>{wait}</Text>}
                                    {index === firstSubwayIndex && nextTrains}
                                </View>
                            </View>
                        )}

                        {/* 노선 구간 */}
                        <View style={[styles.rowWrap, styles.rideBox]}>
                            <View style={styles.gutter}>
                                <View style={[styles.rideRail, { backgroundColor: color }]} />
                            </View>
                            <View style={styles.rideBody}>
                                <View style={styles.rideHead}>
                                    <TrainBlock line={step.line?.id ?? undefined} size={34} />
                                    <View style={styles.headingBody}>
                                        <View style={styles.titleRow}>
                                            {lineCircle(step.line)}
                                            <Text style={styles.rideText}>{first?.name}에서 {step.line?.name ?? ''}</Text>
                                        </View>
                                        <Text style={styles.rideSubtitle}>{Math.max(step.stops.length - 1, 0)}정거장 · {toMinutes(step.durationSec)}분 · {formatDirection(step)}</Text>
                                    </View>
                                </View>

                                {congestionMark(stepCongestion(step), { compact: true, slot: step.stations?.[0], size: 13 })}

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
                                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={13} color={LV_SUB} />
                                    </Pressable>
                                )}

                                {open &&
                                    middle.map((stop, stopIndex) => (
                                        <View key={`${index}-${stop.id}-${stop.order}`} style={styles.stopRow}>
                                            <Text style={styles.stopName} numberOfLines={1}>
                                                {stop.name}
                                            </Text>
                                            <Text style={styles.stopLevelText}>{stopLabel(step, stopIndex + 1)}</Text>
                                            <CongestionBlocks level={blockLevel(step.stations?.[stopIndex + 1]?.congestion)} size={13} />
                                        </View>
                                    ))}

                                {signCheckIssue ? <Text style={styles.issueText}>{signCheckIssue}</Text> : <Pressable
                                    style={({ pressed }) => [styles.signButton, pressed && styles.pressed]}
                                    onPress={() => onSignCheck(step)}
                                    accessibilityRole="button"
                                >
                                    <Ionicons name="camera-outline" size={14} color={LV_MAIN} />
                                    <Text style={styles.signText}>표지판으로 방향 확인</Text>
                                </Pressable>}
                            </View>
                        </View>

                        {/* 도착 또는 하차 (환승 단계가 이어지면 환승역 줄이 하차역을 함께 보여줘요) */}
                        {isLastSubway ? (
                            <View style={styles.rowWrap}>
                                {nodeGutter(color, color, null, true)}
                                <View style={[styles.nodeBody, styles.arrivalBody]}>
                                    <View style={styles.nameRow}>
                                        <Text style={styles.arrivalName} numberOfLines={1}>{last?.name} 도착</Text>
                                        {!!arrival && <Text style={styles.subMain}>{arrival} 도착 예정</Text>}
                                        <View style={{ flex: 1 }} />
                                        <ArrivalFlag />
                                    </View>
                                </View>
                            </View>
                        ) : nextIsTransfer ? null : (
                            <View style={styles.rowWrap}>
                                {nodeGutter(color, color, null)}
                                <View style={styles.nodeBody}>
                                    <View style={styles.nameRow}>
                                        <Text style={styles.stationName} numberOfLines={1}>{last?.name}</Text>
                                        <Text style={styles.chip}>하차</Text>
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

const styles = StyleSheet.create({
    hereRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
    headingBody: { flex: 1, minWidth: 0, gap: 4 },
    hereLabel: { fontSize: 11.5, color: LV_MAIN, fontWeight: '600' },
    hereTitle: { fontSize: 15, color: LV_TEXT, fontWeight: '700' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    rideSubtitle: { fontSize: 12.5, color: LV_SECONDARY },
    arrivalName: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: LV_TEXT },
    chip: { fontSize: 11, fontWeight: '700', color: LV_MAIN, backgroundColor: LV_RIDE_BG, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 6 },
    card: {
        paddingTop: 8,
        paddingHorizontal: 8,
        paddingBottom: 14,
        borderWidth: 1,
        borderColor: LV_CARD_BORDER,
        borderRadius: 22,
        backgroundColor: '#FFFFFF',
    },

    rowWrap: {
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 12,
        paddingHorizontal: 10,
        borderRadius: 14,
    },

    gutter: {
        width: 20,
        alignItems: 'center',
    },

    nodeTop: {
        width: 3,
        height: 13,
    },

    dot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 3,
        backgroundColor: '#FFFFFF',
    },

    nodeBottom: {
        flex: 1,
        width: 3,
    },

    nodeBody: {
        flex: 1,
        minWidth: 0,
        paddingTop: 9,
        paddingBottom: 8,
    },

    arrivalBody: {
        minHeight: 40,
    },

    nameRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 8,
    },

    stationName: {
        flexShrink: 1,
        color: LV_TEXT,
        fontSize: 14.5,
        fontWeight: '400',
        letterSpacing: -0.3,
    },

    subMuted: {
        color: LV_SECONDARY,
        fontSize: 13,
        fontWeight: '600',
    },

    subMain: {
        color: LV_MAIN,
        fontSize: 13,
        fontWeight: '600',
    },

    note: {
        marginTop: 2,
        color: LV_SECONDARY,
        fontSize: 12.5,
    },

    guideBox: {
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        backgroundColor: LV_BOX_BG,
    },

    guideText: {
        flex: 1,
        minWidth: 0,
        color: '#5F5A68',
        fontSize: 12.5,
        textAlign: 'center',
        lineHeight: 19,
    },

    rideBox: {
        backgroundColor: 'transparent',
    },

    rideRail: {
        flex: 1,
        width: 3,
    },

    rideBody: {
        flex: 1,
        minWidth: 0,
        paddingTop: 6,
        paddingBottom: 10,
    },

    rideHead: {
        minHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },

    lineCircle: {
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },

    lineNumber: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '700',
    },

    rideText: {
        flex: 1,
        minWidth: 0,
        color: LV_TEXT,
        fontSize: 15.5,
        fontWeight: '700',
    },

    congestion: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },

    congestionLabel: {
        color: LV_SUB,
        fontSize: 12,
        fontWeight: '600',
    },

    slotText: {
        color: LV_SECONDARY,
        fontSize: 11.5,
        fontWeight: '600',
    },

    firstTrainTag: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 5,
        backgroundColor: LV_RIDE_BG,
    },

    firstTrainText: {
        color: LV_MAIN,
        fontSize: 10.5,
        fontWeight: '700',
    },

    kindTag: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: LV_KIND_BORDER,
        borderRadius: 6,
    },

    kindText: {
        color: LV_SECONDARY,
        fontSize: 10.5,
        fontWeight: '600',
    },

    toggle: {
        height: 30,
        marginTop: 6,
        marginLeft: 27,
        paddingHorizontal: 10,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 9,
        backgroundColor: LV_BOX_BG,
    },

    toggleText: {
        color: LV_SUB,
        fontSize: 12,
        fontWeight: '600',
    },

    stopRow: {
        height: 38,
        paddingLeft: 27,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },

    stopName: {
        flex: 1,
        color: LV_TEXT,
        fontSize: 14.5,
    },

    stopLevelText: {
        width: 54,
        textAlign: 'right',
        color: LV_SECONDARY,
        fontSize: 11.5,
    },

    signButton: {
        height: 34,
        marginTop: 8,
        marginLeft: 27,
        paddingHorizontal: 12,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: LV_SIGN_BORDER,
        borderRadius: 10,
        backgroundColor: '#FFFFFF',
    },

    signText: {
        color: LV_MAIN,
        fontSize: 12.5,
        fontWeight: '600',
    },

    issueText: {
        marginTop: 8,
        marginLeft: 27,
        color: LV_SECONDARY,
        fontSize: 12.5,
        lineHeight: 18,
    },

    walkRail: {
        flex: 1,
        borderLeftWidth: 2.5,
        borderStyle: 'dashed',
        borderColor: WALK_LINE,
    },

    walkBody: {
        paddingTop: 4,
        paddingBottom: 6,
    },

    walkBox: {
        paddingHorizontal: 12,
        paddingVertical: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        backgroundColor: LV_BOX_BG,
    },

    walkText: {
        flex: 1,
        color: '#5F5A68',
        fontSize: 12.5,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
    },
});
