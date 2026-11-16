import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import type { Route, RouteTimeSelection } from '@/types/route';
import { formatRouteTimeSelection } from '@/utils/route-time';

export default function RouteTimeNotice({ selection, routes, mock, compact = false, resultCount }: { selection: RouteTimeSelection; routes: Route[]; mock: boolean; compact?: boolean; resultCount?: number }) {
    const arrivalUnconfirmed = selection.mode === 'arrival' && routes.length > 0 && routes.some(route => route.summary.slackSeconds == null);
    return (
        <View style={[resultCount != null ? styles.result : styles.notice, compact && styles.compact]}>
            {compact && <Ionicons name="time-outline" size={14} color="#83808B" />}
            {resultCount != null ? (
                <Text style={styles.resultTitle}>경로 {resultCount}개 <Text style={styles.resultBasis}>{formatRouteTimeSelection(selection)} 기준</Text></Text>
            ) : <Text style={[styles.condition, compact && styles.compactText]}>검색 조건 · {formatRouteTimeSelection(selection)}</Text>}
            {mock && selection.mode !== 'now' ? <Text style={styles.hint}>예시 경로예요. 실제 열차 시각표로 계산한 결과가 아니에요.</Text>
                : arrivalUnconfirmed ? <Text style={styles.hint}>지정한 도착 시각의 적용 여부를 확인할 수 없어요. 표시된 실제 출발·도착 시각을 확인해 주세요.</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    result: { marginVertical: 16, gap: 6 },
    resultTitle: { color: '#25212D', fontSize: 16, fontWeight: '700' },
    resultBasis: { color: '#83808B', fontSize: 12, fontWeight: '400' },
    compact: { padding: 0, paddingVertical: 4, backgroundColor: 'transparent', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
    compactText: { color: '#83808B', fontSize: 12, fontWeight: '400' },
    notice: { padding: 12, gap: 6, borderRadius: 12, backgroundColor: '#eef1f5' },
    condition: { color: '#0f1c3f', fontSize: 13, lineHeight: 19, fontWeight: '600' },
    hint: { color: '#6b7488', fontSize: 12, lineHeight: 18 },
});
