import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import CongestionBlocks from '@/components/congestion-blocks';
import TrainBlock from '@/components/train-block';
import { DIRECTION_LABELS } from '@/components/route/format';
import { blockLevel } from '@/utils/congestion-level';
import type { HomeCongestionState } from '@/utils/home-congestion';
import { formatStationName } from '@/utils/station-name';

const DIRECTIONS = { ...DIRECTION_LABELS, INNER: '내선순환', OUTER: '외선순환' };

export default function HomeCongestionCard({ state, onLocate }: { state: HomeCongestionState; onLocate: () => void }) {
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
