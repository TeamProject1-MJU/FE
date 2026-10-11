'use dom';

import './index.css';
import { useEffect, useRef, useState, type ReactNode } from "react";
import { mockData, type CameraPermission, type DataMode, type Meeting, type Notification, type Station, type User } from "./mockData";
import { createRoom, fetchActiveMeetings, fetchNotifications, fetchUser, joinRoom, requestCameraPermission } from "./services";
import MockKakaoMap from "./MockKakaoMap";

type ScreenId = "splash" | "onboarding" | "permission" | "login" | "home" | "station-search" | "route" | "direction" | "midpoint" | "results" | "room" | "meeting-list" | "join" | "notifications" | "my";
type JourneyInfo = { from: string; to: string; minutes: number; arrival: string };

// DEV only: set to false to restore the original automatic Splash transition.
const DEV_HOLD_SPLASH = false;

type IconProps = {
    children: string;
    size?: "sm" | "md" | "lg";
    filled?: boolean;
};

function Icon({ children, size = "md", filled = false }: IconProps) {
    return (
        <span
            className={`material-symbols-rounded icon icon-${size}${filled ? " icon-filled" : ""}`}
            aria-hidden="true"
        >
      {children}
    </span>
    );
}

function Button({
                    children,
                    variant = "primary",
                    disabled = false,
                    state = "default",
                    onClick,
                    className = "",
                }: {
    children: ReactNode;
    variant?: "primary" | "secondary" | "ghost" | "text";
    disabled?: boolean;
    state?: "default" | "pressed" | "disabled";
    onClick?: () => void;
    className?: string;
}) {
    const isDisabled = disabled || state === "disabled";
    return <button className={`ds-button ${variant} ${state} ${className}`} disabled={isDisabled} onClick={onClick}>{children}</button>;
}

function LabelChip({ type }: { type: "solo" | "together" | "ai" }) {
    const labels = { solo: "혼자 이동", together: "함께 만나기", ai: "AI 방향 안내" };
    return <span className={`feature-label ${type}`}>{type === "ai" && <Icon size="sm">auto_awesome</Icon>}{labels[type]}</span>;
}

function Avatar({ name, color = 0 }: { name: string; color?: number }) {
    return <i className={`data-avatar avatar-color-${(color % 4) + 1}`}>{name.slice(0, 1)}</i>;
}

function FeatureTile({
                         icon,
                         label,
                         tone,
                         showAiChip = false,
                         onClick,
                     }: {
    icon: string;
    label: string;
    tone: "navy" | "mint" | "gray";
    showAiChip?: boolean;
    onClick: () => void;
}) {
    return (
        <button className={`home-tile feature-tile ${tone}`} onClick={onClick}>
            <span className="feature-tile-icon"><Icon>{icon}</Icon></span>
            <div><strong>{label}</strong>{showAiChip && <AiChip />}</div>
            <Icon size="sm">arrow_forward</Icon>
        </button>
    );
}

function EmptyState({ icon, message, actionLabel, onAction }: { icon: string; message: string; actionLabel: string; onAction: () => void }) {
    return <div className="empty-state-component"><Icon>{icon}</Icon><strong>{message}</strong><Button variant="secondary" onClick={onAction}>{actionLabel}</Button></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return <div className="error-state-component"><Icon>error</Icon><strong>{message}</strong><Button variant="text" onClick={onRetry}>다시 시도</Button></div>;
}

function Chip({
                  children,
                  selected = false,
                  onClick,
              }: {
    children: ReactNode;
    selected?: boolean;
    onClick?: () => void;
}) {
    return <button className={`ds-chip${selected ? " selected" : ""}`} onClick={onClick}>{children}</button>;
}

function BottomSheet({
                         children,
                         onClose,
                         className = "",
                         title,
                     }: {
    children: ReactNode;
    onClose: () => void;
    className?: string;
    title?: string;
}) {
    return (
        <div className="route-sheet-backdrop" onClick={onClose}>
            <div className={`route-bottom-sheet ${className}`} onClick={(event) => event.stopPropagation()}>
                <div className="sheet-handle" />
                {title && <div className="bottom-sheet-title">{title}</div>}
                {children}
            </div>
        </div>
    );
}

function Toast({ children }: { children: ReactNode }) {
    return <div className="app-toast"><Icon filled>check_circle</Icon>{children}</div>;
}

function LoadingOverlay({ text }: { text: string }) {
    return (
        <div className="loading-overlay">
            <div className="loading-spinner"><i /><i /><i /></div>
            <strong>{text}</strong>
            <span>각 출발역의 이동시간과 환승을 비교해요</span>
        </div>
    );
}

function Logo({ compact = false }: { compact?: boolean }) {
    return (
        <div className={`logo${compact ? " logo-compact" : ""}`} aria-label="LinkRo">
            <div className="logo-word">
                <strong>Link</strong>
                <span>Ro</span>
            </div>
            <div className="logo-bars">
                <i />
                <i />
            </div>
        </div>
    );
}

function StatusBar() {
    return (
        <div className="status-bar">
            <strong>9:41</strong>
            <div className="status-icons">
                <Icon size="sm">signal_cellular_alt</Icon>
                <Icon size="sm">wifi</Icon>
                <Icon size="sm">battery_full</Icon>
            </div>
        </div>
    );
}

const navItems = [
    ["home", "홈"],
    ["route", "경로"],
    ["forum", "약속방"],
    ["person", "마이"],
];

function TabBar({
                    active = "홈",
                    onNavigate,
                }: {
    active?: string;
    onNavigate?: (screen: ScreenId) => void;
}) {
    const destinations: Record<string, ScreenId> = { 홈: "home", 경로: "route", 약속방: "meeting-list", 마이: "my" };
    return (
        <div className="bottom-nav">
            {navItems.map(([icon, label]) => (
                <button
                    className={`nav-item${label === active ? " active" : ""}`}
                    key={label}
                    onClick={() => onNavigate?.(destinations[label])}
                >
                    <Icon filled={label === active}>{icon}</Icon>
                    <span>{label}</span>
                </button>
            ))}
        </div>
    );
}

function Phone({
                   children,
                   nav,
                   hideNav = false,
                   onNavigate,
               }: {
    children: ReactNode;
    nav?: string;
    hideNav?: boolean;
    onNavigate?: (screen: ScreenId) => void;
}) {
    return (
        <div className="phone">
            <StatusBar />
            <div className={`phone-content${hideNav ? " no-nav" : ""}`}>{children}</div>
            {!hideNav && <TabBar active={nav} onNavigate={onNavigate} />}
            <div className="home-indicator" />
        </div>
    );
}

const lineColors: Record<number, string> = {
    1: "line-1",
    2: "line-2",
    3: "line-3",
    4: "line-4",
    5: "line-5",
    6: "line-6",
    7: "line-7",
    8: "line-8",
};

function LineBadge({ line, small = false, size = "md" }: { line: number; small?: boolean; size?: "sm" | "md" }) {
    return <span className={`line-badge ${lineColors[line]}${small || size === "sm" ? " small" : ""}`}>{line}</span>;
}

type CrowdLevel = "여유" | "보통" | "혼잡" | "매우 혼잡";

const crowdClasses: Record<CrowdLevel, string> = {
    여유: "crowd-free",
    보통: "crowd-normal",
    혼잡: "crowd-busy",
    "매우 혼잡": "crowd-full",
};

const crowdBars: Record<CrowdLevel, number> = {
    여유: 1,
    보통: 2,
    혼잡: 3,
    "매우 혼잡": 4,
};

function Congestion({ level, compact = false }: { level: CrowdLevel; compact?: boolean }) {
    const active = crowdBars[level];
    return (
        <div className={`congestion ${crowdClasses[level]}${compact ? " compact" : ""}`}>
            <div className="crowd-bars" aria-hidden="true">
                {[1, 2, 3, 4].map((bar) => (
                    <i className={bar <= active ? "on" : ""} key={bar} />
                ))}
            </div>
            <strong>{level}</strong>
        </div>
    );
}

function Header({
                    title,
                    back = false,
                    action,
                    onBack,
                }: {
    title: string;
    back?: boolean;
    action?: ReactNode;
    onBack?: () => void;
}) {
    return (
        <div className="page-header">
            <div className="header-side">
                {back ? <button className="back-button" onClick={onBack} aria-label="이전 화면"><Icon>arrow_back_ios_new</Icon></button> : null}
            </div>
            <div className="page-title">{title}</div>
            <div className="header-side end">{action}</div>
        </div>
    );
}

function SplashScreen({ onDone }: { onDone: () => void }) {
    useEffect(() => {
        void fetchUser();
        if (DEV_HOLD_SPLASH) return;

        const timer = window.setTimeout(onDone, 1500);
        return () => window.clearTimeout(timer);
    }, [onDone]);

    return (
        <Phone hideNav>
            <div className="splash-screen">
                {DEV_HOLD_SPLASH && <button className="splash-dev-button" onClick={onDone}>DEV · 다음 화면</button>}
                <svg className="splash-artwork" viewBox="0 0 354 797" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                    <g className="splash-artwork-route splash-artwork-route-mint">
                        <path d="M-30 182 L221 264" />
                        <circle cx="83" cy="219" r="5" />
                        <circle cx="176" cy="249" r="5" />
                        <text x="92" y="238">서울역</text>
                    </g>
                    <g className="splash-artwork-route splash-artwork-route-blue">
                        <path d="M388 486 L157 589" />
                        <circle cx="300" cy="525" r="5" />
                        <text x="269" y="547">시청</text>
                    </g>
                    <g className="splash-artwork-rails">
                        <path d="M-45 672 Q177 610 399 672" />
                        <path d="M-25 686 Q177 632 379 686" />
                        <path d="M-5 700 Q177 655 359 700" />
                    </g>
                    <g className="splash-artwork-skyline">
                        <path d="M17 797 V753 H48 V797 M55 797 V724 H96 V797 M103 797 V740 H132 V797 M139 797 V719 L158 701 V683 H174 V701 L193 719 V797 M200 797 V731 H236 V797 M243 797 V715 H286 V797 M293 797 V746 H325 V797" />
                    </g>
                </svg>
                <div className="splash-symbol" aria-hidden="true">
                    <svg className="splash-train" viewBox="0 0 28 32">
                        <path d="M6 3.5h16a3 3 0 0 1 3 3v15a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-15a3 3 0 0 1 3-3Z" />
                        <path d="M7 7.5h14v8H7z" className="splash-train-window" />
                        <path d="M4 19h20" className="splash-train-accent" />
                        <circle cx="8" cy="22.5" r="1.5" className="splash-train-wheel" />
                        <circle cx="20" cy="22.5" r="1.5" className="splash-train-wheel" />
                        <path d="m8 26-4 4m16-4 4 4" />
                    </svg>
                </div>
                <Logo compact />
                <p>지하철을 더 가깝게, 함께.</p>
            </div>
        </Phone>
    );
}

function PageIndicator({ total, current }: { total: number; current: number }) {
    return <div className="page-indicator">{Array.from({ length: total }, (_, index) => <i className={index === current ? "active" : ""} key={index} />)}</div>;
}

