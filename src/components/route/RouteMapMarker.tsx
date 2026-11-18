import { Image } from 'expo-image';
import { ROUTE_MARKER_ICONS, type RouteMarkerKind } from '@/components/map/route-marker-icons';

/** 범례와 예시 지도에서도 실제 지도와 같은 SVG를 써요. 글자 설명은 부모가 제공해요. */
export default function RouteMapMarker({ kind, size }: { kind: RouteMarkerKind; size?: number }) {
    const icon = ROUTE_MARKER_ICONS[kind];
    const width = size ?? icon.width;
    return <Image source={{ uri: icon.uri }} style={{ width, height: width * icon.height / icon.width }}
        contentFit="contain" accessible={false} />;
}
