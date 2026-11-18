import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text } from '@/components/app-text';
import type { ParticipantTime } from '@/types/recommendation';
import { formatBoardingTrain, formatLeg, formatLegTrain, formatLegTransfer, formatSlack, formatTripLine, sourceNote } from '@/utils/recommendation-trip';
import { formatSeoulTime, formatTripTimes } from '@/utils/seoul-time';
import { formatStationName } from '@/utils/station-name';

const INK = '#25212D';
const MUTED = '#6F6B78';
const PURPLE = '#5C3F78';
const BORDER = '#E8E4ED';
const CONGESTION_COLORS: Record<string, string> = { COMFORTABLE: '#2bcf9a', RELAXED: '#8fd14f', NORMAL: '#f2b705', CROWDED: '#f28c28', VERY_CROWDED: '#e5484d' };

/** 참여자 상세는 서버의 시각표 구간과 예상 경로를 구분해서 보여줘요. */
export default function ParticipantTripDetail({ participant: p, appointmentAt, stalePlan }: {
    participant: ParticipantTime;
    appointmentAt: string | null;
    stalePlan: string | null;
}) {
    const { width, fontScale } = useWindowDimensions();
    const scale = Math.max(1, fontScale || 1);
    const stackedTimes = scale > 1.4;
    const times = formatTripTimes(p.departureAt, p.arriveAt, appointmentAt);
    const departureTime = formatSeoulTime(p.departureAt);
    const departureDate = times.departure.length > 5 ? times.departure.slice(0, -5).trim() : '';
    const slack = formatSlack(p.slackSeconds);
    const metrics: { label: string; value: string; a11y: string; color?: string; missing?: boolean }[] = [
        { label: '환승', value: `${p.transferCount}회`, a11y: `환승 ${p.transferCount}회` },
        { label: '예상 요금', value: `${p.fareWon.toLocaleString()}원`, a11y: `예상 ${p.fareWon.toLocaleString()}원` },
        { label: '거리', value: `${(p.distanceM / 1000).toFixed(1)}km`, a11y: `거리 ${(p.distanceM / 1000).toFixed(1)}km` },
        p.congestion ? { label: '혼잡도', value: p.congestion.levelLabel,
            a11y: `혼잡도 ${p.congestion.levelLabel}`, color: CONGESTION_COLORS[p.congestion.level] ?? MUTED }
            : { label: '혼잡도', value: '정보 없음', a11y: '혼잡도 정보 없음', missing: true },
    ];
    const columns = width < 360 || scale > 1.2 ? 2 : metrics.length;
    const first = p.legs[0];
    const train = p.boardingTrain;
    // 첫 구간에 이미 나온 탑승 열차는 반복하지 않아요. 일부 값이 다르거나 구간이 없으면 별도로 남겨요.
    const boardingAlreadyShown = train && first && train.stationName === first.fromStationName
        && Date.parse(train.departureAt) === Date.parse(first.boardAt) && train.lineId === first.lineId
        && train.lineName === first.lineName && train.direction === first.direction
        && train.terminal === first.terminal && train.trainCode === first.trainCode;
    const note = [departureTime ? `출발 예정 ${departureTime}${p.congestion ? ' 기준 혼잡도' : ''}` : '', sourceNote(p.source)].filter(Boolean).join(' / ');

    return (
        <View style={styles.detail} testID={`participant-trip-${p.userId}`}>
            {!!times.departure && (
                <View style={[styles.timeRow, stackedTimes && styles.timeRowStacked]} accessibilityLabel={`${formatTripLine(p, appointmentAt)}${times.arrival ? '' : ' / 도착 시각 정보 없음'}`}>
                    <View style={[styles.timeColumn, stackedTimes && styles.timeColumnStacked]}>
                        <Text style={styles.timeLabel}>{[departureDate, `${formatStationName(p.departureStation.name)} 출발`].filter(Boolean).join(' ')}</Text>
                        <Text style={styles.clock}>{departureTime}</Text>
                    </View>
                    <>
                        <Ionicons name={stackedTimes ? 'arrow-down' : 'arrow-forward'} size={20} color="#AAA4B2" style={stackedTimes ? styles.timeArrowStacked : undefined} />
                        <View style={[styles.timeColumn, stackedTimes && styles.timeColumnStacked]}>
                            <Text style={styles.timeLabel}>{times.nextDay ? '다음 날 도착' : '도착'}</Text>
                            {times.arrival ? <Text style={styles.clock}>{formatSeoulTime(p.arriveAt)}</Text> : <Text style={styles.missingValue}>정보 없음</Text>}
                        </View>
                    </>
                </View>
            )}
            {!!slack && <View style={[styles.slackChip, (p.slackSeconds ?? 0) < 0 && styles.lateChip]}>
                <Text style={[styles.slack, (p.slackSeconds ?? 0) < 0 && styles.late]}>{slack}</Text>
            </View>}
            {!!stalePlan && <Text style={styles.staleNote}>{stalePlan}</Text>}
            {train && !boardingAlreadyShown && <Text style={styles.routeMeta}>탑승 {formatBoardingTrain(train, true)}</Text>}

            {(p.legs.length > 0 || p.segments.length > 0) && <View style={styles.journey}>
                {p.legs.length > 0 ? p.legs.map((leg, index) => {
                    const transfer = index > 0 ? formatLegTransfer(leg) : null;
                    const segment = p.segments.find(item => leg.lineId !== null ? item.lineId === leg.lineId : item.lineName === leg.lineName);
                    const legTimes = formatTripTimes(leg.boardAt, leg.alightAt, p.departureAt);
                    return <View key={index}>
                        {!!transfer && <View style={styles.transferRow}>
                            <View style={[styles.transferRail, { marginHorizontal: 13 * scale - 1 }]} />
                            <Ionicons name="walk-outline" size={17} color={MUTED} />
                            <Text style={styles.transferText}>{transfer}</Text>
                        </View>}
                        <JourneyLeg lineId={leg.lineId} lineName={leg.lineName} color={segment?.color ?? MUTED}
                            from={leg.fromStationName} to={leg.toStationName} fromTime={legTimes.departure} toTime={legTimes.arrival}
                            description={`${formatLegTrain(leg)} / ${leg.stationCount}개 역`}
                            accessibilityLabel={`${formatLeg(leg)} / ${formatLegTrain(leg)}`} scale={scale} />
                    </View>;
                }) : p.segments.map((segment, index) => (
                    <JourneyLeg key={index} lineId={segment.lineId} lineName={segment.lineName} color={segment.color}
                        from={segment.fromStationName} to={segment.toStationName} fromTime={null} toTime={null}
                        description={`${segment.lineName} / ${segment.stationCount}개 역`}
                        accessibilityLabel={`${formatStationName(segment.fromStationName)} → ${formatStationName(segment.toStationName)}, ${segment.stationCount}개 역`}
                        scale={scale} />
                ))}
            </View>}

            <View style={styles.metrics}>
                {metrics.map((metric, index) => (
                    <View key={metric.label} accessible accessibilityLabel={metric.a11y}
                        style={[styles.metric, { flexBasis: `${100 / columns}%` },
                            index % columns !== columns - 1 && index !== metrics.length - 1 && styles.metricRight,
                            index < Math.floor((metrics.length - 1) / columns) * columns && styles.metricBottom]}>
                        <Text style={styles.metricLabel}>{metric.label}</Text>
                        <View style={styles.metricValueRow}>
                            {'color' in metric && <View style={[styles.congestionDot, { backgroundColor: metric.color }]} />}
                            <Text style={[styles.metricValue, 'color' in metric && { color: metric.color }, metric.missing && styles.missingValue]}>{metric.value}</Text>
                        </View>
                    </View>
                ))}
            </View>
            <View style={styles.noteRow}>
                <Ionicons name="information-circle-outline" size={16} color="#9B94A4" />
                <Text style={styles.note}>{note}</Text>
            </View>
        </View>
    );
}

