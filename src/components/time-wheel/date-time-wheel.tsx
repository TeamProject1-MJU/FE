import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { AccessibilityActionEvent, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Text } from '@/components/app-text';
import { dateRange, dayLabel, fromTwelveHour, shiftDayTime, shiftWheelValue, toTwelveHour } from '@/components/time-wheel/labels';

// 휠 시안(time-picker 2a) — 한 칸 44, 한 번에 5칸, 위아래 2칸(88) 비워서 첫·끝 칸도 가운데에 와요.
const ITEM = 44;
const VISIBLE = 5;
const PAD = ITEM * Math.floor(VISIBLE / 2);
const WEB = Platform.OS === 'web';
const WEB_SETTLE_MS = 120;

const W_TEXT = '#25212D';
const W_DIM = '#A8A3B0';
const W_BAND = '#EDE8F3';

const MERIDIEMS = ['오전', '오후'];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 순환 칸은 항목을 이만큼 반복한 목록의 가운데 묶음에서 시작해요.
const REPEAT = 200;
// 멈춘 자리가 반복 목록 끝에서 이만큼 묶음 안으로 들어오면 가운데 묶음의 같은 값 자리로 옮겨요.
const RECENTER_EDGE = 20;
// 자리 올림처럼 옆 칸 때문에 바뀔 때 이 칸 수까지만 부드럽게 움직여요.
const SMOOTH_STEPS = 2;

type ColumnProps = {
    items: string[];
    index: number;
    flex: number;
    alignLeft?: boolean;
    /** 끝없이 돌아가는 칸(59 다음 00, 12 다음 1)이에요. */
    cyclic?: boolean;
    /** 값이 이 휠에서 고른 값의 결과(자리 올림)라 바뀐 칸이 가까우면 부드럽게 움직여요. */
    animate?: boolean;
    label: string;
    value: string;
    /** index 는 값 번호, moved 는 움직인 칸 수(부호 있음, 아래로 갈수록 +)예요. */
    onSelect: (index: number, moved: number) => void;
    viewportHeight: number;
};

