import { StyleSheet, Text, View } from 'react-native';

import type { RouteLine } from '@/types/route';

const FALLBACK = '#a1a8b8';

type Props = {
    line: RouteLine | null;
    /** true 면 원 옆에 'n호선' 글자도 표시 */
    withName?: boolean;
    size?: number;
};

/** 노선 번호 원형 배지 (예: ② 2호선) */
export default function LineBadge({ line, withName = false, size = 19 }: Props) {
    const color = line?.color ?? FALLBACK;
    const label = line?.id != null ? String(line.id) : '?';

    return (
        <View style={styles.row}>
            <View
                style={[
                    styles.circle,
                    { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
                ]}
            >
                <Text style={[styles.number, { fontSize: size * 0.56 }]}>{label}</Text>
            </View>

            {withName && <Text style={styles.name}>{line?.name ?? '노선 정보 없음'}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },

    circle: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    number: {
        color: '#ffffff',
        fontWeight: '800',
    },

    name: {
        color: '#0f1c3f',
        fontSize: 13.5,
        fontWeight: '800',
    },
});
