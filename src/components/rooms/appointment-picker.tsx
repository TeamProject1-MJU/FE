import { useEffect, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { Text } from '@/components/app-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebModalFrame from '@/components/web-modal-frame';
import { TimeWheel } from '@/components/time-wheel/date-time-wheel';

const NAVY = '#25212D';
const MINT = '#5C3F78';
const SECONDARY = '#83808B';
const BORDER = '#D9CCE4';
const WHITE = '#ffffff';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Display only; picker values and request payloads remain YYYY-MM-DD / HH:mm. */
export function formatAppointmentDateLabel(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return value;
    return `${month}월 ${day}일 (${WEEKDAYS[date.getDay()]})`;
}

export function formatAppointmentTimeLabel(value: string): string {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
    const [hour, minute] = value.split(':');
    const hours = Number(hour);
    return `${hours < 12 ? '오전' : '오후'} ${hours % 12 || 12}:${minute}`;
}

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
    title?: string;
    minDate?: string;
    maxDate?: string;
    visible: boolean;
    value?: string;
    onClose: () => void;
    onConfirm: (date: string) => void;
};

export function CalendarModal({ visible, value, title = '약속 날짜', minDate = fromLocalDate(new Date()), maxDate, onClose, onConfirm }: DatePickerProps) {
    const insets = useSafeAreaInsets();
    const today = fromLocalDate(new Date());
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

    const changeMonth = (delta: number) => {
        setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
    };

    return (
        <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
            <WebModalFrame>
                <View style={styles.overlay}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                    <View style={[styles.dialog, { paddingBottom: insets.bottom + 20 }]}>
                        <View style={styles.grabber} />
                        <ScrollView style={styles.dialogScroll} showsVerticalScrollIndicator={false}>
                            <Text style={styles.modalTitle}>{title}</Text>
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
                                    const disabled = (!!minDate && date < minDate) || (!!maxDate && date > maxDate);
                                    const active = date === selected;
                                    return (
                                        <View style={styles.dayCell} key={date}>
                                            <Pressable
                                                disabled={disabled}
                                                style={[styles.dayButton, date === today && styles.todayDay, active && styles.selectedDay]}
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
                                        onConfirm(selected < minDate ? minDate : maxDate && selected > maxDate ? maxDate : selected);
                                        onClose();
                                    }}
                                >
                                    <Text style={styles.confirmText}>날짜 선택</Text>
                                </Pressable>
                            </View>
                        </ScrollView>
                    </View>
                </View>
            </WebModalFrame>
        </Modal>
    );
}

type TimePickerProps = {
    title?: string;
    visible: boolean;
    value?: string;
    onClose: () => void;
    onConfirm: (time: string) => void;
};

export function TimeWheelModal({ visible, value = '19:00', title = '약속 시간', onClose, onConfirm }: TimePickerProps) {
    const insets = useSafeAreaInsets();
    const [hour, setHour] = useState(19);
    const [minute, setMinute] = useState(0);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    useEffect(() => {
        if (visible) {
            const [h, m] = value.split(':').map(Number);
            setHour(Number.isInteger(h) && h >= 0 && h < 24 ? h : 19);
            setMinute(Number.isInteger(m) && m >= 0 && m < 60 ? m : 0);
        }
    }, [visible, value]);

    // 휠은 HH:MM 으로 알려 줘요. 시와 분 상태로 나눠 담아 열 때 맞추는 동작은 그대로 둬요.
    const changeTime = (next: string) => {
        const [h, m] = next.split(':').map(Number);
        if (Number.isInteger(h) && h >= 0 && h < 24 && Number.isInteger(m) && m >= 0 && m < 60) { setHour(h); setMinute(m); }
    };

    return (
        <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
            <WebModalFrame>
                <View style={styles.overlay}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                    <View style={[styles.dialog, { paddingBottom: insets.bottom + 20 }]}>
                        <View style={styles.grabber} />
                        <Text style={styles.modalTitle}>{title}</Text>
                        <Text style={styles.modalHint}>위아래로 스크롤해 시간을 선택하세요.</Text>
                        {visible && <TimeWheel time={time} onChange={changeTime} />}
                        <Text style={styles.timePreview}>
                            선택: {formatAppointmentTimeLabel(time)}
                        </Text>
                        <View style={styles.modalActions}>
                            <Pressable style={styles.cancelButton} onPress={onClose}>
                                <Text style={styles.cancelText}>취소</Text>
                            </Pressable>
                            <Pressable
                                style={styles.confirmButton}
                                onPress={() => {
                                    onConfirm(time);
                                    onClose();
                                }}
                            >
                                <Text style={styles.confirmText}>시간 선택</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </WebModalFrame>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(37,33,45,0.42)',
    },
    dialog: {
        width: '100%',
        maxHeight: '94%',
        backgroundColor: WHITE,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 12,
        paddingHorizontal: 22,
    },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DCD7E3', alignSelf: 'center', marginBottom: 14 },
    dialogScroll: { flexShrink: 1, minHeight: 0 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: NAVY, marginBottom: 14 },
    modalHint: { fontSize: 13, color: SECONDARY, marginBottom: 8 },
    monthBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 17,
    },
    monthButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    monthArrow: { color: MINT, fontSize: 30, fontWeight: '400' },
    monthTitle: { color: NAVY, fontSize: 16, fontWeight: '700' },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { width: '14.285714%', height: 42, alignItems: 'center', justifyContent: 'center' },
    weekday: { fontSize: 12, fontWeight: '700', color: SECONDARY },
    sunday: { color: SECONDARY },
    dayButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    todayDay: { borderWidth: 1.5, borderColor: BORDER },
    selectedDay: { backgroundColor: MINT, borderColor: MINT },
    dayText: { color: NAVY, fontSize: 14, fontWeight: '600' },
    disabledDay: { color: '#C9C4D1' },
    selectedDayText: { color: WHITE, fontWeight: '800' },
    modalActions: { flexDirection: 'row', gap: 10, marginTop: 19 },
    cancelButton: { flex: 1, height: 52, justifyContent: 'center', alignItems: 'center', borderRadius: 26, backgroundColor: '#EDE8F3' },
    cancelText: { color: MINT, fontWeight: '700' },
    confirmButton: { flex: 1, height: 52, justifyContent: 'center', alignItems: 'center', borderRadius: 26, backgroundColor: MINT },
    confirmText: { color: WHITE, fontWeight: '700' },
    timePreview: { color: MINT, textAlign: 'center', fontSize: 15, fontWeight: '700', marginTop: 10 },
});