function OnboardingIllustration({ page }: { page: number }) {
    const labels = ["혼잡도 기반 경로 추천", "AI 표지판 방향 안내", "공평한 중간역 추천", "약속방과 AI 출발 알림"];

    return (
        <svg className={`onboarding-art onboarding-art-${page}`} viewBox="0 0 354 345" role="img" aria-label={labels[page]}>
            {page === 0 && <>
                <defs>
                    <filter id="onboarding-card-shadow" x="-20%" y="-20%" width="140%" height="150%">
                        <feDropShadow dx="0" dy="9" stdDeviation="9" floodColor="#293b5f" floodOpacity=".12" />
                    </filter>
                </defs>

                <path className="ob-illustration-blob ob-illustration-blob-mint" d="M235 15 C319 2 370 49 351 117 C336 169 285 143 249 113 C214 84 182 24 235 15Z" />
                <path className="ob-illustration-blob ob-illustration-blob-blue" d="M-21 205 C20 164 72 186 92 237 C111 287 53 338 -5 315Z" />
                <path className="ob-map-decoration" d="M-30 79 C48 27 99 88 158 52 S271 26 384 78" />
                <path className="ob-map-decoration ob-map-decoration-bottom" d="M-18 303 C59 252 111 313 185 281 S294 247 377 282" />
                <circle className="ob-map-dot" cx="34" cy="58" r="4" />
                <circle className="ob-map-dot" cx="316" cy="56" r="4" />
                <circle className="ob-map-dot" cx="329" cy="298" r="4" />

                <g className="ob-back-card ob-back-card-left" transform="rotate(-6 99 157)">
                    <rect x="24" y="84" width="150" height="146" rx="23" />
                    <circle cx="49" cy="111" r="8" />
                    <path d="M66 108 H137 M66 119 H111" />
                    <path className="ob-back-route" d="M47 158 H148" />
                    <circle className="ob-back-node" cx="47" cy="158" r="5" />
                    <circle className="ob-back-node" cx="148" cy="158" r="5" />
                </g>
                <g className="ob-back-card ob-back-card-right" transform="rotate(6 260 137)">
                    <rect x="187" y="66" width="146" height="145" rx="23" />
                    <rect className="ob-back-pill" x="208" y="89" width="53" height="18" rx="9" />
                    <path d="M208 126 H306 M208 140 H279" />
                    <circle className="ob-back-status ob-back-status-yellow" cx="218" cy="175" r="6" />
                    <circle className="ob-back-status ob-back-status-coral" cx="239" cy="175" r="6" />
                    <circle className="ob-back-status ob-back-status-mint" cx="260" cy="175" r="6" />
                </g>

                <rect className="ob-main-card" x="38" y="98" width="278" height="178" rx="27" filter="url(#onboarding-card-shadow)" />
                <rect className="ob-main-badge" x="59" y="118" width="51" height="23" rx="11" />
                <text className="ob-main-badge-text" x="84.5" y="133.5" textAnchor="middle">추천 경로</text>
                <text className="ob-main-time" x="59" y="174">28분</text>
                <text className="ob-main-departure" x="59" y="193">18:30 출발</text>

                <g className="ob-main-crowd">
                    <rect className="ob-main-crowd-bg" x="242" y="120" width="53" height="28" rx="14" />
                    <rect x="253" y="133" width="3" height="5" rx="1" />
                    <rect x="259" y="129" width="3" height="9" rx="1" />
                    <rect x="265" y="125" width="3" height="13" rx="1" />
                    <text x="275" y="135">보통</text>
                </g>

                <path className="ob-main-track-base" d="M64 222 H290" />
                <path className="ob-main-track-navy" d="M64 222 H174" />
                <path className="ob-main-track-mint" d="M174 222 H290" />
                <circle className="ob-main-station ob-main-start" cx="64" cy="222" r="10" />
                <circle className="ob-main-station ob-main-transfer" cx="174" cy="222" r="13" />
                <circle className="ob-main-transfer-core" cx="174" cy="222" r="5" />
                <circle className="ob-main-station ob-main-end" cx="290" cy="222" r="10" />
                <text className="ob-main-station-label" x="64" y="250" textAnchor="middle">출발</text>
                <text className="ob-main-station-label" x="174" y="250" textAnchor="middle">환승</text>
                <text className="ob-main-station-label" x="290" y="250" textAnchor="middle">도착</text>

                <g className="ob-mini-train" transform="translate(105 194)">
                    <rect width="40" height="38" rx="13" />
                    <rect className="ob-mini-train-window" x="8" y="7" width="24" height="11" rx="4" />
                    <path className="ob-mini-train-band" d="M6 23 H34" />
                    <circle className="ob-mini-train-light" cx="11" cy="29" r="2.4" />
                    <circle className="ob-mini-train-light" cx="29" cy="29" r="2.4" />
                    <path className="ob-mini-train-rail" d="M12 37 L8 42 M28 37 L32 42" />
                </g>

                <g className="ob-floating-chip ob-floating-chip-time">
                    <rect x="22" y="42" width="92" height="35" rx="17" />
                    <circle cx="42" cy="59.5" r="8" />
                    <path d="M42 55 V60 L46 62" />
                    <text x="57" y="63">시간 예측</text>
                </g>
                <g className="ob-floating-chip ob-floating-chip-free">
                    <rect x="234" y="286" width="91" height="35" rx="17" />
                    <circle cx="254" cy="303.5" r="6" />
                    <text x="268" y="307">여유 구간</text>
                </g>
                <path className="ob-city-silhouette" d="M14 328 V308 H30 V298 H43 V328 M49 328 V312 H66 V328 M73 328 V304 H86 V294 H98 V304 H111 V328 M118 328 V314 H139 V328" />
            </>}
            {page === 1 && <>
                <rect className="ob-camera-bg" width="354" height="345" rx="26" />
                <path className="ob-focus" d="M30 66 V35 H61 M293 35 H324 V66 M30 196 V227 H61 M293 227 H324 V196" />
                <rect className="ob-sign" x="47" y="75" width="260" height="91" rx="8" />
                <circle className="ob-line-two" cx="76" cy="120" r="18" />
                <text className="ob-line-number" x="76" y="126" textAnchor="middle">2</text>
                <text className="ob-sign-title" x="106" y="114">강남 · 역삼 방면</text>
                <text className="ob-sign-sub" x="106" y="137">Gangnam · Yeoksam</text>
                <path className="ob-sign-arrow" d="M252 120 H282 M270 108 L282 120 L270 132" />
                <rect className="ob-guide-card" x="40" y="226" width="274" height="87" rx="22" />
                <rect className="ob-guide-icon" x="55" y="241" width="57" height="57" rx="17" />
                <path className="ob-guide-arrow" d="M72 270 H96 M86 260 L96 270 L86 280" />
                <text className="ob-guide-kicker" x="127" y="263">AI 방향 안내</text>
                <text className="ob-guide-title" x="127" y="286">오른쪽으로 이동하세요</text>
            </>}
            {page === 2 && <>
                <circle className="ob-halo" cx="177" cy="173" r="137" />
                <path className="ob-connect" d="M62 65 L177 171 M292 65 L177 171 M62 280 L177 171 M292 280 L177 171" />
                <g className="ob-avatar"><circle cx="62" cy="65" r="25" /><text x="62" y="71" textAnchor="middle">민</text></g>
                <g className="ob-avatar ob-avatar-blue"><circle cx="292" cy="65" r="25" /><text x="292" y="71" textAnchor="middle">준</text></g>
                <g className="ob-avatar ob-avatar-green"><circle cx="62" cy="280" r="25" /><text x="62" y="286" textAnchor="middle">서</text></g>
                <g className="ob-avatar ob-avatar-purple"><circle cx="292" cy="280" r="25" /><text x="292" y="286" textAnchor="middle">윤</text></g>
                <rect className="ob-hub-card" x="101" y="103" width="152" height="142" rx="27" />
                <circle className="ob-hub-pin" cx="177" cy="137" r="18" />
                <path className="ob-pin-mark" d="M177 128a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 14v8" />
                <text className="ob-hub-kicker" x="177" y="178" textAnchor="middle">공평한 중간역</text>
                <text className="ob-hub-title" x="177" y="204" textAnchor="middle">건대입구</text>
                <g className="ob-hub-lines">
                    <circle cx="162" cy="224" r="9" /><text x="162" y="228" textAnchor="middle">2</text>
                    <circle cx="185" cy="224" r="9" /><text x="185" y="228" textAnchor="middle">7</text>
                </g>
            </>}
            {page === 3 && <>
                <path className="ob-route-line" d="M-20 294 C66 250 108 310 184 273 S291 235 378 267" />
                <rect className="ob-room-card" x="35" y="37" width="284" height="220" rx="27" />
                <rect className="ob-room-label" x="57" y="59" width="61" height="25" rx="12" />
                <text className="ob-room-label-text" x="88" y="76" textAnchor="middle">약속방</text>
                <text className="ob-room-title" x="57" y="118">토요일 저녁 모임</text>
                <text className="ob-room-meta" x="57" y="145">5월 24일 · 오후 6:30</text>
                <circle className="ob-room-pin" cx="68" cy="178" r="13" />
                <path className="ob-room-pin-mark" d="M68 171a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 10v5" />
                <text className="ob-room-place" x="91" y="183">성수역 · 장소 확정</text>
                <g className="ob-room-avatars">
                    <circle cx="69" cy="222" r="17" /><circle cx="96" cy="222" r="17" />
                    <circle cx="123" cy="222" r="17" /><circle cx="150" cy="222" r="17" />
                </g>
                <rect className="ob-ai-card" x="52" y="222" width="268" height="91" rx="22" />
                <rect className="ob-ai-badge" x="68" y="239" width="52" height="25" rx="12" />
                <text className="ob-ai-badge-text" x="94" y="256" textAnchor="middle">LinkRo AI</text>
                <text className="ob-ai-copy" x="69" y="285">각자 출발 시간을 알려드릴게요</text>
            </>}
        </svg>
    );
}

const onboardingPages = [
    { label: "혼자 이동", tone: "solo", title: <>타기 전에 미리 보는<br />경로와 혼잡도</>, description: "출발 시간을 정하면 그 시간의 혼잡도를 예측해서 경로마다 알려드려요." },
    { label: "AI 방향 안내", tone: "ai", title: <>방향이 헷갈리면<br />표지판을 찍어보세요</>, description: "AI가 표지판의 역 이름, 노선, 방면, 화살표를 읽고 어느 쪽으로 가야 하는지 알려드려요." },
    { label: "함께 만나기", tone: "together", title: <>모두에게 공평한<br />중간역을 찾아드려요</>, description: "최대 4명의 출발역과 원하는 조건을 말로 입력하면, 이동시간 차이가 적은 역을 순서대로 추천해요." },
    { label: "함께 만나기", tone: "together", title: <>약속은 약속방에서<br />한 번에 정리</>, description: "방 코드로 친구를 초대하고, 약속 장소와 시간을 함께 확인해요. @AI를 부르면 각자 출발 시간도 알려줘요." },
];

