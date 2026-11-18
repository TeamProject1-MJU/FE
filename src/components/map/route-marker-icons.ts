/** 경로 지도·범례·예시 모드에서 함께 쓰는 아이콘이에요. 외곽 흰 테두리는 없어요. */
export type RouteMarkerKind = 'origin' | 'transfer' | 'destination';

type RouteMarkerIcon = {
    uri: string;
    width: number;
    height: number;
    /** SVG의 캐릭터 발밑·깃대 아래·환승 원 중심을 좌표에 맞추는 비율이에요. */
    xAnchor: number;
    yAnchor: number;
    label: string;
};

function icon(body: string, viewWidth: number, viewHeight: number, width: number,
    xAnchor: number, yAnchor: number, label: string): RouteMarkerIcon {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" width="${width}" height="${width * viewHeight / viewWidth}">${body}</svg>`;
    return { uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, width, height: width * viewHeight / viewWidth, xAnchor, yAnchor, label };
}

export const ROUTE_MARKER_ICONS: Record<RouteMarkerKind, RouteMarkerIcon> = {
    // 기존 Passenger의 보라색 팔레트와 블록 형태를 유지해요.
    origin: icon(`
<ellipse cx="20" cy="41" rx="12" ry="2.5" fill="#2A1F3A" opacity="0.10"/>
<polygon points="10,31 20,36 20,42 10,37" fill="#4A3263"/>
<polygon points="20,36 30,31 30,37 20,42" fill="#382549"/>
<polygon points="10,25 20,30 20,36 10,31" fill="#8466A6"/>
<polygon points="20,30 30,25 30,31 20,36" fill="#5C3F78"/>
<polygon points="20,2 34,9 20,16 6,9" fill="#BCA6D2"/>
<polygon points="6,9 20,16 20,30 6,23" fill="#8466A6"/>
<polygon points="20,16 34,9 34,23 20,30" fill="#5C3F78"/>
<polygon points="10,16.5 12.2,17.6 12.2,20.8 10,19.7" fill="#1F1828"/>
<polygon points="15.2,19.1 17.4,20.2 17.4,23.4 15.2,22.3" fill="#1F1828"/>`, 40, 44, 32, 0.5, 42 / 44, '출발'),
    transfer: icon(`
<circle cx="12" cy="12" r="12" fill="#5C3F78"/>
<path d="M6 8H18M14.5 4.5L18 8L14.5 11.5M18 16H6M9.5 12.5L6 16L9.5 19.5" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`, 24, 24, 24, 0.5, 0.5, '환승'),
    destination: icon(`
<ellipse cx="13" cy="41" rx="11" ry="2.5" fill="#4A3263" opacity="0.10"/>
<polygon points="9,6 13,4 17,6 13,8" fill="#BCA6D2"/>
<polygon points="9,6 13,8 13,42 9,40" fill="#8466A6"/>
<polygon points="13,8 17,6 17,40 13,42" fill="#4A3263"/>
<polygon points="12,11 31,3 36,6 17,14" fill="#BCA6D2"/>
<polygon points="12,11 17,14 17,32 12,29" fill="#8466A6"/>
<polygon points="17,14 36,6 36,24 17,32" fill="#5C3F78"/>`, 40, 44, 32, 13 / 40, 42 / 44, '도착'),
};

export function isRouteMarkerKind(value: unknown): value is RouteMarkerKind {
    return value === 'origin' || value === 'transfer' || value === 'destination';
}
