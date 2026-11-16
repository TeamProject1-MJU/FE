import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import Passenger, { type PassengerTone } from '@/components/passenger';
import TrainBlock from '@/components/train-block';
import CongestionBlocks from '@/components/congestion-blocks';

const PURPLE = '#5C3F78';
const TONES: PassengerTone[] = ['me', 'other', 'pink', 'sky'];

function Line({ number }: { number: 2 | 4 | 7 }) {
    return (
        <Text maxFontSizeMultiplier={1} style={[
            styles.line,
            { backgroundColor: number === 4 ? '#00A5DE' : number === 7 ? '#747F00' : '#00A84D' },
        ]}>
            {number}
        </Text>
    );
}

// 소개용 예시 그림이며 실제 검색 결과나 약속방 데이터를 읽지 않아요.
export default function OnboardingIllustration({ page }: { page: number }) {
    if (page === 0) {
        return (
            <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={styles.routePassenger}><Passenger size={86} /></View>
                <View style={styles.train}><TrainBlock line={2} size={112} /></View>
                <View style={[styles.card, styles.routeCard]}>
                    <Text style={styles.tag}>추천 경로</Text>
                    <Text style={styles.duration}>28분</Text>
                    <View style={styles.row}>
                        <Line number={4} />
                        <View style={[styles.track, { backgroundColor: '#00A5DE' }]} />
                        <Line number={2} />
                    </View>
                    <Text style={styles.detail}>환승 1회 / 도보 4분</Text>
                    <View style={styles.congestion}>
                        <CongestionBlocks level={3} size={20} />
                        <Text style={styles.secondary}>보통</Text>
                    </View>
                </View>
            </View>
        );
    }

    if (page === 1) {
        return (
            <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={styles.hangers}>
                    <View style={styles.hanger} /><View style={styles.hanger} />
                </View>
                <View style={styles.camera}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                    <View style={styles.sign}>
                        <Text maxFontSizeMultiplier={1} style={styles.signLine}>2</Text>
                        <Text maxFontSizeMultiplier={1} style={styles.signTitle}>내선순환</Text>
                        <Text maxFontSizeMultiplier={1} style={styles.signArrow}>→</Text>
                    </View>
                </View>
                <View style={styles.directionPassenger}><Passenger size={82} /></View>
                <View style={[styles.card, styles.direction]}>
                    <Passenger size={32} />
                    <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
                    <Text style={styles.directionText}>맞는 방향이에요</Text>
                </View>
            </View>
        );
    }

    if (page === 2) {
        return (
            <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={[styles.connector, { transform: [{ rotate: '32deg' }] }]} />
                <View style={[styles.connector, { transform: [{ rotate: '-32deg' }] }]} />
                <View style={styles.personTopLeft}><Passenger size={68} /></View>
                <View style={styles.personTopRight}><Passenger tone="other" size={68} /></View>
                <View style={styles.personBottomLeft}><Passenger tone="pink" size={68} /></View>
                <View style={styles.personBottomRight}><Passenger tone="sky" size={68} /></View>
                <View style={[styles.card, styles.midpoint]}>
                    <Text style={styles.tag}>추천 중간역</Text>
                    <Text style={styles.stationName}>건대입구역</Text>
                    <View style={styles.row}><Line number={2} /><Line number={7} /></View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.card, styles.room]}>
                <View style={[styles.row, styles.roomHeading]}>
                    <Text style={styles.roomTitle}>주말 저녁 모임</Text>
                    <Text style={styles.tag}>D-3</Text>
                </View>
                <View style={styles.roomStation}>
                    <Line number={2} /><Text style={styles.stationText}>건대입구역</Text>
                </View>
                <View style={styles.avatars}>
                    {TONES.map(tone => <Passenger key={tone} tone={tone} size={48} />)}
                </View>
            </View>
            <View style={[styles.card, styles.bubble]}>
                <Text style={styles.bubbleText}>@링크로, 어디서 만날까?</Text>
                <Text style={styles.sparkle}>✦</Text>
                <View style={styles.bubbleTail} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    art: { width: '100%', maxWidth: 340, height: 300, alignSelf: 'center', justifyContent: 'center' },
    card: {
        backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E4DCEB', borderRadius: 22,
        shadowColor: '#5C3F78', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 10,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    tag: {
        alignSelf: 'flex-start', color: PURPLE, backgroundColor: '#EDE8F3',
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, fontSize: 12, lineHeight: 17, fontWeight: '700',
    },
    line: { width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, color: '#FFF', fontSize: 16, fontWeight: '800' },
    routePassenger: { position: 'absolute', left: 0, bottom: 66 },
    train: { position: 'absolute', left: 16, bottom: 12 },
    routeCard: { width: '62%', alignSelf: 'flex-end', padding: 16 },
    duration: { color: '#25212D', fontSize: 36, lineHeight: 44, fontWeight: '800', marginVertical: 12 },
    track: { height: 7, flex: 1, borderRadius: 4 },
    detail: { color: '#51485C', fontSize: 11, lineHeight: 18, marginTop: 14 },
    congestion: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EDE8F3', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
    secondary: { color: '#746B7F', fontSize: 11 },
    hangers: { position: 'absolute', top: 0, left: '28%', right: '28%', height: 64, flexDirection: 'row', justifyContent: 'space-between' },
    hanger: { width: 8, backgroundColor: '#C9BFD5' },
    camera: { position: 'absolute', top: 40, left: '5%', right: '5%', height: 144, padding: 16, justifyContent: 'center' },
    corner: { position: 'absolute', width: 22, height: 22, borderColor: '#9873B1' },
    topLeft: { left: 0, top: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
    topRight: { right: 0, top: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
    bottomLeft: { left: 0, bottom: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
    bottomRight: { right: 0, bottom: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },
    sign: { backgroundColor: '#00A84D', borderWidth: 6, borderColor: '#FFF', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
    signLine: { width: 34, height: 34, borderRadius: 17, lineHeight: 34, textAlign: 'center', backgroundColor: '#FFF', color: '#009B48', fontSize: 25, fontWeight: '800' },
    signTitle: { color: '#FFF', fontSize: 20, fontWeight: '800' },
    signArrow: { color: '#FFF', fontSize: 26, fontWeight: '700' },
    directionPassenger: { position: 'absolute', left: 0, bottom: 8 },
    direction: { position: 'absolute', right: 0, bottom: 20, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
    check: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#2AA358', alignItems: 'center', justifyContent: 'center' },
    checkText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
    directionText: { color: '#25212D', fontSize: 14, fontWeight: '800' },
    connector: { position: 'absolute', width: '80%', left: '10%', top: 148, height: 4, backgroundColor: '#B89BC7' },
    personTopLeft: { position: 'absolute', left: 0, top: 10 },
    personTopRight: { position: 'absolute', right: 0, top: 10 },
    personBottomLeft: { position: 'absolute', left: 0, bottom: 10 },
    personBottomRight: { position: 'absolute', right: 0, bottom: 10 },
    midpoint: { width: 146, alignSelf: 'center', alignItems: 'center', padding: 14, gap: 12 },
    stationName: { color: '#25212D', fontSize: 20, fontWeight: '800' },
    room: { padding: 18, marginHorizontal: 4, marginBottom: 66 },
    roomHeading: { justifyContent: 'space-between', gap: 4 },
    roomTitle: { color: '#25212D', fontSize: 19, fontWeight: '800', flexShrink: 1 },
    roomStation: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 16 },
    stationText: { color: '#51485C', fontSize: 16 },
    avatars: { borderTopWidth: 1, borderTopColor: '#EDE8F3', paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
    bubble: { position: 'absolute', right: 0, bottom: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18 },
    bubbleText: { color: '#25212D', fontSize: 16, fontWeight: '600' },
    sparkle: { color: '#A17BBB', fontSize: 24 },
    bubbleTail: { position: 'absolute', right: 28, bottom: -10, width: 18, height: 18, backgroundColor: '#FFF', borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#E4DCEB', transform: [{ skewY: '-40deg' }] },
});
