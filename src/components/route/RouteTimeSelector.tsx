import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CalendarModal, TimeWheelModal } from '@/components/rooms/appointment-picker';
import type { RouteTimeSelection } from '@/types/route';
import { arrivalLastDate, formatRouteTimeSelection, routeTimeOptions, seoulDateTime, toRouteTimeInstant, validateRouteTimeOptions } from '@/utils/route-time';

// 시트의 토글 두 개예요. 둘 다 꺼지면 지금 출발이에요.
const TOGGLES = [
    { mode: 'departure', title: '출발 시각 설정', description: '출발 시각을 기준으로 대기 시간과 혼잡도를 반영한 경로로 안내해요.' },
    { mode: 'arrival', title: '도착 시각 설정', description: '' },
] as const;

// 라벤더 시안(#184) — 시각 선택 버튼과 출발 시각 설정 시트에 써요.
const LV_CARD = '#FFFFFF';
const LV_CARD_BORDER = '#EEEAF2';
const LV_TEXT = '#25212D';
const LV_SECONDARY = '#83808B';
const LV_MAIN = '#5C3F78';
const LV_MAIN_SOFT = '#EDE8F3';
const LV_DIVIDER = '#F1EEF4';
const LV_FIELD_BORDER = '#E8E4ED';
const LV_CLOSE_BG = '#F4F1F7';
const LV_CLOSE_ICON = '#4A4553';
const LV_TRACK_OFF = '#DCD7E3';
const LV_BACKDROP = 'rgba(37,33,45,0.42)';
const LV_ERROR = '#C0394B'; // 시안에 오류 색이 없어 기존 오류 색을 써요.

// 표시만 해요. 상태값(YYYY-MM-DD, HH:MM)은 그대로 두고 시안 형식으로 보여 줘요.
function dayLabel(date: string) {
    if (date === seoulDateTime()?.date) return '오늘';
    if (date === seoulDateTime(Date.now() + 86400000)?.date) return '내일';
    const [, month, day] = date.split('-').map(Number);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!month || !day || Number.isNaN(weekday)) return date;
    return `${month}월 ${day}일(${'일월화수목금토'[weekday]})`;
}