function JourneyLeg({ lineId, lineName, color, from, to, fromTime, toTime, description, accessibilityLabel, scale }: {
    lineId: number | null; lineName: string; color: string; from: string; to: string;
    fromTime: string | null; toTime: string | null; description: string; accessibilityLabel: string; scale: number;
}) {
    const markerSize = 26 * scale;
    return (
        <View style={styles.leg} accessible accessibilityLabel={accessibilityLabel}>
            <View style={[styles.rail, { width: markerSize }]}>
                <View style={[styles.lineBadge, { width: markerSize, height: markerSize, borderRadius: markerSize / 2, backgroundColor: color }]} accessibilityLabel={lineName}>
                    <Text style={styles.lineNumber}>{lineId ?? '?'}</Text>
                </View>
                <View style={[styles.railLine, { backgroundColor: color }]} />
                <View style={[styles.stopDot, { borderColor: color }]} />
            </View>
            <View style={styles.legBody}>
                <View style={styles.stationRow}>
                    <Text style={styles.station}>{formatStationName(from)}</Text>
                    {!!fromTime && <Text style={styles.stationTime}>{fromTime}</Text>}
                </View>
                <Text style={styles.routeMeta}>{description}</Text>
                <View style={styles.stationRow}>
                    <Text style={styles.station}>{formatStationName(to)}</Text>
                    {!!toTime && <Text style={styles.stationTime}>{toTime}</Text>}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    detail: { marginTop: 16, padding: 16, borderRadius: 18, backgroundColor: '#F7F5FA', gap: 14 },
    timeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
    timeColumn: { flex: 1, minWidth: 84, gap: 4 },
    timeRowStacked: { flexDirection: 'column', alignItems: 'stretch' },
    timeColumnStacked: { flex: 0, minWidth: 0 },
    timeArrowStacked: { alignSelf: 'center' },
    timeLabel: { color: MUTED, fontSize: 14, lineHeight: 21 },
    clock: { color: INK, fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.5 },
    slackChip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#EDE8F3' },
    slack: { color: PURPLE, fontSize: 14, lineHeight: 21, fontWeight: '600' },
    missingValue: { color: '#8A8491', fontSize: 14, lineHeight: 23, fontWeight: '500' },
    lateChip: { backgroundColor: '#FBECEF' },
    late: { color: '#C2415B' },
    journey: { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 16, gap: 12 },
    leg: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
    rail: { alignItems: 'center', paddingTop: 1, paddingBottom: 6 },
    lineBadge: { alignItems: 'center', justifyContent: 'center' },
    lineNumber: { color: '#FFFFFF', fontSize: 14, lineHeight: 22, fontWeight: '700' },
    railLine: { width: 3, minHeight: 22, flex: 1, marginVertical: 4, borderRadius: 2 },
    stopDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, backgroundColor: '#F7F5FA' },
    legBody: { flex: 1, minWidth: 0, gap: 8 },
    stationRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 8, rowGap: 4 },
    station: { flex: 1, minWidth: 60, color: INK, fontSize: 15, lineHeight: 23, fontWeight: '600' },
    stationTime: { flexShrink: 1, color: INK, fontSize: 14, lineHeight: 23, fontWeight: '600', textAlign: 'right' },
    routeMeta: { flexShrink: 1, color: MUTED, fontSize: 14, lineHeight: 22 },
    transferRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
    transferRail: { width: 2, alignSelf: 'stretch', minHeight: 24, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: '#CFC8D7' },
    transferText: { flex: 1, color: MUTED, fontSize: 14, lineHeight: 22 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: BORDER, borderRadius: 12, overflow: 'hidden', backgroundColor: '#FFFFFF' },
    metric: { flexGrow: 1, flexShrink: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 10, gap: 4, alignItems: 'center' },
    metricRight: { borderRightWidth: 1, borderRightColor: BORDER },
    metricBottom: { borderBottomWidth: 1, borderBottomColor: BORDER },
    metricLabel: { color: MUTED, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    metricValueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 5 },
    metricValue: { color: INK, fontSize: 15, lineHeight: 23, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
    congestionDot: { width: 8, height: 8, borderRadius: 4 },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    note: { flex: 1, color: MUTED, fontSize: 14, lineHeight: 21 },
    staleNote: { color: MUTED, fontSize: 14, lineHeight: 21 },
});