function WheelColumn({ items, index, flex, alignLeft, cyclic, animate, label, value, onSelect, viewportHeight }: ColumnProps) {
    const list = useRef<FlatList<string>>(null);
    const size = items.length;
    const data = useMemo(() => (cyclic ? Array.from({ length: size * REPEAT }, (_, i) => items[i % size]) : items), [cyclic, items, size]);
    const middle = (valueIndex: number) => Math.floor(REPEAT / 2) * size + valueIndex;
    // 이 칸이 지금 멈춰 있는 칸의 절대 번호예요(순환 칸은 반복 목록 안의 번호). 고른 값이 다시 props 로 돌아와도 또 스크롤하지 않게 해요.
    const settled = useRef(cyclic ? middle(index) : index);
    // 직접 움직인 직후라면 움직이기 전 절대 번호예요. 값이 받아들여지지 않으면 이 자리로 돌아가요.
    const from = useRef<number | null>(null);
    const [turn, setTurn] = useState(0);
    const placed = useRef(false);
    const webTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const last = data.length - 1;
    const valueAt = (at: number) => (cyclic && size ? ((at % size) + size) % size : at);
    // 지금 자리에서 가장 가까운 같은 값 자리예요.
    const closest = (at: number, valueIndex: number) => {
        if (!cyclic || !size) return valueIndex;
        let step = (((valueIndex - valueAt(at)) % size) + size) % size;
        if (step > size / 2) step -= size;
        return Math.min(last, Math.max(0, at + step));
    };

    // 밖에서 값이 바뀌거나(시트를 열 때 값 맞추기, 자리 올림) 고른 값이 받아들여지지 않으면 가장 가까운 같은 값 자리로 옮겨요.
    // 처음 맞추기는 애니메이션 없이, 자리 올림은 한두 칸이면 부드럽게, 되돌리기는 늘 부드럽게 움직여요.
    useEffect(() => {
        const before = from.current;
        from.current = null;
        if (valueAt(settled.current) === index) return;
        const own = before !== null;
        const target = own && valueAt(before) === index ? before : closest(settled.current, index);
        const smooth = placed.current && (own || (!!animate && Math.abs(target - settled.current) <= SMOOTH_STEPS));
        settled.current = target;
        list.current?.scrollToOffset({ offset: target * ITEM, animated: smooth });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index, turn]);

    useEffect(() => () => { if (webTimer.current) clearTimeout(webTimer.current); }, []);

    const choose = (next: number) => {
        if (next === settled.current) return;
        const moved = next - settled.current;
        from.current = settled.current;
        settled.current = next;
        setTurn(t => t + 1);
        onSelect(valueAt(next), moved);
    };
    // 반복 목록 끝에 가까워지면 가운데 묶음의 같은 값 자리로 애니메이션 없이 옮겨요(값은 그대로예요).
    const recenter = () => {
        if (!cyclic || !size) return false;
        const at = settled.current;
        if (at >= RECENTER_EDGE * size && at <= last - RECENTER_EDGE * size) return false;
        const target = middle(valueAt(at));
        settled.current = target;
        if (from.current !== null) from.current += target - at;
        list.current?.scrollToOffset({ offset: target * ITEM, animated: false });
        return true;
    };
    const nearest = (offset: number) => Math.min(last, Math.max(0, Math.round(offset / ITEM)));
    const settle = (offset: number) => {
        const next = nearest(offset);
        choose(next);
        if (recenter()) return;
        // 웹은 snapToInterval 이 먹지 않을 수 있어 멈춘 뒤 가장 가까운 칸으로 직접 붙여요.
        if (WEB && Math.abs(offset - next * ITEM) > 1) list.current?.scrollToOffset({ offset: next * ITEM, animated: true });
    };
    const scrollTo = (next: number) => {
        const target = Math.min(last, Math.max(0, next));
        list.current?.scrollToOffset({ offset: target * ITEM, animated: true });
        choose(target);
    };

    const onEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => settle(event.nativeEvent.contentOffset.y);
    const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!WEB) return;
        const offset = event.nativeEvent.contentOffset.y;
        if (webTimer.current) clearTimeout(webTimer.current);
        webTimer.current = setTimeout(() => { webTimer.current = null; settle(offset); }, WEB_SETTLE_MS);
    };
    // 웹에서 initialScrollIndex 가 안 먹을 때를 대비해 첫 배치 때 한 번 더 애니메이션 없이 맞춰요.
    const onLayout = (_event: LayoutChangeEvent) => {
        if (placed.current) return;
        placed.current = true;
        list.current?.scrollToOffset({ offset: settled.current * ITEM, animated: false });
    };
    const onAccessibilityAction = (event: AccessibilityActionEvent) => {
        const at = cyclic ? settled.current : index;
        if (event.nativeEvent.actionName === 'increment') scrollTo(at + 1);
        if (event.nativeEvent.actionName === 'decrement') scrollTo(at - 1);
    };

    return (
        <View style={[styles.column, { flex, height: viewportHeight }]} accessible accessibilityRole="adjustable" accessibilityLabel={label}
              accessibilityValue={{ text: value }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={onAccessibilityAction}>
            <FlatList
                ref={list}
                data={data}
                extraData={index}
                keyExtractor={(item, i) => `${i}-${item}`}
                // 위 빈 공간(PAD)은 빼고 셈해서 offset = 칸 번호 × 44 가 곧 그 칸이 가운데 오는 위치예요.
                getItemLayout={(_data, i) => ({ length: ITEM, offset: ITEM * i, index: i })}
                initialScrollIndex={settled.current}
                contentContainerStyle={{ paddingVertical: (viewportHeight - ITEM) / 2 }}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                snapToInterval={ITEM}
                decelerationRate="fast"
                scrollEventThrottle={16}
                onScroll={onScroll}
                onMomentumScrollEnd={onEnd}
                onScrollEndDrag={onEnd}
                onLayout={onLayout}
                renderItem={({ item, index: i }) => (
                    <Pressable style={[styles.item, alignLeft && styles.itemLeft]} onPress={() => scrollTo(i)} importantForAccessibility="no">
                        <Text style={[styles.text, valueAt(i) === index && styles.textSelected, alignLeft ? styles.textLeft : styles.textCenter]} numberOfLines={1}>{item}</Text>
                    </Pressable>
                )}
            />
        </View>
    );
}