function timeLabels(time: string) {
    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return ['', '', ''];
    return [hour < 12 ? '오전' : '오후', `${hour % 12 || 12}시`, `${String(minute).padStart(2, '0')}분`];
}

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
                <Ionicons name="time-outline" size={20} color={LV_MAIN} />
                <View style={styles.triggerText}>
                    <Text style={styles.triggerCaption}>{value.mode === 'arrival' ? '도착' : '출발'} 시각 한국 시간 기준</Text>
                    <Text style={styles.triggerValue}>{formatRouteTimeSelection(value)}</Text>
                </View>
                <Ionicons name="chevron-down" size={18} color={LV_SECONDARY} />
            </Pressable>
            <Modal visible={open && !calendar && !clock} transparent animationType="fade" onRequestClose={onClose}>
                <View style={styles.overlay}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="시각 선택 닫기" />
                    <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
                        <View style={styles.header}>
                            <View style={styles.headerSide} />
                            <Text style={styles.title}>{mode === 'arrival' ? '도착 시각 설정' : '출발 시각 설정'}</Text>
                            <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" hitSlop={4}>
                                <Ionicons name="close" size={18} color={LV_CLOSE_ICON} />
                            </Pressable>
                        </View>
                        {TOGGLES.map(item => {
                            const on = mode === item.mode;
                            return (
                                <Pressable key={item.mode} style={[styles.toggleRow, item.mode === 'arrival' && styles.toggleRowNext]}
                                    accessibilityRole="switch" accessibilityLabel={item.title} accessibilityState={{ checked: on }}
                                    onPress={() => { setMode(on ? 'now' : item.mode); setError(''); }}>
                                    <View style={styles.toggleText}>
                                        <Text style={styles.toggleTitle}>{item.title}</Text>
                                        {!!item.description && <Text style={styles.toggleDescription}>{item.description}</Text>}
                                    </View>
                                    <View style={[styles.track, on && styles.trackOn]}>
                                        <View style={[styles.knob, on && styles.knobOn]} />
                                    </View>
                                </Pressable>
                            );
                        })}
                        {mode !== 'now' && (
                            <>
                                <View style={styles.fields}>
                                    <Pressable style={[styles.field, styles.dayField]} onPress={() => setCalendar(true)} accessibilityRole="button" accessibilityLabel="검색 날짜 선택">
                                        <Text style={styles.fieldValue} numberOfLines={1}>{dayLabel(date)}</Text>
                                        <Ionicons name="chevron-expand" size={14} color={LV_SECONDARY} />
                                    </Pressable>
                                    {timeLabels(time).map((label, index) => (
                                        <Pressable key={index} style={styles.field} onPress={() => setClock(true)} accessibilityRole="button" accessibilityLabel="검색 시간 선택">
                                            <Text style={styles.fieldValue} numberOfLines={1}>{label}</Text>
                                            <Ionicons name="chevron-expand" size={14} color={LV_SECONDARY} />
                                        </Pressable>
                                    ))}
                                </View>
                                {mode === 'arrival' && <Text style={styles.caption}>도착 날짜는 {arrivalLastDate()}까지 선택할 수 있어요.</Text>}
                                <Text style={styles.caption}>날짜가 멀수록 실제 운행 시각과 다를 수 있어요.</Text>
                            </>
                        )}
                        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
                        <View style={styles.actions}>
                            <Pressable style={[styles.button, styles.nowButton]} onPress={() => { onChange({ mode: 'now' }); onClose(); }} accessibilityRole="button">
                                <Text style={styles.nowText}>지금 출발</Text>
                            </Pressable>
                            <Pressable style={[styles.button, styles.confirm]} onPress={apply} accessibilityRole="button"><Text style={styles.confirmText}>확인</Text></Pressable>
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
    // 라벤더 시안(#184) — 시각 선택 버튼
    trigger: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: LV_CARD, borderWidth: 1, borderColor: LV_CARD_BORDER, borderRadius: 16 },
    triggerText: { flex: 1, minWidth: 0 },
    triggerCaption: { color: LV_SECONDARY, fontSize: 11.5 },
    triggerValue: { marginTop: 1, color: LV_TEXT, fontSize: 15.5, fontWeight: '600' },
    // 출발 시각 설정 시트(#184 시안)
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: LV_BACKDROP },
    sheet: { flexGrow: 0, maxHeight: '90%', width: '100%', backgroundColor: LV_CARD, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
    sheetContent: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 34 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 56 },
    headerSide: { width: 36 },
    title: { color: LV_TEXT, fontSize: 17, fontWeight: '700' },
    close: { width: 36, height: 36, borderRadius: 18, backgroundColor: LV_CLOSE_BG, alignItems: 'center', justifyContent: 'center' },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: LV_DIVIDER },
    toggleRowNext: { borderTopWidth: 0 },
    toggleText: { flex: 1, minWidth: 0 },
    toggleTitle: { color: LV_TEXT, fontSize: 15.5, fontWeight: '600' },
    toggleDescription: { marginTop: 4, color: LV_SECONDARY, fontSize: 12.5, lineHeight: 19 },
    track: { width: 50, height: 30, borderRadius: 15, backgroundColor: LV_TRACK_OFF },
    trackOn: { backgroundColor: LV_MAIN },
    knob: { position: 'absolute', top: 3, left: 3, width: 24, height: 24, borderRadius: 12, backgroundColor: LV_CARD },
    knobOn: { left: 23 },
    fields: { flexDirection: 'row', gap: 8, marginTop: 18 },
    field: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2, height: 50, paddingHorizontal: 8, borderWidth: 1, borderColor: LV_FIELD_BORDER, borderRadius: 12, backgroundColor: LV_CARD },
    dayField: { flex: 1.5 },
    fieldValue: { flexShrink: 1, color: LV_TEXT, fontSize: 15, fontWeight: '600' },
    caption: { marginTop: 10, color: LV_SECONDARY, fontSize: 12.5, lineHeight: 19 },
    error: { marginTop: 10, color: LV_ERROR, fontSize: 13, lineHeight: 20 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 22 },
    button: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
    nowButton: { backgroundColor: LV_MAIN_SOFT },
    nowText: { color: LV_MAIN, fontSize: 15.5, fontWeight: '600' },
    confirm: { backgroundColor: LV_MAIN },
    confirmText: { color: LV_CARD, fontSize: 15.5, fontWeight: '600' },
});
