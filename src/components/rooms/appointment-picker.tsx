import { useEffect, useRef, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const WHITE = '#ffffff';
const ROW = 44;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function fromLocalDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseLocalDate(value?: string): Date {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-').map(Number);
        const result = new Date(year, month - 1, day);
        if (result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day) {
            return result;
        }
    }
    return new Date();
}

type DatePickerProps = {
    visible: boolean;
    value?: string;
    onClose: () => void;
    onConfirm: (date: string) => void;
};

export function CalendarModal({ visible, value, onClose, onConfirm }: DatePickerProps) {
    const [selected, setSelected] = useState(() => fromLocalDate(parseLocalDate(value)));
    const [month, setMonth] = useState(() => {
        const current = parseLocalDate(value);
        return new Date(current.getFullYear(), current.getMonth(), 1);
    });

    useEffect(() => {
        if (visible) {
            const picked = parseLocalDate(value);
            setSelected(fromLocalDate(picked));
            setMonth(new Date(picked.getFullYear(), picked.getMonth(), 1));
        }
    }, [visible, value]);

    const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (number | null)[] = [
        ...Array.from({ length: firstDay }, () => null),
        ...Array.from({ length: days }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const today = fromLocalDate(new Date());

    const changeMonth = (delta: number) => {
        setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
    };

    return (
        <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={styles.dialog}>
                    <Text style={styles.modalTitle}>약속 날짜 선택</Text>
                    <View style={styles.monthBar}>
                        <Pressable style={styles.monthButton} onPress={() => changeMonth(-1)}>
                            <Text style={styles.monthArrow}>‹</Text>
                        </Pressable>
                        <Text style={styles.monthTitle}>
                            {month.getFullYear()}년 {month.getMonth() + 1}월
                        </Text>
                        <Pressable style={styles.monthButton} onPress={() => changeMonth(1)}>
                            <Text style={styles.monthArrow}>›</Text>
                        </Pressable>
                    </View>
                    <View style={styles.calendarGrid}>
                        {WEEKDAYS.map((day, i) => (
                            <View key={day} style={styles.dayCell}>
                                <Text style={[styles.weekday, i === 0 && styles.sunday]}>{day}</Text>
                            </View>
                        ))}
                        {cells.map((day, index) => {
                            if (day === null) return <View style={styles.dayCell} key={`blank-${index}`} />;
                            const date = fromLocalDate(new Date(month.getFullYear(), month.getMonth(), day));
                            const disabled = date < today;
                            const active = date === selected;
                            return (
                                <View style={styles.dayCell} key={date}>
                                    <Pressable
                                        disabled={disabled}
                                        style={[styles.dayButton, active && styles.selectedDay]}
                                        onPress={() => setSelected(date)}
                                    >
                                        <Text style={[
                                            styles.dayText,
                                            disabled && styles.disabledDay,
                                            active && styles.selectedDayText,
                                        ]}>
                                            {day}
                                        </Text>
                                    </Pressable>
                                </View>
                            );
                        })}
                    </View>
                    <View style={styles.modalActions}>
                        <Pressable style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelText}>취소</Text>
                        </Pressable>
                        <Pressable
                            style={styles.confirmButton}
                            onPress={() => {
                                onConfirm(selected < today ? today : selected);
                                onClose();
                            }}
                        >
                            <Text style={styles.confirmText}>날짜 선택</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

type TimePickerProps = {
    visible: boolean;
    value?: string;
    onClose: () => void;
    onConfirm: (time: string) => void;
};

function Wheel({
                   count,
                   value,
                   onChange,
                   label,
               }: {
    count: number;
    value: number;
    onChange: (value: number) => void;
    label: string;
}) {
    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        const timer = setTimeout(() => {
            scrollRef.current?.scrollTo({ y: value * ROW, animated: false });
        }, 80);
        return () => clearTimeout(timer);
        // 처음 표시한 뒤 선택 위치로 스크롤하기 위한 효과입니다.
    }, [value]);

    const handleEnd = (offset: number) => {
        const next = Math.min(count - 1, Math.max(0, Math.round(offset / ROW)));
        onChange(next);
    };

    return (
        <View style={styles.wheelColumn}>
            <Text style={styles.wheelLabel}>{label}</Text>
            <View style={styles.wheelFrame}>
                <View pointerEvents="none" style={styles.wheelSelection} />
                <ScrollView
                    ref={scrollRef}
                    style={styles.wheelScroll}
                    contentContainerStyle={styles.wheelContent}
                    showsVerticalScrollIndicator={false}
                    snapToInterval={ROW}
                    decelerationRate="fast"
                    onMomentumScrollEnd={(event) => handleEnd(event.nativeEvent.contentOffset.y)}
                    onScrollEndDrag={(event) => handleEnd(event.nativeEvent.contentOffset.y)}
                    nestedScrollEnabled
                >
                    {Array.from({ length: count }, (_, item) => (
                        <Pressable
                            key={item}
                            style={styles.wheelItem}
                            onPress={() => {
                                onChange(item);
                                scrollRef.current?.scrollTo({ y: item * ROW, animated: true });
                            }}
                        >
                            <Text style={[styles.wheelText, item === value && styles.wheelSelectedText]}>
                                {String(item).padStart(2, '0')}
                            </Text>
                        </Pressable>
                    ))}
                </ScrollView>
            </View>
        </View>
    );
}

export function TimeWheelModal({ visible, value = '19:00', onClose, onConfirm }: TimePickerProps) {
    const [hour, setHour] = useState(19);
    const [minute, setMinute] = useState(0);

    useEffect(() => {
        if (visible) {
            const [h, m] = value.split(':').map(Number);
            setHour(Number.isInteger(h) && h >= 0 && h < 24 ? h : 19);
            setMinute(Number.isInteger(m) && m >= 0 && m < 60 ? m : 0);
        }
    }, [visible, value]);

    return (
        <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
            <View style={styles.overlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={styles.dialog}>
                    <Text style={styles.modalTitle}>약속 시간 선택</Text>
                    <Text style={styles.modalHint}>위아래로 스크롤해 시·분을 선택하세요.</Text>
                    {visible && (
                        <View style={styles.wheels}>
                            <Wheel key={`hour-${value}`} label="시" count={24} value={hour} onChange={setHour} />
                            <Text style={styles.colon}>:</Text>
                            <Wheel key={`minute-${value}`} label="분" count={60} value={minute} onChange={setMinute} />
                        </View>
                    )}
                    <Text style={styles.timePreview}>
                        선택: {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
                    </Text>
                    <View style={styles.modalActions}>
                        <Pressable style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelText}>취소</Text>
                        </Pressable>
                        <Pressable
                            style={styles.confirmButton}
                            onPress={() => {
                                onConfirm(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
                                onClose();
                            }}
                        >
                            <Text style={styles.confirmText}>시간 선택</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(15,28,63,0.50)',
        padding: 20,
    },
    dialog: {
        width: '100%',
        maxWidth: 370,
        backgroundColor: WHITE,
        borderRadius: 22,
        padding: 20,
    },
    modalTitle: { fontSize: 19, fontWeight: '800', color: NAVY, marginBottom: 14 },
    modalHint: { fontSize: 13, color: SECONDARY, marginBottom: 8 },
    monthBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 17,
    },
    monthButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    monthArrow: { color: NAVY, fontSize: 30, fontWeight: '400' },
    monthTitle: { color: NAVY, fontSize: 16, fontWeight: '700' },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { width: '14.285714%', height: 39, alignItems: 'center', justifyContent: 'center' },
    weekday: { fontSize: 12, fontWeight: '700', color: SECONDARY },
    sunday: { color: '#e46b6b' },
    dayButton: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    selectedDay: { backgroundColor: MINT },
    dayText: { color: NAVY, fontSize: 14, fontWeight: '600' },
    disabledDay: { color: '#c4c9d3' },
    selectedDayText: { color: WHITE, fontWeight: '800' },
    modalActions: { flexDirection: 'row', gap: 10, marginTop: 19 },
    cancelButton: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 12, backgroundColor: '#f1f3f7' },
    cancelText: { color: SECONDARY, fontWeight: '700' },
    confirmButton: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 12, backgroundColor: NAVY },
    confirmText: { color: WHITE, fontWeight: '700' },
    wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10 },
    wheelColumn: { width: 100, alignItems: 'center' },
    wheelLabel: { color: SECONDARY, fontSize: 12, fontWeight: '700', marginBottom: 6 },
    wheelFrame: { height: ROW * 3, width: 90, overflow: 'hidden' },
    wheelSelection: {
        position: 'absolute',
        top: ROW,
        left: 0,
        right: 0,
        height: ROW,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: MINT,
        backgroundColor: '#eafbf5',
    },
    wheelScroll: { flex: 1 },
    wheelContent: { paddingVertical: ROW },
    wheelItem: { height: ROW, justifyContent: 'center', alignItems: 'center' },
    wheelText: { color: SECONDARY, fontSize: 20, fontWeight: '500' },
    wheelSelectedText: { color: NAVY, fontWeight: '800' },
    colon: { fontSize: 23, color: NAVY, fontWeight: '800', marginTop: 19 },
    timePreview: { color: NAVY, textAlign: 'center', fontSize: 14, fontWeight: '700', marginTop: 16 },
});
