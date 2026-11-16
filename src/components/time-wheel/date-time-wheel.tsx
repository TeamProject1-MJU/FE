import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { AccessibilityActionEvent, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Text } from '@/components/app-text';
import { dateRange, dayLabel, fromTwelveHour, toTwelveHour } from '@/components/time-wheel/labels';

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

type ColumnProps = {
    items: string[];
    index: number;
    flex: number;
    alignLeft?: boolean;
    label: string;
    value: string;
    onSelect: (index: number) => void;
};

function WheelColumn({ items, index, flex, alignLeft, label, value, onSelect }: ColumnProps) {
    const list = useRef<FlatList<string>>(null);
    // 이 칸이 지금 멈춰 있는 칸 번호예요. 고른 값이 다시 props 로 돌아와도 또 스크롤하지 않게 해요.
    const settled = useRef(index);
    const placed = useRef(false);
    const webTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const last = items.length - 1;

    // 밖에서 값이 바뀌면(시트를 열 때 값 맞추기, 날짜 목록 변화) 애니메이션 없이 옮겨요.
    useEffect(() => {
        if (index === settled.current) return;
        settled.current = index;
        list.current?.scrollToOffset({ offset: index * ITEM, animated: false });
    }, [index]);

    useEffect(() => () => { if (webTimer.current) clearTimeout(webTimer.current); }, []);

    const choose = (next: number) => {
        if (next === settled.current) return;
        settled.current = next;
        onSelect(next);
    };
    const nearest = (offset: number) => Math.min(last, Math.max(0, Math.round(offset / ITEM)));
    const settle = (offset: number) => {
        const next = nearest(offset);
        // 웹은 snapToInterval 이 먹지 않을 수 있어 멈춘 뒤 가장 가까운 칸으로 직접 붙여요.
        if (WEB && Math.abs(offset - next * ITEM) > 1) list.current?.scrollToOffset({ offset: next * ITEM, animated: true });
        choose(next);
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
        if (event.nativeEvent.actionName === 'increment') scrollTo(index + 1);
        if (event.nativeEvent.actionName === 'decrement') scrollTo(index - 1);
    };

    return (
        <View style={[styles.column, { flex }]} accessible accessibilityRole="adjustable" accessibilityLabel={label}
            accessibilityValue={{ text: value }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={onAccessibilityAction}>
            <FlatList
                ref={list}
                data={items}
                extraData={index}
                keyExtractor={(item, i) => `${i}-${item}`}
                // 위 빈 공간(PAD)은 빼고 셈해서 offset = 칸 번호 × 44 가 곧 그 칸이 가운데 오는 위치예요.
                getItemLayout={(_data, i) => ({ length: ITEM, offset: ITEM * i, index: i })}
                initialScrollIndex={index}
                contentContainerStyle={styles.columnContent}
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
                        <Text style={[styles.text, i === index && styles.textSelected, alignLeft ? styles.textLeft : styles.textCenter]} numberOfLines={1}>{item}</Text>
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
};

export function DateTimeWheel({ date, time, minDate, maxDate, onChange }: Props) {
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
    const setTime = (pm: boolean, hour: number, minute: number) => onChange(date, fromTwelveHour(pm, hour, minute));

    return (
        <View style={styles.box}>
            <View style={styles.band} pointerEvents="none" />
            <WheelColumn items={dateLabels} index={dateIndex} flex={1.7} alignLeft label="날짜" value={dateLabels[dateIndex] ?? ''}
                onSelect={i => { if (dates[i]) onChange(dates[i], time); }} />
            <WheelColumn items={MERIDIEMS} index={parts.pm ? 1 : 0} flex={0.9} label="오전 오후" value={parts.pm ? '오후' : '오전'}
                onSelect={i => setTime(i === 1, parts.hour, parts.minute)} />
            <WheelColumn items={HOURS} index={parts.hour - 1} flex={0.6} label="시" value={`${parts.hour}시`}
                onSelect={i => setTime(parts.pm, i + 1, parts.minute)} />
            <View style={styles.colon} pointerEvents="none"><Text style={styles.colonText}>:</Text></View>
            <WheelColumn items={MINUTES} index={parts.minute} flex={0.6} label="분" value={`${parts.minute}분`}
                onSelect={i => setTime(parts.pm, parts.hour, i)} />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { flexDirection: 'row', gap: 4, height: ITEM * VISIBLE, marginTop: 12, paddingHorizontal: 4 },
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