type Props = {
    /** YYYY-MM-DD (서울 날짜) */
    date: string;
    /** HH:MM (24시간) */
    time: string;
    minDate: string;
    maxDate: string;
    onChange: (date: string, time: string) => void;
    /** Short sheets keep the same row size and snapping, with fewer visible rows. */
    viewportHeight?: number;
};

export function DateTimeWheel({ date, time, minDate, maxDate, onChange, viewportHeight = ITEM * VISIBLE }: Props) {
    const range = useMemo(() => dateRange(minDate, maxDate), [minDate, maxDate]);
    // 범위 밖 날짜(예: 예전에 고른 과거 출발일)는 목록 앞이나 뒤에 붙여 값이 바뀌지 않게 해요.
    // 다른 날로 옮겨도 목록 길이가 바뀌지 않도록 한 번 붙인 날짜는 계속 둬요.
    const [kept, setKept] = useState<string | null>(null);
    if (DATE_PATTERN.test(date) && range.length && !range.includes(date) && kept !== date) setKept(date);
    const dates = useMemo(() => {
        if (!kept || !range.length || range.includes(kept)) return range;
        return kept < range[0] ? [kept, ...range] : [...range, kept];
    }, [kept, range]);
    const dateLabels = useMemo(() => dates.map(dayLabel), [dates]);

    const parts = toTwelveHour(time) ?? { pm: false, hour: 12, minute: 0 };
    const dateIndex = Math.max(0, dates.indexOf(date));
    // 이 휠이 마지막으로 알린 값이에요. 지금 값이 이것과 같으면 자리 올림 결과라 옆 칸이 부드럽게 움직여요.
    // 시트를 열 때처럼 밖에서 맞춘 값은 달라서 애니메이션 없이 옮겨요.
    const emitted = useRef<string | null>(null);
    const animate = emitted.current === `${date} ${time}`;
    const emit = (nextDate: string, nextTime: string) => {
        emitted.current = `${nextDate} ${nextTime}`;
        onChange(nextDate, nextTime);
    };
    const setTime = (pm: boolean, hour: number, minute: number) => emit(date, fromTwelveHour(pm, hour, minute));
    // 분·시 칸은 움직인 칸 수만큼 더하거나 빼서 시, 오전/오후, 날짜까지 이어서 바꿔요.
    // 범위 끝에 막혀 값이 그대로면 알리지 않고, 움직인 칸은 원래 값 자리로 돌아가요.
    const shift = (deltaMinutes: number) => {
        const next = shiftWheelValue(dates, date, time, deltaMinutes);
        if (next.date !== date || next.time !== time) emit(next.date, next.time);
    };

    return (
        <View style={[styles.box, { height: viewportHeight }]}>
            <View style={[styles.band, { top: (viewportHeight - ITEM) / 2 }]} pointerEvents="none" />
            <WheelColumn viewportHeight={viewportHeight} items={dateLabels} index={dateIndex} flex={1.7} alignLeft animate={animate} label="날짜" value={dateLabels[dateIndex] ?? ''}
                         onSelect={i => { if (dates[i]) emit(dates[i], time); }} />
            <WheelColumn viewportHeight={viewportHeight} items={MERIDIEMS} index={parts.pm ? 1 : 0} flex={0.9} animate={animate} label="오전 오후" value={parts.pm ? '오후' : '오전'}
                         onSelect={i => setTime(i === 1, parts.hour, parts.minute)} />
            <WheelColumn viewportHeight={viewportHeight} items={HOURS} index={parts.hour - 1} flex={0.6} cyclic animate={animate} label="시" value={`${parts.hour}시`}
                         onSelect={(_i, moved) => shift(moved * 60)} />
            <View style={[styles.colon, { height: viewportHeight }]} pointerEvents="none"><Text style={styles.colonText}>:</Text></View>
            <WheelColumn viewportHeight={viewportHeight} items={MINUTES} index={parts.minute} flex={0.6} cyclic animate={animate} label="분" value={`${parts.minute}분`}
                         onSelect={(_i, moved) => shift(moved)} />
        </View>
    );
}

