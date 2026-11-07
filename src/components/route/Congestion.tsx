import { StyleSheet, Text, View } from 'react-native';

import type { CongestionSlot } from '@/types/congestion';
import type { Congestion as CongestionData, CongestionLevel } from '@/types/route';

/** 명세 6.2 혼잡도 표시 규칙 (단계별 색) */
export const CONGESTION_STYLE: Record<CongestionLevel, { color: string; bars: number }> = {
    COMFORTABLE: { color: '#19b36b', bars: 1 },
    RELAXED: { color: '#8cc63f', bars: 2 },
    NORMAL: { color: '#e5a800', bars: 3 },
    CROWDED: { color: '#f07a1f', bars: 4 },
    VERY_CROWDED: { color: '#e5484d', bars: 4 },
};

/** 데이터 없음(supported: false) 회색 */
export const UNSUPPORTED_COLOR = '#a1a8b8';

const EMPTY_BAR = '#d9dde4';
const BAR_HEIGHTS = [4, 7, 10, 13];

/** 혼잡도 색. 데이터가 없으면 회색 (명세 6.2) */
export function congestionColor(congestion: CongestionData | null | undefined) {
    const level = congestion?.supported ? congestion.level : null;
    return level ? CONGESTION_STYLE[level].color : UNSUPPORTED_COLOR;
}

/** "11/08 06:00" */
function formatSlot(slot: CongestionSlot) {
    const [, month, day] = (slot.slotDate ?? '').split('-');
    const date = month && day ? `${Number(month)}/${Number(day)} ` : '';
    return `${date}${slot.slotStart}`;
}

type Props = {
    congestion: CongestionData | null | undefined;
    /** 좁은 자리용: 데이터 없을 때 라벨을 '미제공'으로 줄이고, 임시 데이터 표시와 첫차 시각을 생략 */
    compact?: boolean;
    /** 어느 시간대 기준인지 (6.1 stations[] 또는 6.2 응답). firstTrain 이면 '첫차' 표시 */
    slot?: CongestionSlot | null;
};

/**
 * 혼잡도 표시 (#36)
 *
 * - 단계·라벨은 서버가 준 level·levelLabel 을 그대로 씁니다(프론트에서 pct 로 다시 계산하지 않음).
 * - 색만으로 구분하지 않도록 막대 개수와 글자 라벨을 함께 보여줍니다.
 * - 데이터 없음은 회색 '혼잡도 데이터 미제공'으로, '쾌적'(초록 1칸)과 구분됩니다.
 * - firstTrain 이면 '첫차' 라벨과 조회 날짜·시각을 붙입니다.
 * - kind 가 MOCK 이면 '임시' 라벨로 AI 예측값과 구분합니다(혼잡도가 P1 인 동안).
 */
export default function Congestion({ congestion, compact = false, slot }: Props) {
    const level = congestion?.supported ? congestion.level : null;
    const style = level ? CONGESTION_STYLE[level] : null;
    const color = congestionColor(congestion);
    const label = level
        ? congestion?.levelLabel ?? ''
        : compact ? '미제공' : '혼잡도 데이터 미제공';

    const firstTrain = !!slot?.firstTrain;
    const isMock = !!level && congestion?.kind === 'MOCK';

    const spoken = [
        `혼잡도 ${level ? label : '혼잡도 데이터 미제공'}`,
        firstTrain && slot ? `첫차 ${formatSlot(slot)} 기준` : '',
        isMock ? '임시 데이터' : '',
    ]
        .filter(Boolean)
        .join(', ');

    return (
        <View style={styles.row} accessible accessibilityLabel={spoken}>
            {firstTrain && (
                <View style={styles.firstTrainTag}>
                    <Text style={styles.firstTrainText}>첫차</Text>
                </View>
            )}

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

            {!compact && firstTrain && slot && <Text style={styles.slotText}>{formatSlot(slot)} 기준</Text>}

            {!compact && isMock && (
                <View style={styles.mockTag}>
                    <Text style={styles.mockText}>임시</Text>
                </View>
            )}
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

    slotText: {
        color: '#6b7488',
        fontSize: 12,
        fontWeight: '600',
    },

    firstTrainTag: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 5,
        backgroundColor: '#e8edf8',
    },

    firstTrainText: {
        color: '#2c4a8c',
        fontSize: 11,
        fontWeight: '800',
    },

    mockTag: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor: '#d9dde4',
        borderRadius: 5,
    },

    mockText: {
        color: '#6b7488',
        fontSize: 10.5,
        fontWeight: '700',
    },
});