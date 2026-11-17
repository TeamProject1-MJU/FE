import { ROUTE_MARKER_ICONS, type RouteMarkerKind } from '@/components/map/route-marker-icons';

export const PREVIEW_LABEL_FONT_SIZE = 11;
export const PREVIEW_LABEL_LINE_HEIGHT = 14;

type Rect = { left: number; top: number; width: number; height: number };
type PreviewPoint = {
    name: string;
    kind: RouteMarkerKind;
    x: number;
    y: number;
    marker: Rect;
    label: Rect & { text: string };
};

/** 글자 폭에 여유를 두고 줄바꿈해 실제 글꼴에서도 이름이 잘리지 않게 해요. */
function wrapName(name: string, width: number, scale: number) {
    const lines: string[] = [];
    let line = ''; let used = 0;
    for (const character of Array.from(name)) {
        const advance = (character.codePointAt(0)! > 0xffff ? 2 : 1) * (PREVIEW_LABEL_FONT_SIZE + 0.5) * scale;
        if (line && used + advance > width) { lines.push(line); line = ''; used = 0; }
        line += character; used += advance;
    }
    if (line) lines.push(line);
    // 짧은 마지막 줄에 글자가 몰리지 않도록, 폭 안에서 앞줄의 끝 글자를 나눠요.
    const measure = (value: string) => Array.from(value).reduce((sum, character) =>
        sum + (character.codePointAt(0)! > 0xffff ? 2 : 1) * (PREVIEW_LABEL_FONT_SIZE + 0.5) * scale, 0);
    for (let i = lines.length - 1; i > 0; i--) {
        const previous = Array.from(lines[i - 1]);
        while (previous.length > 1) {
            const last = previous[previous.length - 1];
            if (measure(previous.join('')) - measure(lines[i]) <= measure(last) + 0.01
                || measure(last + lines[i]) > width) break;
            previous.pop(); lines[i] = last + lines[i];
        }
        lines[i - 1] = previous.join('');
    }
    return lines;
}

/**
 * 예시 지도 전용 배치예요. 실제 지도 좌표나 서버 경로는 바꾸지 않아요.
 * 이름표와 아이콘은 각자 셀 안에 두고, 한 행에 다 들어가지 않으면 다음 행으로 이어요.
 * 긴 이름과 큰 글꼴은 잘라내지 않고 줄 수와 행 높이에 반영해요.
 */
export function layoutRouteMapPreview(names: string[], width: number, fontScale = 1): { height: number; points: PreviewPoint[] } {
    if (!Number.isFinite(width) || width <= 0 || !names.length) return { height: 150, points: [] };
    const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
    const padding = Math.min(12, width / 8);
    const available = width - padding * 2;
    const gap = 8;
    const columns = Math.max(1, Math.min(names.length, Math.floor((available + gap) / (Math.max(72, 60 * scale + 10) + gap))));
    const cellWidth = (available - gap * (columns - 1)) / columns;
    const labelWidth = Math.min(cellWidth, 104 * scale);
    const prepared = names.map((name, index) => {
        // 지도에서는 원래 역명을 쓰고, '서울역' 같은 고유 이름도 그대로 지켜요.
        const fullName = name.trim();
        const kind: RouteMarkerKind = index === names.length - 1 ? 'destination' : index === 0 ? 'origin' : 'transfer';
        const icon = ROUTE_MARKER_ICONS[kind];
        const factor = Math.min(1, cellWidth / icon.width);
        const lines = wrapName(fullName, Math.max(1, labelWidth - 10), scale);
        return { name: fullName, kind, icon, width: icon.width * factor, height: icon.height * factor,
            labelText: lines.join('\n'), labelHeight: lines.length ? lines.length * PREVIEW_LABEL_LINE_HEIGHT * scale + 4 : 0 };
    });
    const points: PreviewPoint[] = [];
    let rowTop = padding;
    for (let start = 0; start < prepared.length; start += columns) {
        const row = prepared.slice(start, start + columns);
        const maxLabelHeight = Math.max(...row.map(item => item.labelHeight));
        const maxMarkerHeight = Math.max(...row.map(item => item.height));
        const reverse = Math.floor(start / columns) % 2 === 1;
        row.forEach((item, index) => {
            const column = reverse ? columns - 1 - index : index;
            const cellLeft = padding + column * (cellWidth + gap);
            const marker = { left: cellLeft + (cellWidth - item.width) / 2,
                top: rowTop + maxLabelHeight + 6 + (index % 2 === 0 ? 18 : 0), width: item.width, height: item.height };
            points.push({ name: item.name, kind: item.kind, marker,
                x: marker.left + marker.width * item.icon.xAnchor,
                y: marker.top + marker.height * item.icon.yAnchor,
                label: { left: cellLeft + (cellWidth - labelWidth) / 2, top: marker.top - 6 - item.labelHeight,
                    width: labelWidth, height: item.labelHeight, text: item.labelText } });
        });
        rowTop += maxLabelHeight + 6 + 18 + maxMarkerHeight + 16;
    }
    // 오른쪽 아래 '지도 미리보기' 안내 영역을 비워 둬요.
    return { height: Math.max(150, rowTop + 24), points };
}
