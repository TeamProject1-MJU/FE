import { StyleSheet, Text, View } from 'react-native';

import type { Congestion as CongestionData, CongestionLevel } from '@/types/route';

/** 명세 6.2 혼잡도 표시 규칙 (단계별 색) */
export const CONGESTION_STYLE: Record<CongestionLevel, { color: string; bars: number }> = {
    COMFORTABLE: { color: '#19b36b', bars: 1 },
    RELAXED: { color: '#8cc63f', bars: 2 },
    NORMAL: { color: '#e5a800', bars: 3 },
    CROWDED: { color: '#f07a1f', bars: 4 },
    VERY_CROWDED: { color: '#e5484d', bars: 4 },
};

const UNSUPPORTED_COLOR = '#a1a8b8';
const EMPTY_BAR = '#d9dde4';
const BAR_HEIGHTS = [4, 7, 10, 13];

type Props = {
    congestion: CongestionData | null | undefined;
    /** 데이터 없을 때 라벨을 짧게(미제공) 표시 */
    compact?: boolean;
};

/** 신호 막대 아이콘 + 혼잡 단계 라벨 */
export default function Congestion({ congestion, compact = false }: Props) {
    const level = congestion?.supported ? congestion.level : null;
    const style = level ? CONGESTION_STYLE[level] : null;
    const color = style?.color ?? UNSUPPORTED_COLOR;
    const label = level
        ? congestion?.levelLabel ?? ''
        : compact ? '미제공' : '혼잡도 데이터 미제공';

    return (
        <View style={styles.row} accessibilityLabel={`혼잡도 ${label}`}>
            <View style={styles.bars}>
                {BAR_HEIGHTS.map((height, index) => (
                    <View
                        key={height}
                        style={[
                            styles.bar,
                            {
                                height,
                                backgroundColor: style && index < style.bars ? color : EMPTY_BAR,
                            },
                        ]}
                    />
                ))}
            </View>

            <Text style={[styles.label, { color }]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },

    bars: {
        height: 13,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 1.5,
    },

    bar: {
        width: 3.2,
        borderRadius: 1.3,
    },

    label: {
        fontSize: 13,
        fontWeight: '700',
    },
});
