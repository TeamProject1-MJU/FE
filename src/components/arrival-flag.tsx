import { Image } from 'expo-image';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 30">
<ellipse cx="13" cy="27" rx="10" ry="2.5" fill="#4A3263" opacity="0.10"/>
<path d="M7 26V5" stroke="#4A3263" stroke-width="2.5" stroke-linecap="round"/>
<polygon points="7,5 15,2 25,7 17,10" fill="#BCA6D2"/>
<polygon points="7,5 17,10 17,19 7,14" fill="#8466A6"/>
<polygon points="17,10 25,7 25,16 17,19" fill="#5C3F78"/>
</svg>`;
const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export default function ArrivalFlag({ size = 24 }: { size?: number }) {
    return <Image source={{ uri }} style={{ width: size, height: size * 30 / 28 }} contentFit="contain" accessible={false} />;
}