function OnboardingScreen({ onSkip, onComplete }: { onSkip: () => void; onComplete: () => void }) {
    const [page, setPage] = useState(0);
    const [touchStart, setTouchStart] = useState<number | null>(null);
    const data = onboardingPages[page];
    const next = () => page === 3 ? onComplete() : setPage((current) => current + 1);

    return (
        <Phone hideNav>
            <div
                className="onboarding-screen"
                onTouchStart={(event) => setTouchStart(event.touches[0].clientX)}
                onTouchEnd={(event) => {
                    if (touchStart === null) return;
                    const distance = event.changedTouches[0].clientX - touchStart;
                    if (distance < -45 && page < 3) setPage(page + 1);
                    if (distance > 45 && page > 0) setPage(page - 1);
                    setTouchStart(null);
                }}
            >
                <button className="skip-button" onClick={onSkip}>건너뛰기</button>
                <div className="onboarding-visual" key={`art-${page}`}><OnboardingIllustration page={page} /></div>
                <div className="onboarding-copy" key={`copy-${page}`}>
                    <LabelChip type={data.tone as "solo" | "together" | "ai"} />
                    <div className="onboarding-title">{data.title}</div>
                    <p>{data.description}</p>
                </div>
                <div className="onboarding-footer">
                    <PageIndicator total={4} current={page} />
                    <Button onClick={next}>{page === 3 ? "시작하기" : "다음"}<Icon>arrow_forward</Icon></Button>
                </div>
            </div>
        </Phone>
    );
}

function PermissionScreen({
                              onFinish,
                          }: {
    onFinish: (permission: CameraPermission) => void;
}) {
    const requestCamera = async () => {
        const result = await requestCameraPermission();
        onFinish(result);
    };

    return (
        <Phone hideNav>
            <div className="permission-screen">
                <div className="permission-icon"><Icon size="lg">admin_panel_settings</Icon></div>
                <div className="permission-title">LinkRo를 더 편하게 사용하려면<br />권한 설정이 필요해요</div>
                <p>필요한 기능만 사용할 때 권한을 요청해요.<br />사진은 저장하지 않고, 알림도 중요한 정보에만 사용돼요.</p>
                <div className="permission-card">
                    <div><Icon>photo_camera</Icon></div>
                    <section>
                        <strong>카메라</strong>
                        <p>AI 방향 안내에서 표지판을 촬영할 때 사용해요</p>
                        <small>사진은 분석 후 저장하지 않아요</small>
                    </section>
                    <Icon size="sm">chevron_right</Icon>
                </div>
                <div className="permission-card notification-permission-card">
                    <div><Icon>notifications</Icon></div>
                    <section>
                        <strong>알림</strong>
                        <p>약속방 일정 변경, 도착 정보 등을 알려드려요</p>
                        <small>중요한 안내만 받아볼 수 있어요</small>
                    </section>
                    <Icon size="sm">chevron_right</Icon>
                </div>
                <div className="permission-actions">
                    <Button onClick={requestCamera}>시작하기</Button>
                    <Button variant="text" onClick={() => onFinish("notDetermined")}>나중에 할게요</Button>
                </div>
            </div>
        </Phone>
    );
}

function LoginScreen({ onKakao }: { onKakao: () => void }) {
    return (
        <Phone hideNav>
            <div className="login-screen">
                <div className="login-brand">
                    <Logo compact />
                    <strong>지하철을 더 가깝게, 함께.</strong>
                    <p>LinkRo에서 이동을 시작해보세요.</p>
                    <div className="login-route-motif" aria-hidden="true"><i /><i /><i /></div>
                </div>
                <div className="login-actions">
                    <Button className="login-kakao-button" onClick={onKakao}>
                        <span className="kakao-chat-icon" aria-hidden="true"><i /></span>
                        카카오로 시작하기
                    </Button>
                    <div className="login-kakao-note"><Icon size="sm">lock</Icon><span>카카오 계정으로 안전하고 간편하게 시작해요</span></div>
                </div>
                <p className="login-terms">계속하면 LinkRo의 <span>이용약관</span> 및 <span>개인정보처리방침</span>에 동의하게 됩니다.</p>
            </div>
        </Phone>
    );
}

function MeetingCard({
                         meeting,
                         skeleton = false,
                         onClick,
                     }: {
    meeting?: Meeting;
    skeleton?: boolean;
    onClick?: (meetingId: string) => void;
}) {
    if (skeleton || !meeting) {
        return <div className="appointment-card appointment-skeleton"><i /><section><b /><b /><b /></section></div>;
    }

    const date = new Date(meeting.datetime);
    const dDay = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
    const dateLabel = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(date);
    const weekdayTime = `${new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date)} ${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`;

    return (
        <button className="appointment-card meeting-card-component" onClick={() => onClick?.(meeting.id)}>
            <div className="appointment-date navy-date"><strong>D-{dDay}</strong><span>{dateLabel}</span></div>
            <div className="appointment-info">
                <div className="appointment-title"><strong>{meeting.title}</strong></div>
                <div className="appointment-station">
                    <span>{weekdayTime} ·</span>
                    {meeting.confirmedStation ? <>
                        {meeting.confirmedStation.lines.map((line) => <LineBadge line={line} small key={line} />)}
                        <span>{meeting.confirmedStation.name}</span>
                    </> : <span className="pending-place">장소 정하는 중</span>}
                </div>
            </div>
            <div className="meeting-card-avatars">
                {meeting.participants.slice(0, 4).map((participant, index) => <Avatar name={participant.name} color={index} key={participant.id} />)}
            </div>
        </button>
    );
}

function HomeScreen({
                        navigate,
                        openRoute,
                        openDirection,
                        user,
                        meetings,
                        dataMode,
                        onRetry,
                        hasUnreadNotifications,
                        onOpenNotifications,
                        onCreateRoom,
                        onOpenMeeting,
                    }: {
    navigate: (screen: ScreenId) => void;
    openRoute: () => void;
    openDirection: () => void;
    user: User | null;
    meetings: Meeting[];
    dataMode: DataMode;
    onRetry: () => void;
    hasUnreadNotifications: boolean;
    onOpenNotifications: () => void;
    onCreateRoom: () => void;
    onOpenMeeting: (meetingId: string) => void;
}) {
    return (
        <Phone onNavigate={navigate}>
            <div className="top-row">
                <Logo />
                <button className="round-icon" onClick={onOpenNotifications}><Icon>notifications</Icon>{hasUnreadNotifications && <i />}</button>
            </div>
            <div className="home-greeting">
                {dataMode === "loading" ? <div className="greeting-skeleton"><i /><i /></div> :
                    dataMode === "error" ? <div className="home-data-error"><span>사용자 정보를 불러오지 못했어요</span><button onClick={onRetry}>다시 시도</button></div> :
                        <div>{user?.name ? <>{user.name}님, 오늘은<br />어떻게 이동할까요?</> : <>오늘은<br />어떻게 이동할까요?</>}</div>}
            </div>
            <div className="home-mode-card solo-home">
                <div className="home-mode-head">
                    <div><span>SOLO</span><strong>혼자 이동</strong><p>경로·혼잡도 확인, 헷갈리면 방향 안내</p></div>
                    <Icon size="lg">directions_subway</Icon>
                </div>
                <div className="home-tiles">
                    <FeatureTile icon="route" label="경로 찾기" tone="navy" onClick={openRoute} />
                    <FeatureTile icon="photo_camera" label="AI 방향 안내" tone="navy" showAiChip onClick={openDirection} />
                </div>
            </div>
            <div className="home-mode-card together-home">
                <div className="home-mode-head">
                    <div><span>TOGETHER</span><strong>함께 만나기</strong><p>최대 4명의 출발역으로 중간역 추천</p></div>
                    <Icon size="lg">group</Icon>
                </div>
                <div className="home-tiles">
                    <FeatureTile icon="hub" label="중간역 찾기" tone="mint" onClick={() => navigate("midpoint")} />
                    <FeatureTile icon="forum" label="약속방" tone="gray" onClick={() => navigate("join")} />
                </div>
            </div>
            <div className="section-row">
                <div className="section-title">진행 중인 약속</div>
                {meetings.length > 2 && <span className="text-action">전체 보기</span>}
            </div>
            {dataMode === "loading" ? (
                <MeetingCard skeleton />
            ) : dataMode === "error" ? (
                <ErrorState message="약속을 불러오지 못했어요" onRetry={onRetry} />
            ) : meetings.length === 0 ? (
                <EmptyState icon="calendar_month" message="아직 진행 중인 약속이 없어요" actionLabel="약속방 만들기" onAction={onCreateRoom} />
            ) : (
                <div className="meeting-card-list">{meetings.slice(0, 2).map((meeting) => <MeetingCard meeting={meeting} onClick={onOpenMeeting} key={meeting.id} />)}</div>
            )}
        </Phone>
    );
}

function SearchBar({ placeholder, onPress }: { placeholder: string; onPress: () => void }) {
    return <button className="map-search-bar" onClick={onPress}><Icon>search</Icon><span>{placeholder}</span></button>;
}

function MapFab({ icon, onPress }: { icon: "my_location" | "layers"; onPress: () => void }) {
    return <button className="map-fab" onClick={onPress} aria-label={icon === "layers" ? "지도 레이어 전환" : "현재 위치로 이동"}><Icon>{icon}</Icon></button>;
}

function FeatureCard({
                         tone,
                         icon,
                         title,
                         desc,
                         showAiChip = false,
                         onPress,
                     }: {
    tone: "route" | "midpoint" | "ai" | "room";
    icon: string;
    title: string;
    desc: string;
    showAiChip?: boolean;
    onPress: () => void;
}) {
    return (
        <button className={`map-feature-card ${tone}`} onClick={onPress}>
            <span className="map-feature-icon"><Icon>{icon}</Icon></span>
            <div><strong>{title}{showAiChip && <AiChip />}</strong><p>{desc}</p></div>
            <Icon size="sm">chevron_right</Icon>
        </button>
    );
}

function HomeSheet({
                       state,
                       onStateChange,
                       children,
                   }: {
    state: "collapsed" | "expanded";
    onStateChange: (state: "collapsed" | "expanded") => void;
    children: ReactNode;
}) {
    const touchY = useRef<number | null>(null);
    return (
        <div
            className={`home-sheet ${state}`}
            onTouchStart={(event) => { touchY.current = event.touches[0].clientY; }}
            onTouchEnd={(event) => {
                if (touchY.current === null) return;
                const distance = event.changedTouches[0].clientY - touchY.current;
                if (distance < -35) onStateChange("expanded");
                if (distance > 35) onStateChange("collapsed");
                touchY.current = null;
            }}
        >
            <button className="home-sheet-handle" onClick={() => onStateChange(state === "collapsed" ? "expanded" : "collapsed")} aria-label="기능 시트 펼치기"><i /></button>
            {children}
        </div>
    );
}

