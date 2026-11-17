import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import CongestionBlocks from '@/components/congestion-blocks';
import TrainBlock from '@/components/train-block';
import { DIRECTION_LABELS } from '@/components/route/format';
import { blockLevel } from '@/utils/congestion-level';
import type { HomeCongestionState } from '@/utils/home-congestion';
import { selectedCongestionLabel } from '@/utils/home-congestion';
import type { Station, StationLine } from '@/types/station';
import { formatStationName } from '@/utils/station-name';

const DIRECTIONS = { ...DIRECTION_LABELS, INNER: '내선순환', OUTER: '외선순환' };

type Props = {
    state: HomeCongestionState; onLocate?: () => void;
    station?: Station | null; line?: StationLine | null;
    onClose?: () => void; onSelectLine?: (lineId: number) => void; onRetry?: () => void;
};

function SelectedStationCard({ state, station, line, onClose, onSelectLine, onRetry }: Props & { station: Station }) {
    const ready = state.kind === 'ready' ? state.data : null;
    const estimated = ready?.congestion.kind === 'ESTIMATED';
    return <View style={styles.selectedCard}>
        <View style={styles.selectedHeading}>
            <Text style={styles.caption}>선택한 역</Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="선택한 역 닫기">
                <Ionicons name="close" size={20} color="#83808B" />
            </Pressable>
        </View>
        <View style={styles.selectedContent}>
            <View style={styles.icon}><TrainBlock size={44} color={line?.color ?? '#5C3F78'} /></View>
            <View style={styles.body}>
                <View style={styles.stationRow}>
                    <Text style={styles.stationName}>{formatStationName(station.name)}</Text>
                    <View style={styles.lineChoices}>
                        {station.lines.map(item => {
                            const selected = item.lineId === line?.lineId;
                            return <Pressable key={item.lineId} style={styles.lineChoice} disabled={!station.isSupported} onPress={station.isSupported ? () => onSelectLine?.(item.lineId) : undefined} accessibilityRole="button" accessibilityLabel={`${item.lineName} 혼잡도 보기`} accessibilityState={{ selected, disabled: !station.isSupported }}>
                                <View style={[styles.choiceCircle, { borderColor: item.color, backgroundColor: selected ? item.color : '#fff' }]}>
                                    <Text style={[styles.choiceText, { color: selected ? '#fff' : item.color }]}>{item.lineName.replace('호선', '')}</Text>
                                </View>
                            </Pressable>;
                        })}
                    </View>
                </View>
                {!!line && <Text style={styles.caption}>{line.lineName}{ready ? ` · ${DIRECTIONS[ready.direction]}` : ''}</Text>}
                <View style={styles.labelRow}>
                    <Text style={styles.selectedLabel} accessibilityLiveRegion="polite">{selectedCongestionLabel(state)}</Text>
                    {estimated && <View style={styles.kindChip}><Text style={styles.kindText}>추정</Text></View>}
                </View>
                {state.kind === 'error' && <Pressable style={styles.retry} onPress={onRetry} accessibilityRole="button" accessibilityLabel="선택한 역 혼잡도 다시 시도"><Text style={styles.retryText}>다시 시도</Text></Pressable>}
            </View>
            {ready && <CongestionBlocks size={15} level={blockLevel(ready.congestion)} />}
        </View>
    </View>;
}

