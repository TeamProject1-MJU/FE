import { StyleSheet, Text, View } from 'react-native';

const NAVY = '#0f1c3f';
const people = ['민', '준', '서', '지'];
const colors = ['#ffd7c2', '#cfe3ff', '#d9f2e4', '#eadfff'];

function Line({ number }: { number: 2 | 4 | 7 }) {
    return (
        <Text
            style={[
                styles.line,
                {
                    backgroundColor:
                        number === 4
                            ? '#00a5de'
                            : number === 7
                                ? '#747f00'
                                : '#00a84d',
                },
            ]}
        >
            {number}
        </Text>
    );
}

export default function OnboardingIllustration({
                                                   page,
                                               }: {
    page: number;
}) {
    if (page === 0) {
        return (
            <View style={styles.art}>
                <Text style={styles.departure}>
                    ◷  18:30 출발 기준
                </Text>

                <View style={styles.card}>
                    <View style={styles.row}>
                        <Text style={styles.tag}>추천</Text>
                        <Text style={styles.secondary}>● 보통</Text>
                    </View>

                    <Text style={styles.duration}>28분</Text>

                    <View style={styles.row}>
                        <Line number={4} />
                        <View
                            style={[
                                styles.track,
                                { backgroundColor: '#00a5de' },
                            ]}
                        />
                        <Line number={2} />
                        <View
                            style={[
                                styles.track,
                                {
                                    flex: 1.7,
                                    backgroundColor: '#00a84d',
                                },
                            ]}
                        />
                    </View>

                    <Text style={styles.detail}>
                        환승 1회  |  도보 4분
                    </Text>
                </View>
            </View>
        );
    }

    if (page === 1) {
        return (
            <View style={styles.art}>
                <View style={styles.camera}>
                    <View style={styles.corners}>
                        <Text style={styles.corner}>⌜</Text>
                        <Text style={styles.corner}>⌝</Text>
                    </View>

                    <View style={styles.sign}>
                        <Line number={2} />

                        <View style={styles.grow}>
                            <Text style={styles.signTitle}>
                                성수 · 잠실 방면
                            </Text>
                            <Text style={styles.secondary}>
                                Seongsu · Jamsil
                            </Text>
                        </View>

                        <Text style={styles.arrow}>→</Text>
                    </View>
                </View>

                <View style={[styles.card, styles.direction]}>
                    <Text style={styles.directionArrow}>→</Text>

                    <View style={styles.grow}>
                        <Text style={styles.ai}>
                            ✦ AI 분석 완료
                        </Text>
                        <Text style={styles.signTitle}>
                            오른쪽으로 이동하세요
                        </Text>
                    </View>
                </View>
            </View>
        );
    }

    if (page === 2) {
        return (
            <View style={[styles.art, styles.card]}>
                <View style={styles.row}>
                    <Text style={styles.tag}>최적 중간역</Text>
                    <Text style={styles.green}>최대 차이 6분</Text>
                </View>

                <View style={[styles.row, styles.station]}>
                    <Text style={[styles.stationName, styles.grow]}>
                        건대입구역
                    </Text>
                    <Line number={2} />
                    <Line number={7} />
                </View>

                {[31, 27, 33, 29].map((time, index) => (
                    <View
                        key={time}
                        style={[styles.row, styles.personRow]}
                    >
                        <Text
                            style={[
                                styles.avatar,
                                { backgroundColor: colors[index] },
                            ]}
                        >
                            {people[index]}
                        </Text>

                        <View style={styles.bar}>
                            <View
                                style={[
                                    styles.fill,
                                    { width: `${(time / 33) * 100}%` },
                                ]}
                            />
                        </View>

                        <Text style={styles.time}>{time}분</Text>
                    </View>
                ))}
            </View>
        );
    }

    return (
        <View style={styles.art}>
            <View style={styles.room}>
                <View style={styles.row}>
                    <Text style={styles.roomTitle}>
                        기말 끝 파티
                    </Text>
                    <Text style={styles.tag}>D-3</Text>
                </View>

                <View style={[styles.row, styles.station]}>
                    <Text style={[styles.roomStation, styles.grow]}>
                        건대입구역
                    </Text>
                    <Line number={2} />
                    <Line number={7} />
                </View>

                <View style={styles.avatars}>
                    {people.map((person, index) => (
                        <Text
                            key={person}
                            style={[
                                styles.avatar,
                                { backgroundColor: colors[index] },
                            ]}
                        >
                            {person}
                        </Text>
                    ))}
                </View>
            </View>

            <View style={styles.bubble}>
                <Text style={styles.ai}>✦</Text>

                <Text style={styles.bubbleText}>
                    <Text style={styles.bold}>
                        17:25 전에 출발
                    </Text>
                    하면{'\n'}6시 전에 도착해요
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    art: {
        width: '100%',
        maxWidth: 360,
        alignSelf: 'center',
    },
    card: {
        padding: 24,
        borderWidth: 1,
        borderColor: '#e4e8ef',
        borderRadius: 26,
        backgroundColor: '#fff',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        justifyContent: 'space-between',
    },
    grow: {
        flex: 1,
    },
    departure: {
        alignSelf: 'flex-start',
        padding: 12,
        marginBottom: 16,
        borderRadius: 8,
        backgroundColor: NAVY,
        color: '#fff',
        fontSize: 13,
        fontWeight: '700',
    },
    tag: {
        padding: 8,
        borderRadius: 8,
        color: '#168767',
        backgroundColor: '#e6f8f1',
        fontSize: 13,
        fontWeight: '800',
    },
    secondary: {
        color: '#697386',
        fontSize: 12,
    },
    duration: {
        marginVertical: 20,
        color: NAVY,
        fontSize: 40,
        fontWeight: '800',
    },
    line: {
        width: 28,
        height: 28,
        borderRadius: 14,
        textAlign: 'center',
        lineHeight: 28,
        color: '#fff',
        fontWeight: '700',
    },
    track: {
        flex: 1,
        height: 8,
        borderRadius: 8,
    },
    detail: {
        marginTop: 20,
        color: '#697386',
        fontSize: 13,
    },
    camera: {
        backgroundColor: '#152442',
        padding: 20,
        borderRadius: 26,
        paddingBottom: 60,
    },
    corners: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    corner: {
        color: '#fff',
        fontSize: 40,
    },
    sign: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderColor: '#2bcf9a',
        borderWidth: 6,
        borderRadius: 8,
        padding: 10,
    },
    signTitle: {
        color: NAVY,
        fontSize: 15,
        fontWeight: '800',
        marginVertical: 4,
    },
    arrow: {
        fontSize: 26,
        color: NAVY,
    },
    direction: {
        marginTop: -30,
        marginHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
    },
    directionArrow: {
        fontSize: 32,
        color: '#2bcf9a',
        backgroundColor: NAVY,
        padding: 10,
        borderRadius: 12,
    },
    ai: {
        color: '#7955c7',
        fontSize: 13,
        fontWeight: '700',
    },
    green: {
        color: '#168767',
        fontSize: 12,
        fontWeight: '700',
    },
    station: {
        marginVertical: 24,
    },
    stationName: {
        fontSize: 22,
        fontWeight: '800',
        color: NAVY,
    },
    personRow: {
        marginTop: 12,
    },
    avatar: {
        width: 28,
        height: 28,
        borderRadius: 14,
        textAlign: 'center',
        lineHeight: 28,
        color: NAVY,
        fontSize: 12,
        fontWeight: '800',
    },
    bar: {
        flex: 1,
        height: 8,
        borderRadius: 8,
        backgroundColor: '#e4e8ef',
        overflow: 'hidden',
    },
    fill: {
        height: '100%',
        backgroundColor: NAVY,
        borderRadius: 8,
    },
    time: {
        width: 36,
        color: NAVY,
        fontSize: 13,
        textAlign: 'right',
    },
    room: {
        padding: 24,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: '#ffffff20',
        backgroundColor: '#ffffff14',
    },
    roomTitle: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '800',
    },
    roomStation: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    avatars: {
        flexDirection: 'row',
        gap: 4,
    },
    bubble: {
        flexDirection: 'row',
        gap: 8,
        marginTop: -8,
        marginHorizontal: 16,
        padding: 16,
        borderRadius: 18,
        backgroundColor: '#f0eaff',
    },
    bubbleText: {
        flex: 1,
        color: NAVY,
        fontSize: 15,
        lineHeight: 23,
    },
    bold: {
        fontWeight: '800',
    },
});