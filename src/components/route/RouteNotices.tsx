import { StyleSheet, Text, View } from 'react-native';
import type { RouteSummary } from '@/types/route';

export default function RouteNotices({ summary }: { summary: RouteSummary }) {
    if (!summary.arrivesAfterAppointment && !(summary.noService && summary.serviceNotice)) return null;
    return (
        <View style={styles.notices}>
            {summary.noService && !!summary.serviceNotice && <Text style={styles.notice}>{summary.serviceNotice}</Text>}
            {summary.arrivesAfterAppointment && <Text style={styles.badge}>약속 시각보다 늦게 도착해요</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    notices: { width: '100%', gap: 8, marginTop: 8 },
    notice: { padding: 12, borderRadius: 12, backgroundColor: '#fff6e0', color: '#7a5600', fontSize: 13, lineHeight: 20, fontWeight: '600' },
    badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: '#fff1cc', color: '#9a6a00', fontSize: 12.5, lineHeight: 19, fontWeight: '700' },
});