function MapHomeScreen({
                           navigate,
                           dataMode,
                           meetings,
                           hasUnreadNotifications,
                           onOpenNotifications,
                           onOpenDirection,
                           onOpenMeeting,
                           onCreateRoom,
                           onRetry,
                       }: {
    navigate: (screen: ScreenId) => void;
    dataMode: DataMode;
    meetings: Meeting[];
    hasUnreadNotifications: boolean;
    onOpenNotifications: () => void;
    onOpenDirection: () => void;
    onOpenMeeting: (meetingId: string) => void;
    onCreateRoom: () => void;
    onRetry: () => void;
}) {
    const [sheetState, setSheetState] = useState<"collapsed" | "expanded">("collapsed");
    const [mapType, setMapType] = useState<"roadmap" | "hybrid">("roadmap");
    const [recenterSignal, setRecenterSignal] = useState(0);

    return (
        <Phone onNavigate={navigate}>
            <div className="map-home">
                {dataMode === "loading" ? <div className="map-skeleton" /> :
                    dataMode === "error" ? <div className="map-error"><Icon>map</Icon><strong>지도를 불러오지 못했어요</strong><Button variant="text" onClick={onRetry}>다시 시도</Button></div> :
                        <MockKakaoMap mapType={mapType} recenterSignal={recenterSignal} />}
                <div className="map-top-overlay">
                    <div className="map-brand-row">
                        <div><Logo /><p>지하철을 더 가깝게, 함께.</p></div>
                        <button className="round-icon map-alert" onClick={onOpenNotifications}><Icon>notifications</Icon>{hasUnreadNotifications && <i />}</button>
                    </div>
                    <SearchBar placeholder="어디로 이동하시나요?" onPress={() => navigate("station-search")} />
                </div>
                <div className={`map-fab-wrap ${sheetState}`}>
                    <MapFab icon="my_location" onPress={() => setRecenterSignal((value) => value + 1)} />
                    <MapFab icon="layers" onPress={() => setMapType((current) => current === "roadmap" ? "hybrid" : "roadmap")} />
                </div>
                <HomeSheet state={sheetState} onStateChange={setSheetState}>
                    <div className="map-feature-grid">
                        <FeatureCard tone="route" icon="directions_subway" title="경로 탐색" desc="최적 경로 찾기" onPress={() => navigate("route")} />
                        <FeatureCard tone="midpoint" icon="group" title="중간역 추천" desc="함께 만날 위치" onPress={() => navigate("midpoint")} />
                        <FeatureCard tone="ai" icon="photo_camera" title="AI 방향 안내" desc="표지판만 촬영하기" showAiChip onPress={onOpenDirection} />
                        <FeatureCard tone="room" icon="forum" title="약속방" desc="함께 이동하기" onPress={() => navigate("join")} />
                    </div>
                    <div className="map-meetings">
                        <div className="section-row">
                            <div className="section-title">진행 중인 약속</div>
                            {meetings.length > 2 && <span className="text-action">전체 보기</span>}
                        </div>
                        {dataMode === "loading" ? <MeetingCard skeleton /> :
                            dataMode === "error" ? <ErrorState message="약속을 불러오지 못했어요" onRetry={onRetry} /> :
                                meetings.length === 0 ? <EmptyState icon="calendar_month" message="아직 진행 중인 약속이 없어요" actionLabel="약속방 만들기" onAction={onCreateRoom} /> :
                                    <div className="meeting-card-list">{meetings.slice(0, 2).map((meeting) => <MeetingCard meeting={meeting} onClick={onOpenMeeting} key={meeting.id} />)}</div>}
                    </div>
                </HomeSheet>
            </div>
        </Phone>
    );
}

function HomeV2FeatureCard({
                               icon,
                               title,
                               desc,
                               accent,
                               showAiChip = false,
                               onPress,
                           }: {
    icon: string;
    title: string;
    desc: string;
    accent: "mint" | "navy" | "violet" | "slate";
    showAiChip?: boolean;
    onPress: () => void;
}) {
    return (
        <button className="v2-feature-card" onClick={onPress}>
            <span className={`v2-feature-icon ${accent}`}><Icon>{icon}</Icon></span>
            <div><strong>{title}{showAiChip && <AiChip />}</strong><p>{desc}</p></div>
            <Icon size="sm">chevron_right</Icon>
        </button>
    );
}

const Home_V1 = MapHomeScreen;

function Home_V2({
                     navigate,
                     dataMode,
                     meetings,
                     hasUnreadNotifications,
                     onOpenNotifications,
                     onOpenDirection,
                     onOpenMeeting,
                     onCreateRoom,
                     onRetry,
                 }: {
    navigate: (screen: ScreenId) => void;
    dataMode: DataMode;
    meetings: Meeting[];
    hasUnreadNotifications: boolean;
    onOpenNotifications: () => void;
    onOpenDirection: () => void;
    onOpenMeeting: (meetingId: string) => void;
    onCreateRoom: () => void;
    onRetry: () => void;
}) {
    const [sheetState, setSheetState] = useState<"collapsed" | "expanded">("collapsed");
    const [mapType, setMapType] = useState<"roadmap" | "hybrid">("roadmap");
    const [recenterSignal, setRecenterSignal] = useState(0);
    const touchY = useRef<number | null>(null);

    return (
        <Phone onNavigate={navigate}>
            <div className="map-home-v2">
                {dataMode === "loading" ? <div className="map-skeleton" /> :
                    dataMode === "error" ? <div className="map-error"><Icon>map</Icon><strong>지도를 불러오지 못했어요</strong><Button variant="text" onClick={onRetry}>다시 시도</Button></div> :
                        <MockKakaoMap mapType={mapType} recenterSignal={recenterSignal} />}

                <div className="v2-top-overlay">
                    <div className="v2-brand-bar">
                        <div><Logo /><span>지하철을 더 가깝게, 함께.</span></div>
                        <button className="round-icon v2-alert" onClick={onOpenNotifications}><Icon>notifications</Icon>{hasUnreadNotifications && <i />}</button>
                    </div>
                    <SearchBar placeholder="어디로 이동하시나요?" onPress={() => navigate("station-search")} />
                </div>

                <div className={`v2-map-controls ${sheetState}`}>
                    <MapFab icon="my_location" onPress={() => setRecenterSignal((value) => value + 1)} />
                    <MapFab icon="layers" onPress={() => setMapType((current) => current === "roadmap" ? "hybrid" : "roadmap")} />
                </div>

                <div
                    className={`v2-home-sheet ${sheetState}`}
                    onTouchStart={(event) => { touchY.current = event.touches[0].clientY; }}
                    onTouchEnd={(event) => {
                        if (touchY.current === null) return;
                        const distance = event.changedTouches[0].clientY - touchY.current;
                        if (distance < -35) setSheetState("expanded");
                        if (distance > 35) setSheetState("collapsed");
                        touchY.current = null;
                    }}
                >
                    <button className="home-sheet-handle" onClick={() => setSheetState((current) => current === "collapsed" ? "expanded" : "collapsed")}><i /></button>
                    <div className="v2-sheet-title"><div><strong>빠른 이동</strong><span>원하는 기능을 선택하세요</span></div><Icon>keyboard_arrow_up</Icon></div>
                    <div className="v2-feature-grid">
                        <HomeV2FeatureCard icon="route" title="경로 탐색" desc="최적 경로 찾기" accent="mint" onPress={() => navigate("route")} />
                        <HomeV2FeatureCard icon="group" title="중간역 추천" desc="함께 만날 위치" accent="navy" onPress={() => navigate("midpoint")} />
                        <HomeV2FeatureCard icon="photo_camera" title="AI 방향 안내" desc="표지판 촬영" accent="violet" showAiChip onPress={onOpenDirection} />
                        <HomeV2FeatureCard icon="forum" title="약속방" desc="함께 이동하기" accent="slate" onPress={() => navigate("join")} />
                    </div>
                    <div className="v2-meetings">
                        <div className="section-row"><div className="section-title">진행 중인 약속</div>{meetings.length > 2 && <span className="text-action">전체 보기</span>}</div>
                        {dataMode === "loading" ? <MeetingCard skeleton /> :
                            dataMode === "error" ? <ErrorState message="약속을 불러오지 못했어요" onRetry={onRetry} /> :
                                meetings.length === 0 ? <EmptyState icon="calendar_month" message="아직 진행 중인 약속이 없어요" actionLabel="약속방 만들기" onAction={onCreateRoom} /> :
                                    <div className="meeting-card-list">{meetings.slice(0, 2).map((meeting) => <MeetingCard meeting={meeting} onClick={onOpenMeeting} key={meeting.id} />)}</div>}
                    </div>
                </div>
            </div>
        </Phone>
    );
}

const stationOptions = mockData.stations;

const routeOptions = [
    { id: "recommended", minutes: 36, arrival: "19:06", fare: "1,650원", transfer: 1, walk: 4, crowd: "혼잡" as CrowdLevel },
    { id: "fast", minutes: 38, arrival: "19:08", fare: "1,650원", transfer: 1, walk: 6, crowd: "매우 혼잡" as CrowdLevel },
    { id: "relaxed", minutes: 44, arrival: "19:14", fare: "1,750원", transfer: 2, walk: 3, crowd: "보통" as CrowdLevel },
];

