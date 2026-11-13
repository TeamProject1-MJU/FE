import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CalendarModal, TimeWheelModal } from '@/components/rooms/appointment-picker';
import type { RouteTimeSelection } from '@/types/route';
import { arrivalLastDate, formatRouteTimeSelection, routeTimeOptions, seoulDateTime, toRouteTimeInstant, validateRouteTimeOptions } from '@/utils/route-time';

const MODES = [
    { mode: 'now', label: '지금 출발' },
    { mode: 'departure', label: '출발 시각 지정' },
    { mode: 'arrival', label: '도착 시각 지정' },
] as const;

type Props = {
    value: RouteTimeSelection;
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    onChange: (value: RouteTimeSelection) => void;
};

export default function RouteTimeSelector({ value, open, onOpen, onClose, onChange }: Props) {
    const [mode, setMode] = useState<RouteTimeSelection['mode']>(value.mode);
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [calendar, setCalendar] = useState(false);
    const [clock, setClock] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!open) return;
        const parts = seoulDateTime(value.mode === 'now' ? Date.now() + 60000 : value.at)!;
        setMode(value.mode); setDate(parts.date); setTime(parts.time);
        setCalendar(false); setClock(false); setError('');
    }, [open, value]);

    const apply = () => {
        if (mode === 'now') { onChange({ mode }); onClose(); return; }
        const at = toRouteTimeInstant(date, time);
        if (!at) { setError('올바른 날짜와 시각을 선택해 주세요.'); return; }
        const selection = { mode, at };
        const message = validateRouteTimeOptions(routeTimeOptions(selection));
        if (message) { setError(message); return; }
        onChange(selection); onClose();
    };

    return (
        <>
            <Pressable style={styles.trigger} onPress={onOpen} accessibilityRole="button" accessibilityLabel="검색 시각 선택">
                <Ionicons name="time-outline" size={19} color="#0f1c3f" />
                <View style={styles.flex}>
                    <Text style={styles.caption}>검색 시각 · 한국 시간 기준</Text>
                    <Text style={styles.value}>{formatRouteTimeSelection(value)}</Text>
                </View>
                <Ionicons name="chevron-down" size={17} color="#6b7488" />
            </Pressable>
            <Modal visible={open && !calendar && !clock} transparent animationType="fade" onRequestClose={onClose}>
                <View style={styles.overlay}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="시각 선택 닫기" />
                    <ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled">
                        <Text style={styles.title}>검색 시각 선택</Text>
                        {MODES.map(item => (
                            <Pressable key={item.mode} accessibilityRole="radio" accessibilityState={{ checked: mode === item.mode }}
                                onPress={() => { setMode(item.mode); setError(''); }} style={[styles.mode, mode === item.mode && styles.activeMode]}>
                                <Ionicons name={mode === item.mode ? 'radio-button-on' : 'radio-button-off'} size={20} color="#0f1c3f" />
                                <Text style={styles.modeText}>{item.label}</Text>
                            </Pressable>
                        ))}
                        {mode !== 'now' && (
                            <>
                                <Text style={styles.caption}>{mode === 'departure' ? '출발' : '도착'} 날짜와 시각 · 한국 시간</Text>
                                <Pressable style={styles.field} onPress={() => setCalendar(true)} accessibilityRole="button" accessibilityLabel="검색 날짜 선택">
                                    <Ionicons name="calendar-outline" size={19} color="#0f1c3f" /><Text style={styles.value}>{date}</Text>
                                </Pressable>
                                <Pressable style={styles.field} onPress={() => setClock(true)} accessibilityRole="button" accessibilityLabel="검색 시간 선택">
                                    <Ionicons name="time-outline" size={19} color="#0f1c3f" /><Text style={styles.value}>{time}</Text>
                                </Pressable>
                                {mode === 'arrival' && <Text style={styles.caption}>도착 날짜는 {arrivalLastDate()}까지 선택할 수 있어요.</Text>}
                                <Text style={styles.caption}>날짜가 멀수록 실제 운행 시각과 다를 수 있어요.</Text>
                            </>
                        )}
                        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
                        <View style={styles.actions}>
                            <Pressable style={[styles.button, styles.cancel]} onPress={onClose} accessibilityRole="button"><Text style={styles.value}>취소</Text></Pressable>
                            <Pressable style={[styles.button, styles.confirm]} onPress={apply} accessibilityRole="button"><Text style={styles.confirmText}>적용하고 검색</Text></Pressable>
                        </View>
                    </ScrollView>
                </View>
            </Modal>
            <CalendarModal visible={open && calendar} value={date} title={mode === 'arrival' ? '도착 날짜 선택' : '출발 날짜 선택'}
                minDate={mode === 'arrival' ? seoulDateTime()!.date : ''} maxDate={mode === 'arrival' ? arrivalLastDate() : undefined}
                onClose={() => setCalendar(false)} onConfirm={next => { setDate(next); setError(''); }} />
            <TimeWheelModal visible={open && clock} value={time} title={mode === 'arrival' ? '도착 시각 선택' : '출발 시각 선택'}
                onClose={() => setClock(false)} onConfirm={next => { setTime(next); setError(''); }} />
        </>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    trigger: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e6e9ef', borderRadius: 15 },
    caption: { color: '#6b7488', fontSize: 12, lineHeight: 18 },
    value: { color: '#0f1c3f', fontWeight: '600', fontSize: 14, lineHeight: 21 },
    overlay: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(15,28,63,0.4)' },
    dialog: { flexGrow: 0, maxHeight: '90%', width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: '#ffffff', borderRadius: 20 },
    dialogContent: { padding: 20, gap: 12 },
    title: { color: '#0f1c3f', fontSize: 20, fontWeight: '800', marginBottom: 4 },
    mode: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderWidth: 1, borderColor: '#e6e9ef', borderRadius: 12 },
    activeMode: { backgroundColor: '#e8f8f1', borderColor: '#2bcf9a' },
    modeText: { color: '#0f1c3f', fontSize: 14, fontWeight: '700' },
    field: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: 1, borderColor: '#e6e9ef', borderRadius: 12 },
    error: { color: '#c0394b', lineHeight: 20, fontSize: 13 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    button: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 12 },
    cancel: { borderWidth: 1, borderColor: '#e6e9ef' },
    confirm: { backgroundColor: '#0f1c3f' },
    confirmText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