export default function HomeCongestionCard(props: Props) {
    const { state, onLocate } = props;
    if (props.station) return state.kind === 'hidden' ? null : <SelectedStationCard {...props} station={props.station} />;
    if (state.kind === 'empty' || state.kind === 'error' || state.kind === 'unsupported') return null;
    if (state.kind === 'hidden') return null;
    if (state.kind === 'loading') return (
        <View style={styles.card} accessible accessibilityLabel="지금 역 혼잡도를 불러오고 있어요">
            <View style={styles.icon} />
            <View style={styles.body}>
                <View style={[styles.skeleton, styles.shortBar]} />
                <View style={[styles.skeleton, styles.longBar]} />
            </View>
        </View>
    );
    if (state.kind === 'off') return (
        <View style={styles.card}>
            <View style={styles.icon}><Ionicons name="locate-outline" size={22} color="#5C3F78" /></View>
            <View style={styles.body}>
                <Text style={styles.offTitle} numberOfLines={1}>지금 역 혼잡도 보기</Text>
                <Text style={styles.offSubtitle} numberOfLines={1}>위치를 켜면 알려 드려요</Text>
            </View>
            <Pressable style={styles.locate} onPress={onLocate} accessibilityRole="button" accessibilityLabel="위치 켜기">
                <Text style={styles.locateText}>위치 켜기</Text>
            </Pressable>
        </View>
    );
    const { station, line, direction, congestion } = state.data;
    const name = formatStationName(station.name);
    const kind = congestion.kind === 'ESTIMATED' ? '추정' : congestion.kind === 'MOCK' ? '임시' : '';
    return (
        <View style={styles.card} accessible accessibilityLabel={`지금 ${name} ${line.lineName} ${DIRECTIONS[direction]} 혼잡도 ${congestion.levelLabel}${kind ? `, ${kind} 데이터` : ''}`}>
            <View style={styles.icon}><TrainBlock size={44} color={line.color} /></View>
            <View style={styles.body}>
                <View style={styles.captionRow}>
                    <Text style={styles.caption} numberOfLines={1}>지금 {name} ·</Text>
                    <View style={[styles.lineCircle, { backgroundColor: line.color }]}><Text style={styles.lineText}>{line.lineName.replace('호선', '')}</Text></View>
                    <Text style={styles.caption} numberOfLines={1}>{DIRECTIONS[direction]}</Text>
                </View>
                <View style={styles.labelRow}>
                    <Text style={styles.label} numberOfLines={1}>{congestion.levelLabel}</Text>
                    {!!kind && <View style={styles.kindChip}><Text style={styles.kindText}>{kind}</Text></View>}
                </View>
            </View>
            <CongestionBlocks size={15} level={blockLevel(congestion)} />
        </View>
    );
}

const styles = StyleSheet.create({
    selectedCard: { marginBottom: 16, padding: 14, paddingTop: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEEAF2', borderRadius: 18 },
    selectedHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
    selectedContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stationRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
    stationName: { fontSize: 17, fontWeight: '800', color: '#25212D' },
    lineChoices: { flexDirection: 'row', flexWrap: 'wrap' },
    lineChoice: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    choiceCircle: { minWidth: 23, height: 23, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
    choiceText: { fontSize: 10, fontWeight: '800' },
    selectedLabel: { fontSize: 14, fontWeight: '700', color: '#25212D', flexShrink: 1 },
    retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    retryText: { color: '#5C3F78', fontSize: 13, fontWeight: '700' },
    card: { height: 68, flexShrink: 0, marginBottom: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEEAF2', borderRadius: 18 },
    icon: { width: 46, height: 46, flexShrink: 0, borderRadius: 14, backgroundColor: '#EDE8F3', alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0, gap: 3 },
    captionRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    caption: { flexShrink: 1, fontSize: 11.5, fontWeight: '600', color: '#83808B' },
    lineCircle: { width: 15, height: 15, borderRadius: 7.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    lineText: { fontSize: 9, fontWeight: '800', color: '#fff' },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: { fontSize: 17, fontWeight: '800', color: '#25212D', flexShrink: 1 },
    kindChip: { borderRadius: 6, paddingVertical: 1, paddingHorizontal: 6, backgroundColor: '#F4F1F7' },
    kindText: { fontSize: 10, fontWeight: '700', color: '#83808B' },
    offTitle: { fontSize: 14.5, fontWeight: '800', color: '#25212D' },
    offSubtitle: { fontSize: 12, color: '#83808B' },
    locate: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#5C3F78', alignItems: 'center', justifyContent: 'center' },
    locateText: { fontSize: 12.5, fontWeight: '800', color: '#fff' },
    skeleton: { height: 11, borderRadius: 5, backgroundColor: '#EEEAF2' },
    shortBar: { width: '70%' },
    longBar: { width: '90%', height: 17 },
});