function SearchScreen({
                          navigate,
                          goBack,
                          onStart,
                          initialJourney,
                      }: {
    navigate: (screen: ScreenId) => void;
    goBack: () => void;
    onStart: (journey: JourneyInfo) => void;
    initialJourney: JourneyInfo;
}) {
    const [from, setFrom] = useState(initialJourney.from);
    const [to, setTo] = useState(initialJourney.to);
    const [stationTarget, setStationTarget] = useState<"from" | "to" | null>(null);
    const [stationQuery, setStationQuery] = useState("");
    const [timeMode, setTimeMode] = useState("지금 출발");
    const [showTimeSheet, setShowTimeSheet] = useState(false);
    const [sort, setSort] = useState("추천순");
    const [expanded, setExpanded] = useState("recommended");

    const orderedRoutes = [...routeOptions].sort((a, b) => {
        if (sort === "여유로운") return crowdBars[a.crowd] - crowdBars[b.crowd];
        if (sort === "최소환승") return a.transfer - b.transfer || a.minutes - b.minutes;
        if (sort === "최소시간") return a.minutes - b.minutes;
        return routeOptions.findIndex((route) => route.id === a.id) - routeOptions.findIndex((route) => route.id === b.id);
    });

    const chooseStation = (name: string) => {
        if (stationTarget === "from") setFrom(name);
        if (stationTarget === "to") setTo(name);
        setStationTarget(null);
    };

    return (
        <Phone nav="경로" onNavigate={navigate}>
            <Header title="경로 탐색" back onBack={goBack} action={<Icon>more_horiz</Icon>} />
            <div className="explore-search">
                <div className="search-rail">
                    <i />
                    <span />
                    <i />
                </div>
                <div className="search-fields">
                    <button onClick={() => { setStationQuery(""); setStationTarget("from"); }}><span>출발</span><strong className={!from ? "empty-value" : ""}>{from || "출발역을 검색하세요"}</strong></button>
                    <button onClick={() => { setStationQuery(""); setStationTarget("to"); }}><span>도착</span><strong className={!to ? "empty-value" : ""}>{to || "도착역을 검색하세요"}</strong></button>
                </div>
                <button className="swap-button" onClick={() => { setFrom(to); setTo(from); }} aria-label="출발 도착 바꾸기"><Icon>swap_vert</Icon></button>
            </div>
            <div className="time-options">
                <button className={timeMode === "지금 출발" ? "selected" : ""} onClick={() => setTimeMode("지금 출발")}>지금 출발</button>
                <button className={`time-setting${timeMode !== "지금 출발" ? " selected" : ""}`} onClick={() => setShowTimeSheet(true)}>
                    <Icon size="sm">schedule</Icon>{timeMode === "지금 출발" ? "시간 설정" : timeMode}
                </button>
            </div>
            {from && to ? <>
                <div className="route-sort-row">
                    <div className="route-sort">
                        {["추천순", "최소시간", "최소환승", "여유로운"].map((option) => (
                            <button className={sort === option ? "selected" : ""} onClick={() => setSort(option)} key={option}>{option}</button>
                        ))}
                    </div>
                    <div className="prediction"><Icon size="sm">auto_awesome</Icon><span>18:30<br />혼잡도 예측</span></div>
                </div>
                <div className="interactive-routes">
                    {orderedRoutes.map((route, index) => route.id === expanded ? (
                        <div className="expanded-route" key={route.id} onClick={() => setExpanded(route.id)}>
                            <div className="expanded-top">
                                {route.id === "recommended" ? <span className="recommend-tag">추천</span> : <span className="route-order">{index + 1}번째 경로</span>}
                                <Congestion level={route.crowd} />
                            </div>
                            <div className="expanded-summary">
                                <div><strong>{route.minutes}</strong><span>분</span><p>18:30 → {route.arrival}</p></div>
                                <div className="line-ratio">
                                    <div><i className="ratio-4" /><i className="ratio-2" /></div>
                                    <span><b><LineBadge line={4} small />4호선</b><Icon size="sm">arrow_forward</Icon><b><LineBadge line={2} small />2호선</b></span>
                                </div>
                            </div>
                            <div className="expanded-meta"><span>{route.fare}</span><i /><span>환승 {route.transfer}회</span><i /><span>도보 {route.walk}분</span></div>
                            <div className="route-timeline">
                                <div className="timeline-stop start"><i /><span /></div>
                                <div className="timeline-copy"><strong>{from}</strong><p><LineBadge line={4} small /> 진접 방면 · 4개역 8분 <Congestion level="보통" compact /></p></div>
                                <div className="timeline-stop transfer"><i /><span /></div>
                                <div className="timeline-copy"><strong>동대문역사문화공원</strong><em>환승 도보 4분</em><p><LineBadge line={2} small /> 성수 방면 · 11개역 24분 <Congestion level={route.crowd} compact /></p></div>
                                <div className="timeline-stop end"><i /></div>
                                <div className="timeline-copy"><strong>{to} 도착</strong><em>{route.arrival} 도착 예정</em></div>
                            </div>
                            <button
                                className="primary-button compact-button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onStart({ from, to, minutes: route.minutes, arrival: route.arrival });
                                }}
                            >
                                이 경로로 안내 시작
                            </button>
                        </div>
                    ) : (
                        <button className="collapsed-route" key={route.id} onClick={() => setExpanded(route.id)}>
                            <strong>{route.minutes}분</strong><span>{route.fare} · 환승 {route.transfer}회</span><Congestion level={route.crowd} compact /><Icon size="sm">expand_more</Icon>
                        </button>
                    ))}
                </div>
            </> : (
                <div className="route-empty-state">
                    <div className="route-empty-visual" aria-hidden="true"><i /><span /><i /><span /><i /></div>
                    <strong>출발역과 도착역을 입력하면<br />경로를 찾아드려요</strong>
                    <span>소요시간 · 요금 · 환승 · 예상 혼잡도</span>
                </div>
            )}
            {stationTarget && (
                <div className="route-sheet-backdrop" onClick={() => setStationTarget(null)}>
                    <div className="route-bottom-sheet station-sheet" onClick={(event) => event.stopPropagation()}>
                        <div className="sheet-handle" />
                        <strong>{stationTarget === "from" ? "출발역" : "도착역"} 검색</strong>
                        <div className="station-search"><Icon>search</Icon><input autoFocus value={stationQuery} onChange={(event) => setStationQuery(event.target.value)} placeholder="역 이름을 검색하세요" /></div>
                        <div className="station-list">
                            {stationOptions.filter((station) => station.name.includes(stationQuery.trim())).map((station) => (
                                <button key={station.name} onClick={() => chooseStation(station.name)}>
                                    <Icon>train</Icon><strong>{station.name}</strong>
                                    <span>{station.lines.map((line) => <LineBadge line={line} small key={line} />)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {showTimeSheet && (
                <div className="route-sheet-backdrop" onClick={() => setShowTimeSheet(false)}>
                    <div className="route-bottom-sheet time-sheet" onClick={(event) => event.stopPropagation()}>
                        <div className="sheet-handle" />
                        <div className="time-sheet-title"><strong>출발 시간 선택</strong><button onClick={() => { setTimeMode("오늘 18:30 출발"); setShowTimeSheet(false); }}>완료</button></div>
                        <div className="time-wheel">
                            <div><span>오늘</span><strong>오늘</strong><span>내일</span></div>
                            <div><span>17</span><strong>18</strong><span>19</span></div>
                            <b>:</b>
                            <div><span>20</span><strong>30</strong><span>40</span></div>
                        </div>
                    </div>
                </div>
            )}
        </Phone>
    );
}

function AiDirectionScreen({
                               onClose,
                               journey,
                               cameraBlocked = false,
                           }: {
    onClose: () => void;
    journey: JourneyInfo;
    cameraBlocked?: boolean;
}) {
    const [scanState, setScanState] = useState<"waiting" | "analyzing" | "success" | "failure">("waiting");
    const [outcome, setOutcome] = useState<"success" | "failure">("success");

    useEffect(() => {
        if (scanState !== "analyzing") return;
        const timer = window.setTimeout(() => setScanState(outcome), 1500);
        return () => window.clearTimeout(timer);
    }, [scanState, outcome]);

    const beginScan = (nextOutcome: "success" | "failure") => {
        setOutcome(nextOutcome);
        setScanState("analyzing");
    };

    const cameraOnly = scanState === "waiting" || scanState === "analyzing";
    return (
        <Phone hideNav>
            <div className={`camera-view${cameraOnly ? " full-camera" : ""}`}>
                <div className="camera-header">
                    <button className="camera-action" onClick={onClose} aria-label="닫기"><Icon>close</Icon></button>
                    <strong>AI 방향 안내</strong>
                    <button className="camera-action" aria-label="플래시"><Icon>flash_on</Icon></button>
                </div>
                <div className="camera-guide">
                    <i /><i /><i /><i />
                    <div className="platform-sign">
                        <LineBadge line={2} />
                        <div><span>성수 · 잠실 방면</span><small>Seongsu · Jamsil</small></div>
                        <strong>→</strong>
                    </div>
                    {scanState === "analyzing" && <div className="scan-line" />}
                    <div className="recognition-label">
                        <Icon size="sm">center_focus_strong</Icon>
                        {scanState === "analyzing" ? "AI가 표지판을 읽고 있어요" : "표지판이 네모 안에 들어오게 맞춰주세요"}
                    </div>
                </div>
                <div className="camera-buttons">
                    <button className="capture-button" disabled={scanState === "analyzing"} onClick={() => beginScan("success")}><Icon>photo_camera</Icon>표지판 촬영</button>
                    <button className="upload-button" disabled={scanState === "analyzing"} onClick={() => beginScan("failure")}><Icon>upload</Icon>사진 업로드</button>
                </div>
            </div>
            {scanState === "success" && <div className="recognition-sheet">
                <div className="sheet-handle" />
                <div className="recognition-heading">
                    <div><strong>표지판 인식 결과</strong><span>AI 분석 완료</span></div>
                    <AiChip />
                </div>
                <div className="recognition-grid">
                    <div><span>현재 역</span><strong>동대문역사문화공원</strong></div>
                    <div><span>노선</span><strong><LineBadge line={2} small />2호선</strong></div>
                    <div><span>방면</span><strong>성수 · 잠실</strong></div>
                    <div><span>화살표</span><strong className="direction-arrow">오른쪽&nbsp; →</strong></div>
                </div>
                <div className="route-match"><Icon filled>check_circle</Icon><span>내 경로 <strong>2호선 성수 방면 → {journey.to}</strong>과 일치해요</span></div>
                <div className="direction-card">
                    <div className="direction-icon">→</div>
                    <div><strong>오른쪽 방향으로 이동하세요</strong><span>{journey.minutes}분 이동 후 {journey.to}에서 하차</span></div>
                </div>
                <button className="retry-link" onClick={() => setScanState("waiting")}>인식 결과가 다른가요? <strong>다시 촬영하기</strong></button>
            </div>}
            {scanState === "failure" && (
                <div className="recognition-sheet failure-sheet">
                    <div className="sheet-handle" />
                    <div className="failure-card">
                        <div><Icon size="lg">error</Icon></div>
                        <strong>표지판을 인식하지 못했어요</strong>
                        <span>글자와 화살표가 잘 보이게<br />다시 찍어주세요</span>
                        <button className="primary-button" onClick={() => setScanState("waiting")}><Icon>photo_camera</Icon>다시 촬영</button>
                    </div>
                </div>
            )}
            {cameraBlocked && (
                <BottomSheet title="카메라 권한" onClose={onClose} className="camera-blocked-sheet">
                    <div className="camera-blocked-icon"><Icon size="lg">no_photography</Icon></div>
                    <strong>설정에서 카메라를 허용해주세요</strong>
                    <p>AI 방향 안내를 사용하려면 iPhone 설정에서 LinkRo의 카메라 접근을 켜주세요.</p>
                    <Button onClick={() => undefined}>설정 열기</Button>
                    <Button variant="text" onClick={onClose}>닫기</Button>
                </BottomSheet>
            )}
        </Phone>
    );
}

const members = (mockData.meetings[0]?.participants ?? []).map((participant, index) => ({
    name: participant.name,
    meta: index === 0 ? "나" : "",
    station: participant.startStation?.name ?? "",
    lines: participant.startStation?.lines ?? [],
    avatar: participant.name.slice(0, 1),
    mine: index === 0,
}));

function MidpointInputScreen({
                                 navigate,
                                 goBack,
                             }: {
    navigate: (screen: ScreenId) => void;
    goBack: () => void;
}) {
    const [participants, setParticipants] = useState<typeof members>([]);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [stationQuery, setStationQuery] = useState("");
    const [condition, setCondition] = useState("");
    const [aiShown, setAiShown] = useState(false);
    const [showTransferSheet, setShowTransferSheet] = useState(false);
    const [transferLimit, setTransferLimit] = useState(1);
    const [calculating, setCalculating] = useState(false);

    useEffect(() => {
        if (!calculating) return;
        const timer = window.setTimeout(() => navigate("results"), 1500);
        return () => window.clearTimeout(timer);
    }, [calculating, navigate]);

    const selectParticipantStation = (station: { name: string; lines: number[] }) => {
        if (editingIndex === null) return;
        setParticipants((current) => {
            const next = [...current];
            if (editingIndex < current.length) {
                next[editingIndex] = { ...next[editingIndex], station: station.name, lines: station.lines };
            } else if (current.length < 4) {
                const isMe = current.length === 0;
                const name = isMe ? mockData.user.name : "새 참여자";
                next.push({ name, meta: isMe ? "나" : "", station: station.name, lines: station.lines, avatar: name.slice(0, 1), mine: isMe });
            }
            return next;
        });
        setEditingIndex(null);
    };

    return (
        <Phone hideNav>
            <Header title="중간역 찾기" back onBack={goBack} action={<span className="room-chip">기말 끝 파티 · LR-4821</span>} />
            <div className="member-section-head">
                <div><strong>모두의 출발역</strong><span>함께 이동할 친구들의 출발역이에요</span></div>
                <b>{participants.length}/4명 입력 완료</b>
            </div>
            <div className="member-grid">
                {participants.map((member, index) => (
                    <button className={`member-card${member.mine ? " mine" : ""}`} key={`${member.name}-${index}`} onClick={() => { setStationQuery(""); setEditingIndex(index); }}>
                        <div className={`member-avatar member-avatar-${index + 1}`}>{member.avatar}</div>
                        <div className="member-name"><strong>{member.name}</strong>{member.meta && <span>{member.meta}</span>}</div>
                        <div className="member-station"><strong>{member.station}</strong><div>{member.lines.map((line) => <LineBadge key={line} line={line} small />)}</div></div>
                    </button>
                ))}
                {participants.length < 4 && (
                    <button className="member-card add-member-card" onClick={() => { setStationQuery(""); setEditingIndex(participants.length); }}>
                        <Icon>add</Icon><strong>{participants.length === 0 ? "내 출발역 입력" : "참여자 추가"}</strong><span>최대 4명</span>
                    </button>
                )}
            </div>
            <div className="condition-heading">
                <div><strong>어떤 곳이면 좋을까요?</strong><span>원하는 조건을 편하게 말해주세요</span></div>
                <span className="ai-helper"><Icon size="sm">auto_awesome</Icon>AI가 조건으로 바꿔요</span>
            </div>
            <div className="condition-input">
                <textarea value={condition} onChange={(event) => setCondition(event.target.value)} placeholder="원하는 중간역 조건을 입력해주세요" />
                <div className="condition-actions">
                    <div>
                        {["요금 비슷하게", "30분 이내"].map((suggestion) => (
                            <Chip key={suggestion} onClick={() => setCondition((current) => `${current}${current ? " " : ""}${suggestion}.`)}>{suggestion}</Chip>
                        ))}
                    </div>
                    <button aria-label="조건 전송" onClick={() => setAiShown(true)}><Icon>arrow_upward</Icon></button>
                </div>
            </div>
            {aiShown && <div className="ai-understanding fade-in-card">
                <div className="understanding-title"><AiChip /><strong>AI가 이렇게 이해했어요</strong></div>
                <div className="understanding-row">
                    <div className="understanding-icon"><Icon>balance</Icon></div>
                    <div><strong>이동시간 편차 최소화</strong><span>모두 비슷한 시간에 도착</span></div>
                    <b>우선</b>
                </div>
                <div className="understanding-row">
                    <div className="understanding-icon"><Icon>sync_alt</Icon></div>
                    <div><strong>1인당 환승 최대 {transferLimit}회</strong><span>복잡한 환승 경로 제외</span></div>
                    <button onClick={() => setShowTransferSheet(true)}>수정</button>
                </div>
            </div>}
            <Button className="midpoint-button" disabled={!aiShown || participants.length < 2} onClick={() => setCalculating(true)}><Icon>hub</Icon>중간역 계산하기</Button>
            {editingIndex !== null && (
                <BottomSheet onClose={() => setEditingIndex(null)} className="participant-station-sheet">
                    <div className="participant-sheet-title">
                        <div><strong>{editingIndex < participants.length ? participants[editingIndex].name : "새 참여자"}의 출발역</strong><span>출발할 역을 선택해주세요</span></div>
                        {editingIndex < participants.length && !participants[editingIndex].mine && (
                            <button onClick={() => { setParticipants((current) => current.filter((_, index) => index !== editingIndex)); setEditingIndex(null); }}>참여자 삭제</button>
                        )}
                    </div>
                    <div className="station-search"><Icon>search</Icon><input autoFocus value={stationQuery} onChange={(event) => setStationQuery(event.target.value)} placeholder="역 이름 검색" /></div>
                    <div className="station-list compact-stations">
                        {stationOptions.filter((station) => station.name.includes(stationQuery.trim())).map((station) => (
                            <button key={station.name} onClick={() => selectParticipantStation(station)}>
                                <Icon>train</Icon><strong>{station.name}</strong><span>{station.lines.map((line) => <LineBadge line={line} small key={line} />)}</span>
                            </button>
                        ))}
                    </div>
                </BottomSheet>
            )}
            {showTransferSheet && (
                <BottomSheet onClose={() => setShowTransferSheet(false)} className="option-sheet">
                    <strong>환승 횟수 조건</strong>
                    <div className="option-list">
                        {[0, 1, 2].map((count) => (
                            <button key={count} onClick={() => { setTransferLimit(count); setShowTransferSheet(false); }}>
                                <span>환승 최대 {count}회</span>{transferLimit === count && <Icon filled>check_circle</Icon>}
                            </button>
                        ))}
                    </div>
                </BottomSheet>
            )}
            {calculating && <LoadingOverlay text={`${participants.length}명의 경로를 계산하고 있어요`} />}
        </Phone>
    );
}

const travelers = [
    { name: "민지", color: "traveler-mint" },
    { name: "준호", color: "traveler-blue" },
    { name: "서연", color: "traveler-violet" },
    { name: "지우", color: "traveler-orange" },
];

function TimeBars({ times }: { times: number[] }) {
    return (
        <div className="time-bars">
            {travelers.map((traveler, index) => (
                <div className="time-bar-row" key={traveler.name}>
                    <span>{traveler.name}</span>
                    <div><i className={`${traveler.color} time-${times[index]}`} /></div>
                    <strong>{times[index]}분</strong>
                </div>
            ))}
        </div>
    );
}

const midpointCandidates = [
    {
        name: "건대입구역", lines: [2, 7], average: "30분", difference: "6분", fare: "1,550원", times: [31, 27, 33, 29],
        explanation: "네 명의 이동시간 차이가 가장 작아 1순위로 추천했어요. 모두 환승 1회 이하로 도착해요.",
    },
    {
        name: "종로3가역", lines: [1, 3, 5], average: "33분", difference: "14분", fare: "1,600원", times: [24, 38, 32, 36],
        explanation: "민지님은 가장 가깝지만 준호님과 14분 차이가 나요.",
    },
    {
        name: "왕십리역", lines: [2, 5], average: "30분", difference: "16분", fare: "1,575원", times: [28, 22, 30, 38],
        explanation: "준호님은 22분으로 빠르지만 지우님이 38분 걸려요.",
    },
];

function MidpointResultsScreen({
                                   goBack,
                                   onShare,
                               }: {
    goBack: () => void;
    onShare: (station: string) => void;
}) {
    const [expandedStation, setExpandedStation] = useState("건대입구역");
    return (
        <Phone hideNav>
            <Header title="추천 중간역" back onBack={goBack} action={<Icon>ios_share</Icon>} />
            <div className="result-subtitle">4명 · 10.18(토) 17:00 출발 · 편차 최소 · 환승 1회 이하</div>
            <div className="candidate-list">
                {midpointCandidates.map((candidate, index) => {
                    const expanded = expandedStation === candidate.name;
                    return (
                        <div
                            className={`rank-card ${expanded ? "first-rank expanded-candidate" : "compact-rank folded-candidate"}`}
                            key={candidate.name}
                            role="button"
                            tabIndex={0}
                            onClick={() => setExpandedStation(candidate.name)}
                            onKeyDown={(event) => { if (event.key === "Enter") setExpandedStation(candidate.name); }}
                        >
                            <div className="rank-header">
                                <div><span className={`rank-label${expanded ? "" : " secondary"}`}>{index + 1}순위</span><strong>{candidate.name}</strong><div>{candidate.lines.map((line) => <LineBadge line={line} small key={line} />)}</div></div>
                                {expanded ? <Icon>expand_less</Icon> : <b>차이 {candidate.difference}</b>}
                            </div>
                            {expanded && (
                                <div className="candidate-expanded-content">
                                    <div className="rank-stats">
                                        <div><span>평균</span><strong>{candidate.average}</strong></div>
                                        <div><span>최대 차이</span><strong>{candidate.difference}</strong></div>
                                        <div><span>평균 요금</span><strong>{candidate.fare}</strong></div>
                                    </div>
                                    <TimeBars times={candidate.times} />
                                    <div className="calculation-explain">
                                        <div><AiChip /><strong>계산 결과 설명</strong></div>
                                        <p>{candidate.explanation}</p>
                                        <span>경로 계산 결과를 AI가 설명했어요</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <Button className="result-share-button" onClick={() => onShare(expandedStation)}><Icon>send</Icon>{expandedStation}으로 약속방에 공유</Button>
        </Phone>
    );
}

const roomMembers = [
    { avatar: "민", name: "민지", station: "홍대입구", lines: [2], minutes: 31, crowd: "혼잡" as CrowdLevel },
    { avatar: "준", name: "준호", station: "잠실", lines: [2], minutes: 27, crowd: "보통" as CrowdLevel },
    { avatar: "서", name: "서연", station: "노원", lines: [7], minutes: 33, crowd: "보통" as CrowdLevel },
    { avatar: "지", name: "지우", station: "신림", lines: [2], minutes: 29, crowd: "여유" as CrowdLevel },
];

function MeetingRoomScreen({
                               goBack,
                               station,
                               onChangeStation,
                               onOpenRoute,
                               meeting,
                           }: {
    goBack: () => void;
    station: string;
    onChangeStation: () => void;
    onOpenRoute: () => void;
    meeting: Meeting | null;
}) {
    const [toast, setToast] = useState(false);
    const [selectedMember, setSelectedMember] = useState<number | null>(null);
    const [message, setMessage] = useState("");
    const [newMessages, setNewMessages] = useState<Array<{ type: "mine" | "ai"; text: string }>>([]);
    const stationLines: Record<string, number[]> = { 건대입구역: [2, 7], 종로3가역: [1, 3, 5], 왕십리역: [2, 5] };

    const copyCode = async () => {
        try { await navigator.clipboard?.writeText("LR-4821"); } catch { /* Preview may not grant clipboard permission. */ }
        setToast(true);
        window.setTimeout(() => setToast(false), 1800);
    };

    const sendMessage = () => {
        const trimmed = message.trim();
        if (!trimmed) return;
        setNewMessages((current) => [...current, { type: "mine", text: trimmed }]);
        setMessage("");
        if (trimmed.startsWith("@AI")) {
            window.setTimeout(() => {
                setNewMessages((current) => [...current, { type: "ai", text: `노원에서 ${station}까지 약 33분 걸려요. 17:25 전에 출발하면 여유 있게 도착해요.` }]);
            }, 1000);
        }
    };

    return (
        <Phone hideNav>
            <Header title="약속방" back onBack={goBack} action={<button className="code-chip" onClick={copyCode}>LR-4821 <Icon size="sm">content_copy</Icon></button>} />
            <div className="meeting-summary">
                <div className="meeting-top">
                    <div><span>{meeting ? `D-${Math.max(0, Math.ceil((new Date(meeting.datetime).getTime() - Date.now()) / 86400000))}` : "NEW"}</span><strong>{meeting?.title ?? "새 약속"}</strong><p>{meeting ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(new Date(meeting.datetime)) : "약속 정보를 정해주세요"}</p></div>
                    <Icon>celebration</Icon>
                </div>
                <button className="confirmed-station" onClick={onChangeStation}>
                    <span>확정 역</span><strong>{station}</strong>{(stationLines[station] ?? [2, 7]).map((line) => <LineBadge line={line} small key={line} />)}<b>변경</b>
                </button>
                <div className="meeting-members">
                    {roomMembers.map((member, index) => (
                        <button key={member.name} onClick={() => setSelectedMember(index)}><i className={`meeting-avatar member-avatar-${index + 1}`}>{member.avatar}</i><strong>{member.name}</strong><span>{member.station}</span></button>
                    ))}
                </div>
            </div>
            <div className="chat-date"><span>오늘</span></div>
            <div className="chat-thread">
                <div className="message-row">
                    <div className="chat-avatar member-avatar-3">서</div>
                    <div><strong className="sender-name">서연</strong><div className="chat-bubble other"><b>@AI</b> 나 노원에서 몇 시에 출발하면 돼?</div><span className="message-time">14:12</span></div>
                </div>
                <div className="message-row ai-message-row">
                    <div className="chat-avatar ai-avatar"><Icon size="sm">auto_awesome</Icon></div>
                    <div>
                        <strong className="sender-name ai-name">LinkRo AI</strong>
                        <div className="chat-bubble ai-chat">
                            서연님은 노원에서 7호선으로 한 번에 가요. 약 33분 걸리니 <strong>17:25 전에 출발</strong>하면 6시 전에 도착해요.
                            <button className="route-chat-chip" onClick={onOpenRoute}><LineBadge line={7} small /><span>노원 → {station.replace("역", "")} · 33분</span><Congestion level="보통" compact /></button>
                            <small>앱 경로 계산 결과 기준</small>
                        </div>
                        <span className="message-time">14:12</span>
                    </div>
                </div>
                <div className="my-message">
                    <div className="chat-bubble mine">좋아 그럼 6시에 7번 출구 앞!</div>
                    <span className="message-time">14:14</span>
                </div>
                {newMessages.map((item, index) => item.type === "mine" ? (
                    <div className="my-message" key={`${item.type}-${index}`}>
                        <div className="chat-bubble mine">{item.text}</div><span className="message-time">방금</span>
                    </div>
                ) : (
                    <div className="message-row ai-message-row new-chat" key={`${item.type}-${index}`}>
                        <div className="chat-avatar ai-avatar"><Icon size="sm">auto_awesome</Icon></div>
                        <div><strong className="sender-name ai-name">LinkRo AI</strong><div className="chat-bubble ai-chat">{item.text}<button className="route-chat-chip" onClick={onOpenRoute}><LineBadge line={7} small /><span>노원 → {station.replace("역", "")} · 33분</span><Congestion level="보통" compact /></button></div></div>
                    </div>
                ))}
            </div>
            <div className="message-input">
                <button aria-label="추가"><Icon>add</Icon></button>
                <input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") sendMessage(); }} placeholder="메시지 또는 @AI에게 질문" />
                <button className="send-message" aria-label="전송" onClick={sendMessage}><Icon>arrow_upward</Icon></button>
            </div>
            {selectedMember !== null && (
                <BottomSheet onClose={() => setSelectedMember(null)} className="member-route-sheet">
                    <div className="member-route-title">
                        <div className={`member-avatar member-avatar-${selectedMember + 1}`}>{roomMembers[selectedMember].avatar}</div>
                        <div><strong>{roomMembers[selectedMember].name}님의 경로</strong><span>{roomMembers[selectedMember].station} 출발</span></div>
                    </div>
                    <div className="member-route-summary">
                        <div>{roomMembers[selectedMember].lines.map((line) => <LineBadge line={line} key={line} />)}<strong>{roomMembers[selectedMember].station} → {station}</strong></div>
                        <span>{roomMembers[selectedMember].minutes}분</span>
                    </div>
                    <div className="member-route-meta"><span>환승 {selectedMember === 2 ? 0 : 1}회</span><Congestion level={roomMembers[selectedMember].crowd} /></div>
                </BottomSheet>
            )}
            {toast && <Toast>방 코드가 복사됐어요</Toast>}
        </Phone>
    );
}

function JoinRoomScreen({
                            navigate,
                            goBack,
                        }: {
    navigate: (screen: ScreenId) => void;
    goBack: () => void;
}) {
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const submitCode = async () => {
        try {
            await joinRoom(code);
            navigate("room");
        } catch {
            setError("존재하지 않는 방 코드예요");
        }
    };
    return (
        <Phone hideNav>
            <Header title="약속방 입장" back onBack={goBack} />
            <div className="join-room">
                <div className="join-visual">
                    <div><Icon size="lg">group</Icon></div>
                    <strong>친구들의 약속방에<br />참여해 보세요</strong>
                    <span>공유받은 6자리 방 코드를 입력하면 돼요</span>
                </div>
                <label className="room-code-label" htmlFor="room-code">방 코드</label>
                <div className={`room-code-slots${error ? " error" : ""}`}>
                    {Array.from({ length: 6 }, (_, index) => <span key={index}>{code[index] ?? ""}</span>)}
                    <input
                        id="room-code"
                        maxLength={6}
                        value={code}
                        onChange={(event) => { setError(""); setCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()); }}
                        autoComplete="off"
                        aria-label="6자리 방 코드"
                    />
                </div>
                {error && <div className="room-code-error">{error}</div>}
                <Button className="join-button" disabled={code.length !== 6} onClick={submitCode}>입장하기</Button>
                <div className="or-divider"><span>또는</span></div>
                <Button variant="secondary" className="create-room-button" onClick={() => { void createRoom(); navigate("room"); }}><Icon>add</Icon>새 약속방 만들기</Button>
            </div>
        </Phone>
    );
}

function StationSearchScreen({
                                 goBack,
                                 onSelect,
                             }: {
    goBack: () => void;
    onSelect: (station: Station) => void;
}) {
    const [query, setQuery] = useState("");
    const filtered = mockData.stations.filter((station) => station.name.includes(query.trim()));
    return (
        <Phone hideNav>
            <Header title="역 검색" back onBack={goBack} />
            <div className="full-station-search"><Icon>search</Icon><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="역 이름을 검색하세요" /></div>
            {!query ? (
                <div className="recent-search-empty"><Icon>history</Icon><strong>최근 검색한 역이 없어요</strong><span>역 이름을 검색해 이동을 시작해보세요</span></div>
            ) : (
                <div className="station-search-results">
                    {filtered.map((station) => (
                        <button key={station.id} onClick={() => onSelect(station)}>
                            <Icon>train</Icon><strong>{station.name}</strong><span>{station.lines.map((line) => <LineBadge line={line} size="sm" key={line} />)}</span>
                        </button>
                    ))}
                </div>
            )}
        </Phone>
    );
}

function MeetingListScreen({
                               navigate,
                               mode,
                               meetings,
                               onRetry,
                               onOpenMeeting,
                               onCreate,
                           }: {
    navigate: (screen: ScreenId) => void;
    mode: DataMode;
    meetings: Meeting[];
    onRetry: () => void;
    onOpenMeeting: (meetingId: string) => void;
    onCreate: () => void;
}) {
    return (
        <Phone nav="약속방" onNavigate={navigate}>
            <Header title="약속방" action={<button className="join-code-action" onClick={() => navigate("join")}>코드로 입장</button>} />
            <div className="meeting-list-screen">
                {mode === "loading" ? <><MeetingCard skeleton /><MeetingCard skeleton /></> :
                    mode === "error" ? <ErrorState message="약속방을 불러오지 못했어요" onRetry={onRetry} /> :
                        meetings.length === 0 ? <EmptyState icon="forum" message="참여 중인 약속방이 없어요" actionLabel="약속방 만들기" onAction={onCreate} /> :
                            <div className="meeting-card-list">{[...meetings].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()).map((meeting) => <MeetingCard meeting={meeting} onClick={onOpenMeeting} key={meeting.id} />)}</div>}
            </div>
            <button className="new-room-fab" onClick={onCreate}><Icon>add</Icon>새 약속방</button>
        </Phone>
    );
}

function NotificationsScreen({ goBack, mode, notifications, onRetry }: { goBack: () => void; mode: DataMode; notifications: Notification[]; onRetry: () => void }) {
    return (
        <Phone hideNav>
            <Header title="알림" back onBack={goBack} action={<span className="notification-read">모두 읽음</span>} />
            <div className="notification-list">
                {mode === "loading" ? <><div className="notification-skeleton" /><div className="notification-skeleton" /></> :
                    mode === "error" ? <div className="list-state"><Icon>error</Icon><strong>알림을 불러오지 못했어요</strong><Button variant="text" onClick={onRetry}>다시 시도</Button></div> :
                        notifications.length === 0 ? <div className="list-state"><Icon>notifications_off</Icon><strong>새 알림이 없어요</strong><span>약속 소식이 생기면 알려드릴게요</span></div> :
                            notifications.map((notification) => (
                                <div key={notification.id}>
                                    <span className="notification-icon mint"><Icon>notifications</Icon></span>
                                    <section><strong>{notification.message}</strong><small>{notification.createdAt}</small></section>
                                    {!notification.isRead && <i />}
                                </div>
                            ))}
            </div>
        </Phone>
    );
}

function MyScreen({ navigate, replay, user }: { navigate: (screen: ScreenId) => void; replay: () => void; user: User | null }) {
    return (
        <Phone nav="마이" onNavigate={navigate}>
            <Header title="MY" />
            <div className="my-empty">
                <div>{user?.name.slice(0, 1) ?? "?"}</div>
                <strong>{user?.name ?? "게스트"}</strong>
                <Button variant="secondary" onClick={replay}>온보딩 다시 보기</Button>
            </div>
        </Phone>
    );
}

function RouteCard({
                       featured,
                       lines,
                       time,
                       arrival,
                       transfer,
                       crowd,
                   }: {
    featured?: boolean;
    lines: number[];
    time: number;
    arrival: string;
    transfer: string;
    crowd: CrowdLevel;
}) {
    return (
        <div className={`route-card${featured ? " featured" : ""}`}>
            <div className="route-card-top">
                <div>{featured && <span className="best-chip"><Icon size="sm">bolt</Icon>추천</span>}</div>
                <span className="arrival-time">{arrival} 도착</span>
            </div>
            <div className="route-main">
                <div><strong className="route-time">{time}</strong><span className="minutes">분</span></div>
                <Congestion level={crowd} compact />
            </div>
            <div className="route-path">
                {lines.map((line, index) => (
                    <div className="route-line-unit" key={`${line}-${index}`}>
                        <LineBadge line={line} small />
                        {index < lines.length - 1 && <span className="path-line" />}
                    </div>
                ))}
                <strong>{transfer}</strong>
            </div>
            <div className="route-meta">
                <span>도보 8분</span><i /><span>₩1,400</span><i /><span>14개 역</span>
            </div>
        </div>
    );
}

function ResultsScreen() {
    return (
        <Phone nav="경로">
            <Header title="추천 경로" back action={<Icon>tune</Icon>} />
            <div className="route-summary">
                <div><span>출발</span><strong>신도림역</strong></div>
                <Icon>arrow_forward</Icon>
                <div><span>도착</span><strong>성수역</strong></div>
            </div>
            <div className="filter-chips">
                <span className="selected">추천순</span><span>최소 시간</span><span>최소 환승</span>
            </div>
            <div className="route-list">
                <RouteCard featured lines={[2]} time={39} arrival="오후 2:24" transfer="환승 없음" crowd="보통" />
                <RouteCard lines={[1, 2]} time={42} arrival="오후 2:27" transfer="신도림 환승 1회" crowd="혼잡" />
                <RouteCard lines={[7, 2]} time={47} arrival="오후 2:32" transfer="대림 환승 1회" crowd="여유" />
            </div>
        </Phone>
    );
}

function JourneyScreen() {
    return (
        <Phone nav="경로">
            <Header title="이동 중" action={<span className="end-trip">안내 종료</span>} />
            <div className="journey-hero">
                <div className="live-chip"><i /> 실시간 안내</div>
                <p>다음 역</p>
                <div className="next-station">
                    <LineBadge line={2} />
                    <div><strong>문래</strong><span>3분 후 도착</span></div>
                </div>
                <div className="station-progress">
                    <div className="progress-line"><i /><i /><i /></div>
                    <div><span>신도림</span><strong>문래</strong><span>영등포구청</span></div>
                </div>
            </div>
            <div className="journey-stats">
                <div><span>남은 시간</span><strong>32분</strong></div>
                <div><span>남은 역</span><strong>12개</strong></div>
                <div><span>도착 예정</span><strong>14:24</strong></div>
            </div>
            <div className="section-title spacing-top">지금 열차 정보</div>
            <div className="train-card">
                <div className="train-row">
                    <div><div className="soft-icon mint"><Icon>train</Icon></div><strong>2394 열차</strong></div>
                    <Congestion level="보통" />
                </div>
                <div className="car-recommend">
                    <div className="car-badge">4-3</div>
                    <div><strong>4-3칸 탑승을 추천해요</strong><span>성수역 출구와 가장 가까워요</span></div>
                    <Icon size="sm">chevron_right</Icon>
                </div>
            </div>
            <div className="alert-card">
                <Icon>notifications_active</Icon>
                <div><strong>내리기 전에 알려드릴게요</strong><span>성수역 도착 2분 전 알림</span></div>
                <div className="toggle"><i /></div>
            </div>
        </Phone>
    );
}

function AiChip() {
    return <span className="ai-chip"><Icon size="sm">auto_awesome</Icon>AI</span>;
}

function AiScreen() {
    return (
        <Phone nav="경로">
            <Header title="AI 이동 도우미" back action={<AiChip />} />
            <div className="ai-intro">
                <div className="ai-orb"><Icon size="lg">auto_awesome</Icon></div>
                <p>링크로 AI가 분석했어요</p>
                <div className="ai-title">덜 붐비고 편안한<br />경로를 찾았어요</div>
            </div>
            <div className="ai-answer">
                <div className="ai-answer-top">
                    <div><LineBadge line={2} /><strong>2호선 직행</strong></div>
                    <span>39분</span>
                </div>
                <div className="ai-reason">
                    <div className="reason-row"><Icon>chair</Icon><div><strong>앉아갈 가능성 78%</strong><span>앞 열차보다 여유로워요</span></div></div>
                    <div className="reason-row"><Icon>directions_walk</Icon><div><strong>2-2칸에서 탑승하세요</strong><span>신도림 2번 출구에서 가장 가까워요</span></div></div>
                    <div className="reason-row"><Icon>schedule</Icon><div><strong>4분 뒤 열차가 더 좋아요</strong><span>도착은 2분 차이, 혼잡도는 한 단계 낮아요</span></div></div>
                </div>
                <div className="ai-crowd-row">
                    <span>예상 혼잡도</span><Congestion level="여유" />
                </div>
            </div>
            <div className="ai-notice"><Icon size="sm">info</Icon><span>실시간 운행·혼잡 데이터를 바탕으로 추천했어요.</span></div>
            <button className="primary-button ai-button"><Icon>route</Icon>이 경로로 안내 시작</button>
        </Phone>
    );
}

function TogetherScreen() {
    return (
        <Phone nav="함께">
            <Header title="함께 만나기" back action={<Icon>ios_share</Icon>} />
            <div className="together-hero">
                <div className="together-title-row">
                    <div><p>우리의 중간역</p><div className="together-station">고속터미널역</div></div>
                    <div className="meet-icon"><Icon size="lg">diversity_3</Icon></div>
                </div>
                <div className="station-badges"><LineBadge line={3} /><LineBadge line={7} /><LineBadge line={8} /></div>
                <div className="meet-meta"><span>평균 34분</span><i /><span>환승 최대 1회</span></div>
            </div>
            <div className="section-row together-heading">
                <div className="section-title">친구들의 이동</div>
                <span className="arrival-pill">14:30 만남</span>
            </div>
            <div className="friend-routes">
                <div className="friend-row">
                    <div className="avatar avatar-1">나</div>
                    <div className="friend-info"><div><strong>신도림역</strong><span>34분</span></div><div className="friend-path"><LineBadge line={2} small /><span /><LineBadge line={3} small /></div></div>
                </div>
                <div className="friend-row">
                    <div className="avatar avatar-2">지수</div>
                    <div className="friend-info"><div><strong>노원역</strong><span>37분</span></div><div className="friend-path"><LineBadge line={7} small /></div></div>
                </div>
                <div className="friend-row">
                    <div className="avatar avatar-3">민호</div>
                    <div className="friend-info"><div><strong>잠실역</strong><span>31분</span></div><div className="friend-path"><LineBadge line={8} small /></div></div>
                </div>
            </div>
            <div className="meet-place">
                <div className="place-icon"><Icon>local_cafe</Icon></div>
                <div><span>추천 만남 장소</span><strong>센트럴시티 1층 분수대</strong><p>모든 노선에서 찾기 쉬운 곳이에요</p></div>
                <Icon size="sm">chevron_right</Icon>
            </div>
            <button className="primary-button mint-button"><Icon>send</Icon>친구들에게 공유하기</button>
        </Phone>
    );
}

export default function App(_props: { dom?: import('expo/dom').DOMProps }) {
    useEffect(() => {
        const id = "material-symbols-font";

        if (!document.getElementById(id)) {
            const link = document.createElement("link");
            link.id = id;
            link.rel = "stylesheet";
            link.href =
                "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&display=swap";

            document.head.appendChild(link);
        }

        if (document.fonts?.load) {
            document.fonts
                .load('24px "Material Symbols Rounded"')
                .catch(() => {});
        }
    }, []);

    const isHomeCompare = window.location.pathname === "/home-compare";
    const [history, setHistory] = useState<ScreenId[]>(isHomeCompare ? ["home"] : ["splash"]);
    const [journey, setJourney] = useState<JourneyInfo>({ from: "", to: "", minutes: 0, arrival: "" });
    const [confirmedStation, setConfirmedStation] = useState(mockData.meetings[0]?.confirmedStation?.name ?? "");
    const [cameraPermission, setCameraPermission] = useState<CameraPermission>("notDetermined");
    const [dataMode, setDataMode] = useState<DataMode>("success");
    const [hasUnreadNotifications, setHasUnreadNotifications] = useState(mockData.notifications.some((notification) => !notification.isRead));
    const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
    const current = history[history.length - 1];

    const navigate = (screen: ScreenId) => {
        if (screen === current) return;
        setHistory((previous) => [...previous, screen]);
    };

    const navigateMain = (screen: ScreenId) => {
        if (screen === "route") setJourney({ from: "", to: "", minutes: 0, arrival: "" });
        navigate(screen);
    };

    const goBack = () => {
        setHistory((previous) => previous.length > 1 ? previous.slice(0, -1) : previous);
    };

    const retryData = () => {
        setDataMode("loading");
        void Promise.all([fetchActiveMeetings(), fetchNotifications()]).finally(() => {
            window.setTimeout(() => setDataMode("success"), 500);
        });
    };

    const openDirection = async () => {
        if (cameraPermission === "notDetermined") {
            const permission = await requestCameraPermission();
            setCameraPermission(permission);
        }
        setJourney({
            from: mockData.routePreview.from.name,
            to: mockData.routePreview.to.name,
            minutes: mockData.routePreview.minutes,
            arrival: mockData.routePreview.arrival,
        });
        navigate("direction");
    };

    const renderScreen = () => {
        switch (current) {
            case "splash": return <SplashScreen onDone={() => setHistory([localStorage.getItem("hasSeenOnboarding") === "true" ? "home" : "onboarding"])} />;
            case "onboarding": return (
                <OnboardingScreen
                    onSkip={() => { localStorage.setItem("hasSeenOnboarding", "true"); setHistory(["permission"]); }}
                    onComplete={() => { localStorage.setItem("hasSeenOnboarding", "true"); setHistory(["permission"]); }}
                />
            );
            case "permission": return <PermissionScreen onFinish={(permission) => { setCameraPermission(permission); setHistory(["login"]); }} />;
            case "login": return <LoginScreen onKakao={() => setHistory(["home"])} />;
            case "station-search": return (
                <StationSearchScreen
                    goBack={goBack}
                    onSelect={(station) => {
                        setJourney({ from: "", to: station.name, minutes: 0, arrival: "" });
                        navigate("route");
                    }}
                />
            );
            case "route": return (
                <SearchScreen
                    navigate={navigateMain}
                    goBack={goBack}
                    initialJourney={journey}
                    onStart={(selectedJourney) => {
                        setJourney(selectedJourney);
                        navigate("direction");
                    }}
                />
            );
            case "direction": return (
                <AiDirectionScreen
                    journey={journey}
                    cameraBlocked={cameraPermission === "denied"}
                    onClose={() => setHistory((previous) => [...previous.slice(0, -1), "route"])}
                />
            );
            case "midpoint": return <MidpointInputScreen navigate={navigateMain} goBack={goBack} />;
            case "results": return (
                <MidpointResultsScreen
                    goBack={goBack}
                    onShare={(station) => {
                        setConfirmedStation(station);
                        navigate("room");
                    }}
                />
            );
            case "room": return (
                <MeetingRoomScreen
                    goBack={goBack}
                    station={confirmedStation}
                    onChangeStation={() => navigate("results")}
                    onOpenRoute={() => {
                        setJourney({ from: "노원", to: confirmedStation.replace("역", ""), minutes: 33, arrival: "18:00" });
                        navigate("route");
                    }}
                    meeting={mockData.meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null}
                />
            );
            case "join": return <JoinRoomScreen navigate={navigate} goBack={goBack} />;
            case "meeting-list": return (
                <MeetingListScreen
                    navigate={navigateMain}
                    mode={dataMode}
                    meetings={dataMode === "success" ? mockData.meetings : []}
                    onRetry={retryData}
                    onOpenMeeting={(meetingId) => { setSelectedMeetingId(meetingId); navigate("room"); }}
                    onCreate={() => { void createRoom(); setSelectedMeetingId(null); navigate("room"); }}
                />
            );
            case "notifications": return <NotificationsScreen goBack={goBack} mode={dataMode} notifications={dataMode === "success" ? mockData.notifications : []} onRetry={retryData} />;
            case "my": return <MyScreen navigate={navigateMain} user={dataMode === "success" ? mockData.user : null} replay={() => { localStorage.removeItem("hasSeenOnboarding"); setHistory(["onboarding"]); }} />;
            default: {
                const homeProps = {
                    navigate: navigateMain,
                    dataMode,
                    meetings: dataMode === "success" ? mockData.meetings : [],
                    hasUnreadNotifications,
                    onOpenNotifications: () => { setHasUnreadNotifications(false); navigate("notifications"); },
                    onOpenDirection: openDirection,
                    onOpenMeeting: (meetingId: string) => { setSelectedMeetingId(meetingId); navigate("room"); },
                    onCreateRoom: () => { void createRoom(); setSelectedMeetingId(null); navigate("room"); },
                    onRetry: retryData,
                };

                if (!isHomeCompare) return <Home_V1 {...homeProps} />;

                return (
                    <div className="home-comparison">
                        <section className="home-version">
                            <div className="home-version-label"><strong>Home V1</strong><span>Current</span></div>
                            <Home_V1 {...homeProps} />
                        </section>
                        <section className="home-version">
                            <div className="home-version-label"><strong>Home V2</strong><span>Alternative</span></div>
                            <Home_V2 {...homeProps} />
                        </section>
                    </div>
                );
            }
        }
    };

    return (
        <main className="prototype-stage">
            <div className="prototype-phone" key={`${current}-${history.length}`}>
                {renderScreen()}
            </div>
            {false && current !== "splash" && !isHomeCompare && (
                <div className="dev-state-toggle">
                    <span>DEV</span>
                    {(["loading", "empty", "success", "error"] as DataMode[]).map((mode) => <button className={dataMode === mode ? "active" : ""} onClick={() => setDataMode(mode)} key={mode}>{mode}</button>)}
                </div>
            )}
        </main>
    );
}
