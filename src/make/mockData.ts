export type User = {
    id: string;
    name: string;
};

export type Station = {
    id: string;
    name: string;
    lines: number[];
};

export type Participant = {
    id: string;
    name: string;
    startStation: Station | null;
};

export type Meeting = {
    id: string;
    title: string;
    datetime: string;
    roomCode: string;
    confirmedStation: Station | null;
    participants: Participant[];
};

export type Notification = {
    id: string;
    message: string;
    createdAt: string;
    isRead: boolean;
};

export type DataMode = "loading" | "empty" | "success" | "error";
export type CameraPermission = "granted" | "denied" | "notDetermined";

export type SubwayLine = {
    id: number;
    color: string;
    path: string[];
};

export type SubwayStation = Station & {
    x: number;
    y: number;
    isTransfer: boolean;
};

const stationA: Station = { id: "station-a", name: "건대입구", lines: [2, 7] };
const stationB: Station = { id: "station-b", name: "홍대입구", lines: [2] };
const stationC: Station = { id: "station-c", name: "잠실", lines: [2, 8] };
const stationD: Station = { id: "station-d", name: "노원", lines: [4, 7] };
const stationE: Station = { id: "station-e", name: "신림", lines: [2] };

export const mockData = {
    user: { id: "user-1", name: "민지" } satisfies User,
    stations: [stationA, stationB, stationC, stationD, stationE] satisfies Station[],
    meetings: [
        {
            id: "meeting-1",
            title: "기말 끝 파티",
            datetime: "2026-10-18T18:00:00+09:00",
            roomCode: "LR4821",
            confirmedStation: stationA,
            participants: [
                { id: "participant-1", name: "민지", startStation: stationB },
                { id: "participant-2", name: "준호", startStation: stationC },
                { id: "participant-3", name: "서연", startStation: stationD },
                { id: "participant-4", name: "지우", startStation: stationE },
            ],
        },
    ] satisfies Meeting[],
    notifications: [
        { id: "notification-1", message: "참여자가 출발역을 입력했어요", createdAt: "방금 전", isRead: false },
        { id: "notification-2", message: "약속 장소가 확정됐어요", createdAt: "1시간 전", isRead: true },
    ] satisfies Notification[],
    routePreview: {
        from: stationB,
        to: stationC,
        minutes: 36,
        arrival: "19:06",
    },
    mapLines: [
        { id: 1, color: "#0052A4", path: ["guro", "sindorim", "yeongdeungpo", "seoul", "cityhall", "jonggak", "jongno3", "dongmyo"] },
        { id: 2, color: "#00A84D", path: ["hapjeong", "hongdae", "cityhall", "dongdaemun", "wangsimni", "jamsil", "gangnam", "gyodae", "sadang", "daerim", "sindorim"] },
        { id: 3, color: "#EF7C1C", path: ["gupabal", "yeonsinnae", "jongno3", "yaksu", "apgujeong", "gyodae", "express", "suseo"] },
        { id: 4, color: "#00A5DE", path: ["nowon", "hyehwa", "dongdaemun", "seoul", "samgakji", "sadang"] },
        { id: 5, color: "#996CAC", path: ["banghwa", "hapjeong", "yeouido", "jongno3", "dongdaemun", "wangsimni", "gunja", "cheonho"] },
        { id: 6, color: "#CD7C2F", path: ["eungam", "hapjeong", "gongdeok", "samgakji", "yaksu", "cheonggu"] },
        { id: 7, color: "#747F00", path: ["nowon", "gunja", "express", "daerim", "gasan"] },
        { id: 8, color: "#E6186C", path: ["amsa", "cheonho", "jamsil", "seokchon", "moran"] },
    ] satisfies SubwayLine[],
    mapStations: [
        { id: "guro", name: "구로", lines: [1], x: 30, y: 185, isTransfer: false },
        { id: "sindorim", name: "신도림", lines: [1, 2], x: 60, y: 185, isTransfer: true },
        { id: "yeongdeungpo", name: "영등포", lines: [1], x: 95, y: 185, isTransfer: false },
        { id: "seoul", name: "서울역", lines: [1, 4], x: 150, y: 185, isTransfer: true },
        { id: "cityhall", name: "시청", lines: [1, 2], x: 185, y: 185, isTransfer: true },
        { id: "jonggak", name: "종각", lines: [1], x: 215, y: 185, isTransfer: false },
        { id: "jongno3", name: "종로3가", lines: [1, 3, 5], x: 245, y: 185, isTransfer: true },
        { id: "dongmyo", name: "동묘앞", lines: [1], x: 300, y: 185, isTransfer: false },
        { id: "hapjeong", name: "합정", lines: [2, 6], x: 65, y: 105, isTransfer: true },
        { id: "hongdae", name: "홍대입구", lines: [2], x: 105, y: 75, isTransfer: false },
        { id: "dongdaemun", name: "동대문역사문화공원", lines: [2, 4, 5], x: 275, y: 125, isTransfer: true },
        { id: "wangsimni", name: "왕십리", lines: [2, 5], x: 315, y: 155, isTransfer: true },
        { id: "jamsil", name: "잠실", lines: [2, 8], x: 335, y: 225, isTransfer: true },
        { id: "gangnam", name: "강남", lines: [2], x: 275, y: 275, isTransfer: false },
        { id: "gyodae", name: "교대", lines: [2, 3], x: 230, y: 275, isTransfer: true },
        { id: "sadang", name: "사당", lines: [2, 4], x: 150, y: 275, isTransfer: true },
        { id: "daerim", name: "대림", lines: [2, 7], x: 80, y: 245, isTransfer: true },
        { id: "gupabal", name: "구파발", lines: [3], x: 80, y: 25, isTransfer: false },
        { id: "yeonsinnae", name: "연신내", lines: [3], x: 120, y: 65, isTransfer: false },
        { id: "yaksu", name: "약수", lines: [3, 6], x: 275, y: 215, isTransfer: true },
        { id: "apgujeong", name: "압구정", lines: [3], x: 275, y: 245, isTransfer: false },
        { id: "express", name: "고속터미널", lines: [3, 7, 8], x: 230, y: 305, isTransfer: true },
        { id: "suseo", name: "수서", lines: [3], x: 335, y: 305, isTransfer: false },
        { id: "nowon", name: "노원", lines: [4, 7], x: 150, y: 25, isTransfer: true },
        { id: "hyehwa", name: "혜화", lines: [4], x: 205, y: 95, isTransfer: false },
        { id: "samgakji", name: "삼각지", lines: [4, 6], x: 150, y: 225, isTransfer: true },
        { id: "banghwa", name: "방화", lines: [5], x: 20, y: 75, isTransfer: false },
        { id: "yeouido", name: "여의도", lines: [5], x: 110, y: 145, isTransfer: false },
        { id: "gunja", name: "군자", lines: [5, 7], x: 325, y: 95, isTransfer: true },
        { id: "cheonho", name: "천호", lines: [5, 8], x: 350, y: 175, isTransfer: true },
        { id: "eungam", name: "응암", lines: [6], x: 25, y: 125, isTransfer: false },
        { id: "gongdeok", name: "공덕", lines: [6], x: 115, y: 205, isTransfer: false },
        { id: "cheonggu", name: "청구", lines: [6], x: 305, y: 225, isTransfer: false },
        { id: "gasan", name: "가산디지털단지", lines: [7], x: 30, y: 285, isTransfer: false },
        { id: "amsa", name: "암사", lines: [8], x: 350, y: 125, isTransfer: false },
        { id: "seokchon", name: "석촌", lines: [8], x: 335, y: 255, isTransfer: false },
        { id: "moran", name: "모란", lines: [8], x: 335, y: 330, isTransfer: false },
    ] satisfies SubwayStation[],
};