type TimeProps = {
    /** HH:MM (24시간) */
    time: string;
    onChange: (time: string) => void;
    viewportHeight?: number;
};

/** 날짜 없이 시각만 고르는 휠(오전/오후, 시, 분). 칸, 모양, 자리 올림은 DateTimeWheel 과 같고, 하루 안에서 돌아가요. */
export function TimeWheel({ time, onChange, viewportHeight = ITEM * VISIBLE }: TimeProps) {
    const parts = toTwelveHour(time) ?? { pm: false, hour: 12, minute: 0 };
    // DateTimeWheel 과 같아요: 이 휠이 알린 값이 돌아오면 자리 올림 결과라 옆 칸이 부드럽게 움직여요.
    const emitted = useRef<string | null>(null);
    const animate = emitted.current === time;
    const emit = (next: string) => {
        emitted.current = next;
        onChange(next);
    };
    // 분과 시 칸은 움직인 칸 수만큼 더하거나 빼서 시, 오전/오후까지 이어서 바꿔요(23:59 다음은 00:00).
    const shift = (deltaMinutes: number) => {
        const next = shiftDayTime(time, deltaMinutes);
        if (next !== time) emit(next);
    };

    return (
        <View style={[styles.box, styles.timeBox, { height: viewportHeight }]}>
            <View style={[styles.band, { top: (viewportHeight - ITEM) / 2 }]} pointerEvents="none" />
            <WheelColumn viewportHeight={viewportHeight} items={MERIDIEMS} index={parts.pm ? 1 : 0} flex={0.9} animate={animate} label="오전 오후" value={parts.pm ? '오후' : '오전'}
                         onSelect={i => emit(fromTwelveHour(i === 1, parts.hour, parts.minute))} />
            <WheelColumn viewportHeight={viewportHeight} items={HOURS} index={parts.hour - 1} flex={0.6} cyclic animate={animate} label="시" value={`${parts.hour}시`}
                         onSelect={(_i, moved) => shift(moved * 60)} />
            <View style={[styles.colon, { height: viewportHeight }]} pointerEvents="none"><Text style={styles.colonText}>:</Text></View>
            <WheelColumn viewportHeight={viewportHeight} items={MINUTES} index={parts.minute} flex={0.6} cyclic animate={animate} label="분" value={`${parts.minute}분`}
                         onSelect={(_i, moved) => shift(moved)} />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { flexDirection: 'row', gap: 4, height: ITEM * VISIBLE, marginTop: 12, paddingHorizontal: 4 },
    timeBox: { paddingHorizontal: 44 },
    band: { position: 'absolute', left: 0, right: 0, top: PAD, height: ITEM, borderRadius: 12, backgroundColor: W_BAND },
    column: { minWidth: 0, height: ITEM * VISIBLE },
    columnContent: { paddingVertical: PAD },
    item: { height: ITEM, justifyContent: 'center', alignItems: 'center' },
    itemLeft: { alignItems: 'flex-start', paddingHorizontal: 8 },
    text: { color: W_DIM, fontSize: 17, fontWeight: '500' },
    textSelected: { color: W_TEXT, fontSize: 19, fontWeight: '700' },
    textLeft: { textAlign: 'left' },
    textCenter: { textAlign: 'center' },
    colon: { width: 10, height: ITEM * VISIBLE, alignItems: 'center', justifyContent: 'center' },
    colonText: { color: W_TEXT, fontSize: 20, fontWeight: '800' },
});