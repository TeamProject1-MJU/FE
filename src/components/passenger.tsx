import { useMemo } from 'react';
import { Image } from 'expo-image';

export type PassengerTone = 'me' | 'other' | 'pink' | 'sky' | 'mint' | 'green' | 'yellow' | 'orange' | 'red' | 'off';

// [윗면, 왼쪽 면, 오른쪽 면, 다리, 다리 그늘]
const TONES: Record<PassengerTone, [string, string, string, string, string]> = {
    me: ['#BCA6D2', '#8466A6', '#5C3F78', '#4A3263', '#382549'],
    other: ['#F5F4F7', '#DEDBE3', '#C4C0CB', '#A9A5B1', '#908C99'],
    pink: ['#F8D7DA', '#EDB0B6', '#D9939A', '#C27A82', '#A9656D'],
    sky: ['#D5E6F4', '#A9CBE6', '#85AFD2', '#6E97BC', '#5A80A5'],
    mint: ['#D2EEE2', '#A3D8C2', '#7FC2A6', '#6AAE92', '#58997E'],
    green: ['#E1EEC2', '#BCD88E', '#9CC06A', '#87AA58', '#739348'],
    yellow: ['#F6E9B8', '#EBCF7E', '#D5B45C', '#C09F4A', '#A8893C'],
    orange: ['#F8D9BC', '#EFB07A', '#DB9058', '#C77C46', '#AE6A39'],
    red: ['#F6C3C6', '#E68D95', '#CF6F79', '#BA5C66', '#A04C56'],
    off: ['#F3F1F5', '#E3E0E7', '#D2CED8', '#C4C0CA', '#B5B1BC'],
};

type Props = {
    tone?: PassengerTone;
    size?: number;
    eyes?: boolean;
    shadow?: boolean;
};

export default function Passenger({ tone = 'me', size = 40, eyes = true, shadow = true }: Props) {
    const uri = useMemo(() => {
        const [t, l, r, leg, legD] = TONES[tone];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 44" width="${size}" height="${size * 1.1}">
${shadow ? '<ellipse cx="20" cy="41.5" rx="12" ry="3" fill="#2A1F3A" opacity="0.10"/>' : ''}
<polygon points="10,31 20,36 20,42 10,37" fill="${leg}"/>
<polygon points="20,36 30,31 30,37 20,42" fill="${legD}"/>
<polygon points="10,25 20,30 20,36 10,31" fill="${l}"/>
<polygon points="20,30 30,25 30,31 20,36" fill="${r}"/>
<polygon points="20,2 34,9 20,16 6,9" fill="${t}"/>
<polygon points="6,9 20,16 20,30 6,23" fill="${l}"/>
<polygon points="20,16 34,9 34,23 20,30" fill="${r}"/>
<polyline points="6,9 20,16 34,9" fill="none" stroke="#FFFFFF" stroke-width="0.7" opacity="0.45"/>
${eyes ? '<polygon points="10,16.5 12.2,17.6 12.2,20.8 10,19.7" fill="#1F1828"/><polygon points="15.2,19.1 17.4,20.2 17.4,23.4 15.2,22.3" fill="#1F1828"/>' : ''}
</svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }, [tone, size, eyes, shadow]);

    return (
        <Image
            source={{ uri }}
            style={{ width: size, height: size * 1.1 }}
            contentFit="contain"
            accessible={false}
        />
    );
}
