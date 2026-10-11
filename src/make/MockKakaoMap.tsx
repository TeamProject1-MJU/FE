import { useEffect, useRef, useState } from "react";

type MockKakaoMapProps = {
    mapType: "roadmap" | "hybrid";
    recenterSignal: number;
};

const buildings = [
    [22, 42, 42, 25], [72, 35, 34, 38], [116, 45, 47, 25], [176, 31, 35, 42], [220, 40, 55, 25], [291, 35, 38, 38], [338, 48, 34, 27],
    [18, 91, 55, 30], [88, 88, 30, 46], [127, 95, 47, 25], [188, 91, 48, 34], [249, 86, 34, 42], [299, 94, 62, 28],
    [30, 145, 37, 43], [79, 151, 47, 27], [138, 143, 31, 42], [183, 151, 54, 28], [251, 145, 46, 42], [312, 150, 47, 28],
    [18, 222, 48, 27], [76, 214, 33, 42], [122, 225, 55, 29], [190, 211, 39, 45], [244, 219, 55, 28], [317, 211, 44, 42],
    [26, 277, 35, 39], [72, 282, 49, 27], [136, 275, 42, 44], [193, 280, 54, 29], [263, 271, 38, 43], [315, 280, 53, 28],
    [15, 345, 55, 32], [84, 339, 34, 48], [131, 350, 49, 27], [197, 338, 38, 44], [250, 348, 58, 29], [324, 337, 38, 44],
    [29, 405, 39, 42], [81, 414, 52, 27], [145, 399, 35, 47], [196, 411, 57, 28], [271, 401, 40, 46], [326, 411, 46, 28],
];

const stations = [
    { name: "충정로역", x: 68, y: 174, color: "#00A84D" },
    { name: "서울역", x: 119, y: 286, color: "#0052A4" },
    { name: "시청역", x: 189, y: 218, color: "#00A84D" },
    { name: "을지로입구역", x: 261, y: 205, color: "#00A84D" },
    { name: "명동역", x: 249, y: 309, color: "#00A5DE" },
];

export default function MockKakaoMap({ mapType, recenterSignal }: MockKakaoMapProps) {
    const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const previousDistance = useRef<number | null>(null);

    useEffect(() => {
        setView({ x: 0, y: 0, scale: 1 });
    }, [recenterSignal]);

    return (
        <div
            className={`mock-kakao-map ${mapType}`}
            onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            }}
            onPointerMove={(event) => {
                const previous = pointers.current.get(event.pointerId);
                if (!previous) return;
                pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const points = [...pointers.current.values()];
                if (points.length === 1) {
                    setView((current) => ({ ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y }));
                } else if (points.length === 2) {
                    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
                    if (previousDistance.current) {
                        setView((current) => ({ ...current, scale: Math.min(3, Math.max(1, current.scale * distance / previousDistance.current!)) }));
                    }
                    previousDistance.current = distance;
                }
            }}
            onPointerUp={(event) => {
                pointers.current.delete(event.pointerId);
                if (pointers.current.size < 2) previousDistance.current = null;
            }}
            onPointerCancel={(event) => {
                pointers.current.delete(event.pointerId);
                previousDistance.current = null;
            }}
            onWheel={(event) => setView((current) => ({ ...current, scale: Math.min(3, Math.max(1, current.scale + (event.deltaY < 0 ? .15 : -.15))) }))}
        >
            <svg viewBox="0 0 390 520" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
                <rect width="390" height="520" className="mock-map-ground" />

                <path className="mock-map-water" d="M-20 116 C75 96 126 134 214 112 C286 94 338 105 420 82" />
                <path className="mock-map-park" d="M285 238 h86 v80 h-86z" />
                <path className="mock-map-park" d="M20 365 h82 v74 h-82z" />
                <path className="mock-map-city-zone civic" d="M142 139 h116 v91 h-116z" />
                <path className="mock-map-city-zone station" d="M80 247 h105 v92 h-105z" />

                {buildings.map(([x, y, width, height], index) => <rect className="mock-map-building" x={x} y={y} width={width} height={height} rx="3" key={index} />)}

                <g className="mock-map-roads minor">
                    <path d="M8 78 H382 M8 136 H382 M8 196 H382 M8 258 H382 M8 329 H382 M8 391 H382 M8 459 H382" />
                    <path d="M54 10 V510 M113 10 V510 M171 10 V510 M238 10 V510 M304 10 V510 M365 10 V510" />
                    <path d="M-20 352 L380 60 M22 510 L390 224" />
                </g>

                <g className="mock-map-roads major casing">
                    <path d="M-30 303 C75 280 140 251 221 219 C300 188 352 160 420 121" />
                    <path d="M102 -20 C116 104 131 236 150 550" />
                    <path d="M-20 423 C95 383 211 340 420 308" />
                </g>
                <g className="mock-map-roads major">
                    <path d="M-30 303 C75 280 140 251 221 219 C300 188 352 160 420 121" />
                    <path d="M102 -20 C116 104 131 236 150 550" />
                    <path d="M-20 423 C95 383 211 340 420 308" />
                </g>

                <g className="mock-map-subway">
                    <path className="subway-line line-one" d="M-12 349 L119 286 L189 218 L278 130 L408 54" />
                    <path className="subway-line line-two" d="M42 161 L68 174 L189 218 L261 205 L406 226" />
                    <path className="subway-line line-four" d="M126 -16 L119 286 L249 309 L353 391" />
                </g>

                <g className="mock-map-labels roads">
                    <text x="132" y="264" transform="rotate(-21 132 264)">세종대로</text>
                    <text x="157" y="375" transform="rotate(-8 157 375)">퇴계로</text>
                    <text x="118" y="105" transform="rotate(83 118 105)">통일로</text>
                </g>

                <g className="mock-map-places">
                    <text x="160" y="175">서울특별시청</text>
                    <text x="291" y="270">남산공원</text>
                    <text x="23" y="395">서소문역사공원</text>
                    <text x="207" y="346">명동성당</text>
                    <text x="87" y="323">서울역광장</text>
                    <text x="304" y="294">남산 둘레길</text>
                    <text x="167" y="155">시청광장</text>
                </g>

                {stations.map((station) => (
                    <g className="mock-map-station" transform={`translate(${station.x} ${station.y})`} key={station.name}>
                        <circle r="7" style={{ stroke: station.color }} />
                        <circle r="2.5" style={{ fill: station.color }} />
                        <text x="10" y="4">{station.name}</text>
                    </g>
                ))}

                <g className="mock-map-current" transform="translate(206 252)">
                    <circle className="accuracy" r="20" />
                    <circle className="current-ring" r="9" />
                    <circle className="current-dot" r="5" />
                </g>
            </svg>
        </div>
    );
}
