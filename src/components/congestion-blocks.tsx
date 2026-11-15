import { useMemo } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

type Tone = 'mint' | 'green' | 'yellow' | 'orange' | 'red' | 'off';

// [윗면, 왼쪽 면, 오른쪽 면, 다리, 다리 그늘]
const TONES: Record<Tone, [string, string, string, string, string]> = {
    mint: ['#D2EEE2', '#A3D8C2', '#7FC2A6', '#6AAE92', '#58997E'],
    green: ['#E1EEC2', '#BCD88E', '#9CC06A', '#87AA58', '#739348'],
    yellow: ['#F6E9B8', '#EBCF7E', '#D5B45C', '#C09F4A', '#A8893C'],
    orange: ['#F8D9BC', '#EFB07A', '#DB9058', '#C77C46', '#AE6A39'],
    red: ['#F6C3C6', '#E68D95', '#CF6F79', '#BA5C66', '#A04C56'],
    off: ['#F3F1F5', '#E3E0E7', '#D2CED8', '#C4C0CA', '#B5B1BC'],
};
const LEVEL_TONES: Tone[] = ['off', 'mint', 'green', 'yellow', 'orange', 'red'];
const LEVEL_LABELS = ['혼잡도 미제공', '혼잡도 쾌적', '혼잡도 여유', '혼잡도 보통', '혼잡도 혼잡', '혼잡도 매우 혼잡'];
const BLOCK_COUNT = 5;

function clampLevel(level: number) {
    if (!Number.isFinite(level)) return 0;
    return Math.min(BLOCK_COUNT, Math.max(0, Math.round(level)));
}

function blockUri(tone: Tone, size: number) {
    const [t, l, r, leg, legD] = TONES[tone];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 44" width="${size}" height="${size * 1.1}">
<polygon points="10,31 20,36 20,42 10,37" fill="${leg}"/>
<polygon points="20,36 30,31 30,37 20,42" fill="${legD}"/>
<polygon points="10,25 20,30 20,36 10,31" fill="${l}"/>
<polygon points="20,30 30,25 30,31 20,36" fill="${r}"/>
<polygon points="20,2 34,9 20,16 6,9" fill="${t}"/>
<polygon points="6,9 20,16 20,30 6,23" fill="${l}"/>
<polygon points="20,16 34,9 34,23 20,30" fill="${r}"/>
</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type Props = {
    level?: number;
    size?: number;
};

export default function CongestionBlocks({ level = 0, size = 14 }: Props) {
    const safeLevel = clampLevel(level);
    const uris = useMemo(() => {
        const filled = blockUri(LEVEL_TONES[safeLevel], size);
        const off = safeLevel === 0 ? filled : blockUri('off', size);
        return Array.from({ length: BLOCK_COUNT }, (_, i) => (i < safeLevel ? filled : off));
    }, [safeLevel, size]);

    return (
        <View
            accessible
            accessibilityLabel={LEVEL_LABELS[safeLevel]}
            style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}
        >
            {uris.map((uri, i) => (
                <Image
                    key={i}
                    source={{ uri }}
                    style={{ width: size, height: size * 1.1 }}
                    contentFit="contain"
                    accessible={false}
                />
            ))}
        </View>
    );
}
