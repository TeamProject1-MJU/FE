import { useMemo } from 'react';
import { Image } from 'expo-image';

const LINE_COLORS: Record<string, string> = {
    '1': '#0052A4',
    '2': '#00A84D',
    '3': '#EF7C1C',
    '4': '#00A5DE',
    '5': '#996CAC',
    '6': '#CD7C2F',
    '7': '#747F00',
    '8': '#E6186C',
};
const FALLBACK_COLOR = '#B89BC7';

type Props = {
    line?: string | number;
    size?: number;
    /** 지붕 색을 직접 정해요. 넘기면 line 색보다 우선해요. (#210) */
    color?: string;
};

export default function TrainBlock({ line = 2, size = 48, color: roofColor }: Props) {
    const color = roofColor ?? LINE_COLORS[String(line).trim()] ?? FALLBACK_COLOR;
    const height = (size * 40) / 48;
    const uri = useMemo(() => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40" width="${size}" height="${height}">
<ellipse cx="23" cy="35.5" rx="19" ry="4" fill="#2A1F3A" opacity="0.08"/>
<polygon points="5.6,10 31.6,25 31.6,37 5.6,22" fill="#FFFFFF"/>
<polygon points="5.6,20 31.6,35 31.6,37 5.6,22" fill="#D9D4E1"/>
<polygon points="31.6,25 42,19 42,31 31.6,37" fill="#EAE6F0"/>
<polygon points="31.6,35 42,29 42,31 31.6,37" fill="#CBC5D5"/>
<polygon points="16,4 42,19 31.6,25 5.6,10" fill="${color}"/>
<polygon points="17.6,6.6 37.4,18 31.5,21.4 11.7,10" fill="#FFFFFF" opacity="0.26"/>
<polygon points="5.6,10 31.6,25 31.6,27 5.6,12" fill="${color}" opacity="0.6"/>
<polygon points="8.2,14.5 13.4,17.5 13.4,21.3 8.2,18.3" fill="#CDD5EC"/>
<polygon points="16,19 21.2,22 21.2,25.8 16,22.8" fill="#CDD5EC"/>
<polygon points="23.8,23.5 29,26.5 29,30.3 23.8,27.3" fill="#CDD5EC"/>
<polygon points="34.2,26.5 39.4,23.5 39.4,27.3 34.2,30.3" fill="#C3CBE4"/>
<polyline points="5.6,10 31.6,25 42,19" fill="none" stroke="#FFFFFF" stroke-width="0.6" opacity="0.7"/>
</svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }, [color, size, height]);

    return (
        <Image
            source={{ uri }}
            style={{ width: size, height }}
            contentFit="contain"
            accessible={false}
        />
    );
}
