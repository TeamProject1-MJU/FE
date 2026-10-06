import { StyleSheet, Text, View } from 'react-native';

export const LinkRoColors = {
    navy: '#0f1c3f',
    mint: '#2bcf9a',
} as const;

type Props = {
    /** 로고 글자 크기 (기본 31, 스플래시는 56) */
    size?: number;
    /** 글자 색 (기본 navy, 어두운 배경에서는 white) */
    color?: string;
    /** 첫 번째 바 색 (기본 글자 색과 동일) */
    barColor?: string;
    /** 두 번째 바 색 (기본 mint) */
    accentColor?: string;
};

/**
 * LinkRo 워드마크 로고.
 * "Link"(800) + "Ro"(500) 아래에 두 줄의 바(기본색 / 민트)가 깔립니다.
 */
export default function LinkRoLogo({
                                       size = 31,
                                       color = LinkRoColors.navy,
                                       barColor,
                                       accentColor = LinkRoColors.mint,
                                   }: Props) {
    const barHeight = Math.max(3, Math.round(size / 9));
    const barGap = Math.max(3, Math.round(size / 8));

    return (
        <View style={styles.logo} accessibilityLabel="LinkRo">
            <Text
                style={[
                    styles.word,
                    {
                        color,
                        fontSize: size,
                        lineHeight: size,
                        letterSpacing: -size * 0.045,
                    },
                ]}
            >
                <Text style={styles.strong}>Link</Text>
                <Text style={styles.light}>Ro</Text>
            </Text>

            <View style={[styles.bars, { gap: barGap, marginTop: barGap }]}>
                <View
                    style={[
                        styles.bar,
                        { height: barHeight, backgroundColor: barColor ?? color },
                    ]}
                />
                <View
                    style={[
                        styles.bar,
                        { height: barHeight, backgroundColor: accentColor },
                    ]}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    logo: {
        alignItems: 'stretch',
    },

    word: {
        textAlign: 'center',
    },

    strong: {
        fontWeight: '800',
    },

    light: {
        fontWeight: '500',
    },

    bars: {
        flexDirection: 'row',
    },

    bar: {
        flex: 1,
        borderRadius: 999,
    },
});
