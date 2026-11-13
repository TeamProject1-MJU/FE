// 실행: node --test scripts/verify-api-client.cjs (node scripts/verify-api-client.cjs 도 같은 검사를 돌려요)
// 설치된 TypeScript와 Node 기본 모듈로만 검사하며 실제 서버를 호출하지 않습니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function createRuntime(env = {}, react = require('react')) {
    const cache = new Map();
    const timers = new Map();
    let timerId = 0;
    let now = 0;
    const context = vm.createContext({
        process: { env },
        AbortController, FormData, Blob,
        URL, TextEncoder, TextDecoder, atob, __DEV__: false,
        console,
        fetch: async () => { throw new Error('검사에서 지정하지 않은 요청입니다.'); },
        setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms, due: now + ms }); return id; },
        clearTimeout: id => timers.delete(id),
        // 도착정보 폴링 검사용 반복 타이머예요. 같은 가상 시계(advance)로 움직여요.
        setInterval: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms, due: now + ms, repeat: true }); return id; },
        clearInterval: id => timers.delete(id),
    });
    const native = {
        AppState: {
            currentState: 'active', listeners: new Set(),
            addEventListener(_event, listener) { this.listeners.add(listener); return { remove: () => this.listeners.delete(listener) }; },
            change(state) { this.currentState = state; for (const listener of [...this.listeners]) listener(state); },
        },
        StyleSheet: { create: value => value },
        Platform: { OS: 'web', select: value => value.web },
        Keyboard: { dismiss() {} },
    };
    for (const name of ['ActivityIndicator', 'FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'Text', 'TextInput', 'View']) native[name] = name;
    const external = {
        react,
        'react/jsx-runtime': require('react/jsx-runtime'),
        'react-native': native,
        'expo-router': { router: { canDismiss: () => false, canGoBack: () => false, replace() {}, push() {} }, useLocalSearchParams: () => ({}) },
        'expo-status-bar': { StatusBar: 'StatusBar' },
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
        '@expo/vector-icons/Ionicons': 'Ionicons',
        'react-native-webview': { WebView: 'WebView' },
        'expo-location': {
            Accuracy: { Balanced: 3 },
            getForegroundPermissionsAsync: async () => ({ granted: false }),
            requestForegroundPermissionsAsync: async () => ({ granted: false }),
            getCurrentPositionAsync: async () => { throw Error('위치 응답을 지정하세요'); },
        },
        'expo-image-picker': { requestCameraPermissionsAsync: async () => ({ granted: false }) },
    };
    Object.defineProperty(external, '@stomp/stompjs', { get() {
            const module = { exports: {} };
            const source = fs.readFileSync(require.resolve('@stomp/stompjs'), 'utf8');
            new vm.Script(`(function(exports, module) { ${source}\n})`).runInContext(context)(module.exports, module);
            return module.exports;
        } });

    function load(relative) {
        const base = path.resolve(root, relative);
        const filename = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        assert.ok(filename, `검사할 파일을 찾지 못했어요: ${relative}`);
        if (cache.has(filename)) return cache.get(filename).exports;
        const module = { exports: {} };
        cache.set(filename, module);
        const source = fs.readFileSync(filename, 'utf8');
        const code = ts.transpileModule(source + (relative === 'src/services/route.ts' ? '\nexport { parseRouteSearch as __parseRouteSearch };' : ''), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        }).outputText;
        const evaluate = new vm.Script(`(function(require, module, exports) { ${code}\n})`, { filename }).runInContext(context);
        evaluate(id => {
            if (id.startsWith('@/')) return load(`src/${id.slice(2)}`);
            assert.ok(Object.hasOwn(external, id), `예상하지 못한 모듈입니다: ${id}`);
            return external[id];
        }, module, module.exports);
        return module.exports;
    }
    function advance(ms) {
        const target = now + ms;
        while (true) {
            const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
            if (!next) break;
            timers.delete(next[0]);
            if (next[1].repeat) timers.set(next[0], { ...next[1], due: next[1].due + next[1].ms });
            now = next[1].due;
            next[1].callback();
        }
        now = target;
    }
    return { load, context, timers, advance, external, native, now: () => now };
}

const serverEnv = { EXPO_PUBLIC_API_BASE_URL: ' https://example.test/api/v1/// ', EXPO_PUBLIC_USE_MOCK: 'false' };
const jsonResponse = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) });
const plain = value => JSON.parse(JSON.stringify(value));

const map126Bounds = { minLng: 126.9, minLat: 37.4, maxLng: 127.2, maxLat: 37.7 };

function webMap126Fixture() {
    const scripts = []; const overlays = []; const centers = []; const events = new Map();
    let loadCallback; let map; let clears = 0; let relayouts = 0;
    const doc = {
        getElementById: id => scripts.find(script => script.id === id) ?? null,
        createElement: tag => {
            const listeners = new Map();
            return { tagName: tag, style: {}, addEventListener: (event, fn) => listeners.set(event, fn),
                removeEventListener: (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event); },
                emit: event => listeners.get(event)?.(), listenerCount: () => listeners.size,
                remove() { scripts.splice(scripts.indexOf(this), 1); } };
        },
        head: { appendChild: el => scripts.push(el) },
    };
    class LatLng {
        constructor(lat, lng) { this.lat = lat; this.lng = lng; }
        getLat() { return this.lat; } getLng() { return this.lng; }
    }
    const sdk = {
        LatLng, load: fn => { loadCallback = fn; },
        Map: class {
            constructor(_node, options) { map = this; this.center = options.center; }
            setCenter(point) { centers.push(point); this.center = point; }
            getCenter() { return this.center; }
            relayout() { relayouts++; }
            getBounds() { return { getSouthWest: () => new LatLng(37.4, 126.9), getNorthEast: () => new LatLng(37.7, 127.2) }; }
        },
        CustomOverlay: class { constructor(options) { this.options = options; overlays.push(this); } setMap(value) { this.detached = value === null; } },
        event: { addListener: (_map, name, fn) => events.set(name, fn), removeListener: (_map, name, fn) => { if (events.get(name) === fn) events.delete(name); } },
    };
    const host = { document: doc };
    const container = { ownerDocument: doc, replaceChildren: () => { clears++; } };
    const point = { latitude: 37.5, longitude: 127 };
    const state = { center: point, myLocation: point, centerRevision: 0, markers: [{ ...point, id: 1, isSupported: true }, { ...point, id: 2, isSupported: false }] };
    return { host, sdk, scripts, overlays, centers, events, container, state,
        load() { host.kakao = { maps: sdk }; scripts[0].emit('load'); }, finishLoad: () => loadCallback(),
        clears: () => clears, map: () => map, relayouts: () => relayouts };
}

test('126 web SDK URL encoding, single shared script, and maps.load completion', async () => {
    const r = createRuntime(); const { mapSdkUrl, loadMapSdk } = r.load('src/components/map/map-web.ts');
    const f = webMap126Fixture();
    const url = new URL(mapSdkUrl(' a&?한글 '));
    assert.equal(url.origin, 'https://dapi.kakao.com'); assert.equal(url.searchParams.get('appkey'), 'a&?한글');
    assert.equal(url.searchParams.get('autoload'), 'false');
    const first = loadMapSdk('key', f.host); const second = loadMapSdk('key', f.host);
    assert.equal(first, second); assert.equal(f.scripts.length, 1);
    let finished = false; void first.then(() => { finished = true; });
    f.load(); await settle(); assert.equal(finished, false);
    f.finishLoad(); assert.equal(await first, f.sdk); assert.equal(await second, f.sdk);
    assert.equal(f.scripts[0].listenerCount(), 0); assert.equal(r.timers.size, 0);
    assert.equal(await loadMapSdk('key', f.host), f.sdk); assert.equal(f.scripts.length, 1);
});

test('126 web SDK missing key, network failure, missing SDK and timeout allow safe retry', async () => {
    for (const mode of ['network', 'missing', 'timeout', 'callback-timeout']) {
        const r = createRuntime(); const { loadMapSdk } = r.load('src/components/map/map-web.ts'); const f = webMap126Fixture();
        await assert.rejects(loadMapSdk('', f.host)); assert.equal(f.scripts.length, 0);
        const pending = loadMapSdk('key', f.host); const rejection = assert.rejects(pending);
        if (mode === 'network') f.scripts[0].emit('error');
        if (mode === 'missing') f.scripts[0].emit('load');
        if (mode === 'callback-timeout') f.load();
        if (mode.includes('timeout')) { r.advance(14999); assert.equal(f.scripts.length, 1); r.advance(1); }
        await rejection; assert.equal(f.scripts.length, 0); assert.equal(r.timers.size, 0);
        if (mode === 'callback-timeout') f.finishLoad(); // Timed-out completion cannot revive the old request.
        const retry = loadMapSdk('key', f.host);
        if (!f.host.kakao) f.load();
        f.finishLoad(); assert.equal(await retry, f.sdk);
    }
});

test('126 web map state validation and bbox conversion preserve native marker semantics', () => {
    const r = createRuntime(); const { validMapState, mapBounds, createWebMap } = r.load('src/components/map/map-web.ts');
    const f = webMap126Fixture();
    assert.equal(validMapState(f.state), true);
    for (const change of [{ center: { latitude: NaN, longitude: 127 } }, { myLocation: {} }, { centerRevision: 1.5 }, { markers: [{}] },
        { markers: [{ ...f.state.markers[0], isSupported: 'true' }] }, { markers: Array(501).fill(f.state.markers[0]) }]) {
        assert.equal(validMapState({ ...f.state, ...change }), false);
    }
    const regions = []; let ready = 0;
    const controller = createWebMap(f.container, f.sdk, f.state, { onRegionChange: bounds => regions.push(plain(bounds)), onReady: () => ready++, onError() { assert.fail(); } });
    assert.deepEqual(plain(mapBounds(f.map())), map126Bounds); assert.deepEqual(regions, [map126Bounds]);
    assert.deepEqual(f.overlays.map(o => /background-color:([^;]+)/.exec(o.options.content.style.cssText)[1]), ['#12a77a', '#8c93a3', '#2879ef']);
    assert.deepEqual(f.overlays.map(o => o.options.zIndex), [1, 1, 2]);
    f.events.get('tilesloaded')(); assert.equal(ready, 1);
    f.events.get('idle')(); assert.equal(regions.length, 2);
    const count = f.centers.length;
    controller.update({ ...f.state, markers: [] }); assert.equal(f.centers.length, count); assert.ok(f.overlays.slice(0, 3).every(o => o.detached));
    controller.update({ ...f.state, centerRevision: 1 }); assert.equal(f.centers.length, count + 1);
    controller.update({ ...f.state, center: { latitude: 37.6, longitude: 127.1 } }); assert.equal(f.centers.at(-1).getLat(), 37.6);
    const callback = f.events.get('idle');
    controller.resize(); assert.equal(f.relayouts(), 1); assert.equal(f.centers.at(-1).getLat(), 37.6);
    const before = regions.length;
    controller.dispose(); controller.dispose(); callback(); controller.update(f.state); controller.resize();
    assert.equal(f.events.size, 0); assert.equal(f.clears(), 1); assert.equal(regions.length, before);
    assert.ok(f.overlays.every(o => o.detached));
});

test('126 web existing location timeout keeps City Hall fallback and discards late browser coordinates', async () => {
    const r = map126Runtime(); let resolve;
    r.native.Platform.OS = 'web';
    r.external['expo-location'].getForegroundPermissionsAsync = async () => ({ granted: true });
    r.external['expo-location'].getCurrentPositionAsync = () => new Promise(done => { resolve = done; });
    r.view(); await settle(); r.advance(10000); await settle();
    const { DEFAULT_MAP_CENTER, LOCATION_GUIDANCE } = r.load('src/utils/home-map.ts');
    assert.deepEqual(plain(r.view().center), plain(DEFAULT_MAP_CENTER)); assert.equal(r.view().guidance, LOCATION_GUIDANCE);
    resolve({ coords: { latitude: 37.5, longitude: 127 } }); await settle();
    assert.equal(r.view().myLocation, null); r.unmount();
});

test('126 web permission query/request timeout ignores late permission, while native waiting is unchanged', async () => {
    for (const platform of ['web', 'ios', 'android']) for (const phase of ['query', 'request']) {
        const r = map126Runtime(); r.native.Platform.OS = platform;
        let finish; let positions = 0;
        const permission = () => new Promise(resolve => { finish = resolve; });
        r.external['expo-location'].getForegroundPermissionsAsync = phase === 'query' ? permission : async () => ({ granted: false });
        r.external['expo-location'].requestForegroundPermissionsAsync = permission;
        r.external['expo-location'].getCurrentPositionAsync = async () => { positions++; return { coords: { latitude: 37.5, longitude: 127 } }; };
        r.view(); await settle();
        if (phase === 'request') { r.view().locate(); await settle(); }
        const revision = r.view().centerRevision;
        r.advance(10000); await settle();
        const { DEFAULT_MAP_CENTER, LOCATION_GUIDANCE } = r.load('src/utils/home-map.ts');
        assert.deepEqual(plain(r.view().center), plain(DEFAULT_MAP_CENTER)); assert.equal(r.view().guidance, LOCATION_GUIDANCE);
        assert.equal(r.view().centerRevision, revision + (platform === 'web' ? 1 : 0));
        finish({ granted: true }); await settle();
        assert.equal(positions, platform === 'web' ? 0 : 1);
        assert.equal(r.view().myLocation === null, platform === 'web'); r.unmount();
    }
});

test('126 bbox 쿼리·기본 size 500·상한·역 응답 파싱', async () => {
    const r = createRuntime(serverEnv); const calls = [];
    const station = plain(r.load('src/mocks/stations.ts').MOCK_STATIONS[0]);
    r.context.fetch = async url => { calls.push(new URL(url)); return jsonResponse({ success: true, data: { items: [station], page: 0, size: 500, totalElements: 501 } }); };
    const service = r.load('src/services/station.ts');
    const result = await service.fetchStationsInBounds(map126Bounds);
    assert.deepEqual(plain(result.items), [station]); assert.equal(result.totalElements, 501);
    assert.equal(calls[0].searchParams.get('bbox'), '126.9,37.4,127.2,37.7');
    assert.equal(calls[0].searchParams.get('size'), '500'); assert.equal(calls[0].searchParams.has('keyword'), false);
    await service.fetchStationsInBounds(map126Bounds, { size: 999 }); assert.equal(calls[1].searchParams.get('size'), '500');
    await service.fetchStationsInBounds(map126Bounds, { size: 12 }); assert.equal(calls[2].searchParams.get('size'), '12');
});
test('126 bbox min>=max·범위 밖·NaN·잘못된 타입은 요청 전 VALIDATION_ERROR', async () => {
    const r = createRuntime(serverEnv); let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    const service = r.load('src/services/station.ts');
    for (const change of [{ minLng: 127.2 }, { minLat: 38 }, { minLng: -181 }, { maxLng: 181 }, { minLat: -91 }, { maxLat: 91 }, { minLng: NaN }, { maxLat: Infinity }, { minLng: '126' }]) {
        await assert.rejects(service.fetchStationsInBounds({ ...map126Bounds, ...change }), e => e.code === 'VALIDATION_ERROR' && e.status === 400);
    }
    assert.equal(calls, 0);
});
test('126 bbox 응답의 누락·잘못된 역은 UNKNOWN_ERROR', async () => {
    const r = createRuntime(serverEnv); const service = r.load('src/services/station.ts');
    for (const data of [null, {}, { items: [{}], page: 0, size: 500, totalElements: 1 }, { items: [], page: '0', size: 500, totalElements: 0 }]) {
        r.context.fetch = async () => jsonResponse({ success: true, data });
        await assert.rejects(service.fetchStationsInBounds(map126Bounds), e => e.code === 'UNKNOWN_ERROR');
    }
});
test('126 mock bbox 좌표 필터·size·원본 보호', async () => {
    const r = createRuntime(); const stations = r.load('src/mocks/stations.ts').MOCK_STATIONS;
    const expected = stations.filter(s => s.longitude >= map126Bounds.minLng && s.longitude <= map126Bounds.maxLng && s.latitude >= map126Bounds.minLat && s.latitude <= map126Bounds.maxLat);
    const result = await r.load('src/services/station.ts').fetchStationsInBounds(map126Bounds, { size: 2 });
    assert.deepEqual(plain(result.items), plain(expected.slice(0, 2))); assert.equal(result.totalElements, expected.length);
    result.items[0].name = '변경'; assert.notEqual(stations.find(s => s.id === result.items[0].id).name, '변경');
});
test('126 위치 허용·거부·실패·타임아웃의 좌표와 안내', () => {
    const { resolveLocation, DEFAULT_MAP_CENTER, LOCATION_GUIDANCE } = createRuntime().load('src/utils/home-map.ts');
    const coordinate = { latitude: 37.5, longitude: 127 };
    assert.deepEqual(plain(resolveLocation({ kind: 'granted', coordinate })), { center: coordinate, myLocation: coordinate, guidance: '' });
    for (const kind of ['denied', 'failed', 'timeout']) assert.deepEqual(plain(resolveLocation({ kind })), { center: plain(DEFAULT_MAP_CENTER), myLocation: null, guidance: LOCATION_GUIDANCE });
    assert.equal(resolveLocation({ kind: 'granted', coordinate: { latitude: NaN, longitude: 127 } }).myLocation, null);
});
test('126 WebView 키 인코딩·JSON 메시지·이동 도메인 검증', () => {
    const { buildMapHtml, parseMapMessage, isAllowedMapNavigation } = createRuntime().load('src/components/map/map-html.ts');
    const key = '</script>"&abc=한글'; const html = buildMapHtml(key);
    assert.ok(html.includes(encodeURIComponent(key))); assert.ok(!html.includes(key));
    for (const raw of ['', '{', 'null', '[]', '{"type":"future"}', '{"type":"region","bounds":{}}']) assert.equal(parseMapMessage(raw), null);
    assert.deepEqual(plain(parseMapMessage(JSON.stringify({ type: 'region', bounds: map126Bounds }))), { type: 'region', bounds: map126Bounds });
    assert.equal(parseMapMessage('{"type":"error","key":"secret"}').key, undefined);
    for (const url of ['https://localhost', 'https://dapi.kakao.com/v2/maps/sdk.js']) assert.equal(isAllowedMapNavigation(url), true);
    for (const url of ['https://kakao.com.evil.test', 'http://dapi.kakao.com', 'javascript:alert(1)', 'https://localhost:9999', 'https://user@kakao.com']) assert.equal(isAllowedMapNavigation(url), false);
});

const directionRoute114 = { stationId: 105, lineId: 2, headsign: '사당 방면', direction: 'INNER' };

test('126 WebView 안에서도 잘못된 JSON·타입은 무시하고 지원 여부를 다른 색으로 표시', () => {
    const html = createRuntime().load('src/components/map/map-html.ts').buildMapHtml('test');
    const listeners = {}; const events = {}; const colors = []; let script;
    class LatLng { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } getLat() { return this.latitude; } getLng() { return this.longitude; } }
    const sandbox = {
        window: { ReactNativeWebView: { postMessage() {} }, addEventListener: (name, fn) => { listeners[name] = fn; } },
        document: { addEventListener() {}, getElementById: () => ({}), createElement: () => ({ style: {} }), head: { appendChild: el => { script = el; } } },
        kakao: { maps: { LatLng, load: fn => fn(), event: { addListener: (_map, name, fn) => { events[name] = fn; } },
                Map: class { setCenter() {} getBounds() { return { getSouthWest: () => new LatLng(37.4, 126.9), getNorthEast: () => new LatLng(37.7, 127.2) }; } },
                CustomOverlay: class { constructor(options) { colors.push(options.content.style.backgroundColor); } setMap() {} },
            } },
    };
    vm.runInNewContext(html.split('<script>')[1].split('</script>')[0], sandbox); script.onload();
    for (const raw of ['{', 'null', '{"type":"unknown"}', JSON.stringify({ type: 'state', center: { latitude: 37.5, longitude: 127 }, myLocation: null, markers: [{}], revision: 1 })]) listeners.message({ data: raw });
    assert.equal(colors.length, 0);
    const point = { latitude: 37.5, longitude: 127 };
    listeners.message({ data: JSON.stringify({ type: 'state', center: point, myLocation: point, revision: 1,
            markers: [{ ...point, id: 1, isSupported: true }, { ...point, id: 2, isSupported: false }] }) });
    assert.deepEqual(colors, ['#12a77a', '#8c93a3', '#2879ef']);
});

function map126Runtime() {
    const r = createScreenRuntime(serverEnv, 'src/hooks/use-home-map.ts');
    r.external.react.useCallback = (callback, dependencies) => {
        const ref = r.external.react.useRef(null);
        if (!ref.current || dependencies.some((v, i) => v !== ref.current.dependencies[i])) ref.current = { callback, dependencies };
        return ref.current.callback;
    };
    let cleanup;
    r.external['expo-router'].useFocusEffect = callback => r.external.react.useEffect(() => { cleanup = callback(); return cleanup; }, [callback]);
    let account = 'a'; const component = () => r.screen.useHomeMap(true, account);
    r.view = () => r.renderComponent({ type: component, props: {} });
    r.account = value => { account = value; };
    r.blur = () => cleanup?.();
    r.native.Alert = { alert: (...args) => r.alerts.push(args) }; r.alerts = [];
    return r;
}
test('126 홈은 권한을 갑자기 요청하지 않고 버튼만 요청·거부 설정 안내', async () => {
    const r = map126Runtime(); let requested = 0;
    r.external['expo-location'].requestForegroundPermissionsAsync = async () => { requested++; return { granted: false }; };
    r.view(); await settle(); assert.equal(requested, 0);
    r.view().locate(); await settle(); assert.equal(requested, 1); assert.equal(r.alerts.length, 1);
    assert.equal(r.view().myLocation, null); r.unmount();
});
test('126 위치 응답은 화면 이탈·계정 전환·타임아웃 이후 무시', async () => {
    for (const mode of ['blur', 'account', 'generation', 'timeout']) {
        const r = map126Runtime(); let finish;
        r.external['expo-location'].getForegroundPermissionsAsync = async () => ({ granted: true });
        r.external['expo-location'].getCurrentPositionAsync = async options => { assert.equal(options.accuracy, 3); return await new Promise(resolve => { finish = resolve; }); };
        r.view(); await settle();
        if (mode === 'blur') r.blur();
        if (mode === 'account') { r.account('b'); r.external['expo-location'].getForegroundPermissionsAsync = async () => ({ granted: false }); r.view(); }
        if (mode === 'generation') await r.load('src/services/auth.ts').clearLocalSession();
        if (mode === 'timeout') { r.advance(10000); await settle(); }
        finish({ coords: { latitude: 37.5, longitude: 127 } }); await settle();
        assert.equal(r.view().myLocation, null, mode); r.unmount();
    }
});
test('126 bbox 디바운스·마지막 응답·실패 시 유지·이탈·계정 전환 가드', async () => {
    const r = map126Runtime(); const pending = [];
    r.load('src/services/station.ts').fetchStationsInBounds = async bounds => await new Promise((resolve, reject) => pending.push({ bounds, resolve, reject }));
    r.view(); await settle();
    r.view().onRegionChange(map126Bounds); r.advance(399); assert.equal(pending.length, 0);
    r.advance(1); assert.equal(pending.length, 1);
    r.view().onRegionChange({ ...map126Bounds, minLng: 127 }); r.advance(400);
    const station = { id: 1, latitude: 37.5, longitude: 127.1, isSupported: false };
    pending[1].resolve({ items: [station], totalElements: 501 }); await settle();
    pending[0].resolve({ items: [], totalElements: 0 }); await settle();
    assert.deepEqual(plain(r.view().markers), [station]); assert.equal(r.view().truncated, true);
    r.view().onRegionChange(map126Bounds); r.advance(400); pending[2].reject(Error()); await settle();
    assert.equal(r.view().markers.length, 1);
    r.view().onRegionChange(map126Bounds); r.advance(400); r.blur(); pending[3].resolve({ items: [], totalElements: 0 }); await settle();
    assert.equal(r.view().markers.length, 1);
    r.account('b'); assert.equal(r.view().markers.length, 0); r.unmount();
});
test('126 권한 시작은 순서대로 요청·이중 탭 차단·오류에도 로그인, 나중에는 요청 없음', async () => {
    for (const later of [false, true]) {
        const r = createScreenRuntime({}, 'src/app/permission.tsx'); const calls = []; const routes = []; let finish;
        r.external['expo-image-picker'].requestCameraPermissionsAsync = async () => { calls.push('camera'); await new Promise(resolve => { finish = resolve; }); throw Error(); };
        r.external['expo-location'].requestForegroundPermissionsAsync = async () => { calls.push('location'); throw Error(); };
        r.external['expo-router'].router.replace = route => routes.push(route);
        const view = r.render(); const button = text => findElement(view, el => el.type === 'Pressable' && findText(el, text));
        if (later) { button('나중에 할게요').props.onPress(); assert.equal(calls.length, 0); }
        else {
            const promise = button('시작하기').props.onPress(); button('시작하기').props.onPress(); button('나중에 할게요').props.onPress();
            assert.deepEqual(calls, ['camera']); assert.equal(routes.length, 0); finish(); await promise;
            assert.deepEqual(calls, ['camera', 'location']);
        }
        assert.deepEqual(routes, ['/login']); r.unmount();
    }
});
const directionData114 = (result = 'CORRECT') => ({ result, reason: result === 'CORRECT' ? null : 'UNREADABLE',
    recognized: { stationName: null, lineName: null, headsign: null }, expected: { stationName: '강남', lineName: '2호선', headsign: '사당 방면' }, message: '안내' });
const directionPhoto114 = { uri: 'file:///temporary.jpg', mimeType: 'image/jpeg', fileName: 'direction.jpg', file: new Blob(['jpeg'], { type: 'image/jpeg' }) };

test('114 multipart 원본·헤더와 JSON 요청의 기존 헤더·본문을 유지', async () => {
    const r = createRuntime(serverEnv); const client = r.load('src/services/api/client.ts'); const calls = [];
    client.setAccessTokenProvider(() => 'token');
    r.context.fetch = async (url, options) => { calls.push(options); return jsonResponse({ success: true, data: null }); };
    const body = new FormData(); body.append('route', '{}');
    await client.post('/upload', body); await client.post('/json', { text: '한글', count: 2 });
    assert.equal(calls[0].body, body); assert.deepEqual(plain(calls[0].headers), { Accept: 'application/json', Authorization: 'Bearer token' });
    assert.deepEqual(plain(calls[1].headers), { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer token' });
    assert.equal(calls[1].body, '{"text":"한글","count":2}');
});

test('114 FormData는 401 갱신 후 같은 파트를 재전송하고 인증 실패는 공통 처리', async () => {
    const r = createRuntime(serverEnv); const client = r.load('src/services/api/client.ts'); let token = 'old'; const calls = [];
    client.setAccessTokenProvider(() => token); client.setTokenRefresher(async () => { token = 'new'; });
    r.context.fetch = async (_url, options) => { calls.push(options); return calls.length === 1
        ? jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED' } }, 401) : jsonResponse({ success: true, data: directionData114() }); };
    await r.load('src/services/direction.ts').checkDirection(directionPhoto114, directionRoute114);
    assert.equal(calls.length, 2); assert.equal(calls[0].body, calls[1].body);
    assert.equal(calls[1].headers.Authorization, 'Bearer new'); assert.equal(calls[1].headers['Content-Type'], undefined);
    assert.equal(calls[1].body.get('route'), JSON.stringify({ stationId: 105, lineId: 2, headsign: '사당 방면', direction: 'INNER' }));
});

test('114 응답 3종·인식 null·미지 reason 일반 안내', () => {
    const parse = createRuntime().load('src/services/direction.ts').parseDirectionResponse;
    for (const result of ['CORRECT', 'WRONG', 'RETAKE']) assert.deepEqual(plain(parse(directionData114(result))), directionData114(result));
    const unknown = parse({ ...directionData114('WRONG'), reason: 'FUTURE_REASON', message: '미래 안내' });
    assert.equal(unknown.reason, 'UNKNOWN'); assert.equal(unknown.message, '표지판과 경로를 다시 확인해 주세요.');
});

test('114 잘못된 응답은 UNKNOWN_ERROR', () => {
    const parse = createRuntime().load('src/services/direction.ts').parseDirectionResponse;
    for (const value of [null, [], {}, { ...directionData114(), result: 'FUTURE' }, { ...directionData114(), reason: 1 },
        { ...directionData114(), reason: 'UNREADABLE' }, { ...directionData114('WRONG'), reason: null },
        { ...directionData114(), recognized: { stationName: null, lineName: 2, headsign: null } },
        { ...directionData114(), expected: { stationName: null, lineName: '2', headsign: '사당' } },
        { ...directionData114(), message: null }, { ...directionData114(), recognized: {} }]) assert.throws(() => parse(value), { code: 'UNKNOWN_ERROR' });
});

test('114 서버 오류 전체 매핑 및 인증 오류 전달', async () => {
    for (const code of ['IMAGE_INVALID', 'AI_QUOTA_EXCEEDED', 'AI_UNAVAILABLE', 'STATION_NOT_FOUND', 'VALIDATION_ERROR', 'NETWORK_ERROR', 'FUTURE_ERROR', 'TOKEN_INVALID']) {
        const r = createRuntime(serverEnv); let authFailures = 0;
        r.load('src/services/api/client.ts').setAuthFailureHandler(() => { authFailures++; });
        r.context.fetch = async () => { if (code === 'NETWORK_ERROR') throw Error(); return jsonResponse({ success: false, error: { code } }, code === 'TOKEN_INVALID' ? 401 : 400); };
        await assert.rejects(r.load('src/services/direction.ts').checkDirection(directionPhoto114, directionRoute114), { code: code === 'FUTURE_ERROR' ? 'UNKNOWN_ERROR' : code });
        assert.equal(authFailures, code === 'TOKEN_INVALID' ? 1 : 0);
    }
});

test('114 서버 업로드 파트 및 30초 제한·실제 timeout', async () => {
    const r = createRuntime(serverEnv); const service = r.load('src/services/direction.ts'); let body;
    r.context.fetch = (_url, options) => { assert.equal(_url, 'https://example.test/api/v1/ai/direction-check'); body = options.body;
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error()))); };
    const pending = service.checkDirection(directionPhoto114, { stationId: 105, lineId: 2, headsign: '사당 방면' });
    const rejected = assert.rejects(pending, { code: 'NETWORK_ERROR' }); await settle();
    assert.ok(service.DIRECTION_CHECK_TIMEOUT_MS >= 30000); assert.equal([...r.timers.values()][0].ms, service.DIRECTION_CHECK_TIMEOUT_MS);
    assert.equal(body.get('image').name, 'direction.jpg'); assert.deepEqual(JSON.parse(body.get('route')), { stationId: 105, lineId: 2, headsign: '사당 방면' });
    r.advance(service.DIRECTION_CHECK_TIMEOUT_MS); await rejected;
});

test('114 mock 예시 5종은 서버 호출 없이 기존 동작 유지', async () => {
    const r = createRuntime(); const service = r.load('src/services/direction.ts');
    const expected = { ...directionRoute114, stationName: '강남', lineName: '2호선' };
    for (const sample of service.buildSamples(expected)) {
        const pending = service.checkDirection(sample, expected);
        const rejected = sample.id === 'serverError' ? assert.rejects(pending, { code: 'AI_UNAVAILABLE' }) : null;
        r.advance(1500);
        if (rejected) await rejected;
        else assert.equal((await pending).result, sample.id === 'correct' ? 'CORRECT' : sample.id === 'blurry' ? 'RETAKE' : 'WRONG');
    }
});

test('#117 이벤트별 갱신 대상과 추천 안내 판단', () => {
    const r = createRuntime();
    const { roomEventTargets, recommendationEventAction } = r.load('src/services/room-events.ts');
    const expected = {
        MEMBER_JOINED: ['detail', 'recommendation'], MEMBER_LEFT: ['detail', 'proposals', 'recommendation'],
        OWNER_CHANGED: ['detail'], DEPARTURE_UPDATED: ['detail', 'recommendation'],
        ROOM_UPDATED: ['recommendation'], SELECTED_STATION_CHANGED: [], MESSAGE_CREATED: [],
        RECOMMENDATION_CREATED: ['recommendation'], STATION_PROPOSAL_CREATED: ['proposals'],
        STATION_PROPOSAL_DELETED: ['proposals'], STATION_PROPOSAL_VOTE_CHANGED: ['proposals'],
    };
    for (const [type, targets] of Object.entries(expected)) assert.deepEqual(plain(roomEventTargets(type)), targets);
    assert.equal(recommendationEventAction('a', 'b', false, true), 'banner');
    assert.equal(recommendationEventAction('a', 'a', false, true), 'ignore');
    assert.equal(recommendationEventAction('a', 'b', true, true), 'ignore');
    assert.equal(recommendationEventAction(undefined, 'b', false, false), 'load');
});

test('#117 ROOM_UPDATED는 역할·초대 코드·멤버를 보존하고 null 해제, 잘못된 payload는 거절', () => {
    const r = createRuntime(); const service = r.load('src/services/room-events.ts');
    const current = { ...roomQueryDetail(), memberCount: 2, roomCode: 'ABC123', selectedStation: roomQueryStation() };
    const payload = { ...roomQuerySummary(), name: '바뀐 이름', myRole: 'MEMBER', roomCode: 'ATTACK', members: [], selectedStation: null };
    const merged = service.mergeRoomUpdated(current, payload);
    assert.equal(merged.name, '바뀐 이름'); assert.equal(merged.myRole, 'OWNER'); assert.equal(merged.roomCode, 'ABC123');
    assert.equal(merged.members, current.members); assert.equal(merged.selectedStation, null);
    const older = service.mergeRoomUpdated(current, payload, false);
    assert.equal(older.selectedStation, current.selectedStation); assert.equal(older.name, '바뀐 이름');
    for (const change of [{ id: 'different' }, { selectedStation: undefined }, { selectedStation: { id: 1 } }, { appointmentAt: 'bad' }, { memberCount: 1.5 }]) {
        assert.equal(service.mergeRoomUpdated(current, { ...payload, ...change }), null);
    }
    assert.deepEqual(plain(service.parseSelectedStationEvent({ station: null, confirmedAt: null })), { selectedStation: null, confirmedAt: null });
    assert.equal(service.parseSelectedStationEvent({ station: roomQueryStation(), confirmedAt: null }), null);
    assert.equal(service.parseSelectedStationEvent({ station: {}, confirmedAt: '2026-11-12T10:00:00Z' }), null);
    assert.equal(service.parseSelectedStationEvent({ station: roomQueryStation(), confirmedAt: '2026-11-12T10:00:00Z' }).selectedStation.id, 88001);
});

test('#117 300ms 모으기·실행 중 한 번 더·대상별 병렬 분리·해제', async () => {
    const r = createRuntime(); const calls = []; let finish;
    const queue = r.load('src/services/room-events.ts').createRoomEventCoalescer(target => {
        calls.push(target);
        if (target === 'detail') return new Promise(resolve => { finish = resolve; });
    });
    queue.request(['detail', 'recommendation']); queue.request(['detail']);
    r.advance(299); await settle(); assert.deepEqual(calls, []);
    r.advance(1); await settle(); assert.deepEqual(calls, ['detail', 'recommendation']);
    queue.request(['detail']); queue.request(['detail']); r.advance(1000); await settle();
    assert.equal(calls.filter(x => x === 'detail').length, 1);
    finish(); await settle(); r.advance(300); await settle();
    assert.equal(calls.filter(x => x === 'detail').length, 2);
    queue.request(['detail']); queue.dispose(); finish(); await settle(); r.advance(1000); await settle();
    assert.equal(calls.length, 3);
});

test('#117 가짜 구독: 방장 퇴장 모으기·재연결·거절·이전 계정 응답 가드·해제', async () => {
    const r = roomQueryScreen('src/hooks/use-room-events.ts');
    const rt = r.load('src/services/realtime.ts'); const registrations = []; const calls = []; let stopped = 0; let denied;
    rt.subscribeRoomEvents = (roomId, listener, options) => {
        registrations.push({ roomId, listener, options }); return () => stopped++;
    };
    let responseValid;
    const callbacks = { refresh: async (target, valid) => { calls.push(target); responseValid = valid; }, rejected: code => { denied = code; } };
    let currentRoomId;
    const Component = () => r.screen.useRoomEvents(currentRoomId, callbacks);
    const render = roomId => { currentRoomId = roomId; return r.renderComponent({ type: Component, props: {} }); };
    render(ROOM_QUERY_ID);
    const first = registrations[0];
    const event = type => ({ type, roomId: ROOM_QUERY_ID, payload: {}, at: '2026-11-12T10:00:00Z' });
    first.listener(event('MEMBER_LEFT')); first.listener(event('OWNER_CHANGED'));
    r.advance(300); await settle(); assert.deepEqual(calls, ['detail', 'proposals', 'recommendation']);
    first.options.onReconnected(); r.advance(300); await settle(); assert.equal(calls.length, 6);
    first.options.onRejected('INTERNAL_ERROR'); assert.equal(denied, undefined);
    r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '새 계정' });
    assert.equal(responseValid(), false);
    first.listener(event('MEMBER_LEFT')); first.options.onReconnected(); r.advance(300); await settle(); assert.equal(calls.length, 6);
    render(ROOM_QUERY_ID); assert.equal(stopped, 1); assert.equal(registrations.length, 2);
    render(ROOM_QUERY_ID2); assert.equal(stopped, 2); assert.equal(registrations.length, 3);
    registrations[2].listener(event('MEMBER_JOINED')); r.advance(300); await settle(); assert.equal(calls.length, 6);
    registrations[2].options.onRejected('NOT_ROOM_MEMBER'); assert.equal(denied, 'NOT_ROOM_MEMBER');
    r.unmount(); assert.equal(stopped, 3);
});

test('#117 구독 예외에도 마운트·언마운트와 coalescer 정리·개발 로그 유지', async () => {
    for (const dev of [false, true]) {
        const r = roomQueryScreen('src/hooks/use-room-events.ts');
        const logs = []; let subscriptions = 0, refreshes = 0;
        r.context.__DEV__ = dev;
        r.context.console = { ...console, debug: (...args) => logs.push(args) };
        r.load('src/services/realtime.ts').subscribeRoomEvents = (_roomId, _listener, options) => {
            subscriptions++;
            // Even queued work created immediately before a failed registration must be disposed.
            options.onSubscribed();
            throw Error('invalid https://private.test/api token=secret message=private');
        };
        const callbacks = { refresh: () => { refreshes++; }, rejected: () => assert.fail('구독 예외는 접근 거부가 아님') };
        const Component = () => r.screen.useRoomEvents(ROOM_QUERY_ID, callbacks);
        assert.doesNotThrow(() => r.renderComponent({ type: Component, props: {} }));
        assert.equal(subscriptions, 1);
        assert.equal(r.timers.size, 3);
        assert.deepEqual(logs, dev ? [['[room-events] realtime subscription unavailable']] : []);
        assert.doesNotThrow(() => r.unmount());
        assert.equal(r.timers.size, 0);
        r.advance(1000); await settle(); assert.equal(refreshes, 0);
    }
});

test('#117 방 상세는 추천 조회를 생략하고 detail·proposals 접근 거부로 방을 정리', async () => {
    for (const target of ['detail', 'proposals']) {
        for (const code of ['NOT_ROOM_MEMBER', 'ROOM_NOT_FOUND']) {
            const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID });
            let listener, reject = false, recommendationCalls = 0;
            const routes = [];
            r.external['expo-router'].router.replace = route => routes.push(route);
            r.load('src/services/realtime.ts').subscribeRoomEvents = (_id, receive) => { listener ??= receive; return () => {}; };
            r.context.fetch = async url => {
                if (url.includes('/recommendations')) { recommendationCalls++; return ok(null); }
                if (url.endsWith('/invite-code')) return ok({ roomCode: 'ABC123' });
                if (url.includes('station-proposals')) return reject && target === 'proposals'
                    ? recoFail(code, code === 'NOT_ROOM_MEMBER' ? 403 : 404)
                    : ok({ items: [], maxProposals: 9, selectedStation: null });
                return reject && target === 'detail' ? recoFail(code, code === 'NOT_ROOM_MEMBER' ? 403 : 404) : ok(roomQueryDetail());
            };
            r.render(); await settle(); await settle(); r.render();
            const emit = type => listener({ type, roomId: ROOM_QUERY_ID, payload: {}, at: '2026-11-12T10:00:00Z' });
            emit('RECOMMENDATION_CREATED'); r.advance(300); await settle();
            assert.equal(recommendationCalls, 0); assert.deepEqual(routes, []);
            reject = true;
            emit(target === 'detail' ? 'DEPARTURE_UPDATED' : 'STATION_PROPOSAL_CREATED');
            r.advance(300); await settle(); await settle();
            assert.ok(routes.includes('/rooms'), `${target}: ${code}`);
            assert.equal(r.load('src/services/room-cache.ts').readCachedRoomDetail(ROOM_QUERY_ID), undefined);
            assert.equal(recommendationCalls, 0);
            r.unmount();
        }
    }
});

test('#117 mock 훅은 구독·타이머·재조회를 만들지 않아요', () => {
    const r = createScreenRuntime({}, 'src/hooks/use-room-events.ts');
    r.load('src/services/realtime.ts').subscribeRoomEvents = () => { throw Error('mock subscription'); };
    const callbacks = { refresh: () => { throw Error('mock refresh'); }, rejected: () => {} };
    r.renderComponent({ type: () => r.screen.useRoomEvents('room-1', callbacks), props: {} });
    assert.equal(r.timers.size, 0); r.unmount();
});

test('#117 상세 이벤트: 오래된 약속역 무시·다른 필드 병합·같은 역 재확정·해제·방장 상실', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID });
    let listener; let role = 'OWNER'; let options;
    r.load('src/services/realtime.ts').subscribeRoomEvents = (_id, receive, opts) => { listener ??= receive; options ??= opts; return () => {}; };
    const cache = r.load('src/services/room-cache.ts');
    r.context.fetch = async url => ok(url.endsWith('/invite-code') ? { roomCode: 'ABC123' }
        : url.includes('station-proposals') ? { items: [], maxProposals: 9, selectedStation: null }
            : url.includes('/recommendations') ? null : roomQueryDetail(role));
    r.render(); await settle(); await settle(); r.render();
    const emit = (type, payload, second) => listener({ type, roomId: ROOM_QUERY_ID, payload, at: `2026-11-12T10:00:${second}Z` });
    emit('SELECTED_STATION_CHANGED', { station: roomQueryStation(90001), confirmedAt: '2026-11-12T10:00:20Z' }, '20');
    emit('ROOM_UPDATED', { ...roomQuerySummary(), name: '이름 갱신', selectedStation: null }, '10');
    let detail = cache.readCachedRoomDetail(ROOM_QUERY_ID);
    assert.equal(detail.name, '이름 갱신'); assert.equal(detail.selectedStation.id, 90001);
    assert.equal(cache.readCachedRoomCode(ROOM_QUERY_ID), 'ABC123');
    emit('SELECTED_STATION_CHANGED', { station: roomQueryStation(90001), confirmedAt: '2026-11-12T10:00:30Z' }, '30');
    assert.equal(cache.readCachedRoomDetail(ROOM_QUERY_ID).confirmedAt, '2026-11-12T10:00:30Z');
    emit('SELECTED_STATION_CHANGED', { station: null, confirmedAt: null }, '40');
    assert.equal(cache.readCachedRoomDetail(ROOM_QUERY_ID).selectedStation, null);
    role = 'MEMBER'; emit('OWNER_CHANGED', { newOwnerId: ROOM_QUERY_OTHER }, '41');
    r.advance(300); await settle(); r.render();
    assert.equal(cache.readCachedRoomDetail(ROOM_QUERY_ID).myRole, 'MEMBER');
    assert.equal(cache.readCachedRoomCode(ROOM_QUERY_ID), undefined);
    const routes = []; r.external['expo-router'].router.replace = route => routes.push(route);
    options.onRejected('INTERNAL_ERROR'); assert.equal(routes.length, 0);
    options.onRejected('ROOM_NOT_FOUND'); assert.deepEqual(routes, ['/rooms']);
    assert.equal(cache.readCachedRoomDetail(ROOM_QUERY_ID), undefined);
    r.unmount();
});

test('#117 추천: 기존 결과 유지·새 추천 배너·보기·자기 이벤트 무시·멤버 변경 stale 갱신', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId]/recommendations.tsx', { roomId: ROOM_QUERY_ID });
    let listener; let latest = recoRun({ results: [] }); let latestCalls = 0;
    r.load('src/services/realtime.ts').subscribeRoomEvents = (_id, receive) => { listener = receive; return () => {}; };
    r.context.fetch = async url => {
        if (url.includes('/recommendations')) { latestCalls++; return ok(latest); }
        return ok(url.includes('station-proposals') ? { items: [], maxProposals: 9, selectedStation: null } : roomQueryDetail());
    };
    r.render(); await settle(); await settle(); r.render();
    const emit = (type, payload) => listener({ type, roomId: ROOM_QUERY_ID, payload, at: '2026-11-12T10:00:00Z' });
    emit('RECOMMENDATION_CREATED', { runId: latest.runId }); r.advance(300); await settle();
    assert.equal(latestCalls, 1);
    latest = recoRun({ runId: 'new-run', results: [] });
    emit('RECOMMENDATION_CREATED', { runId: 'new-run' }); r.advance(300); await settle();
    let view = r.render();
    assert.ok(findElement(view, node => node.props?.children === '새 추천이 있어요'));
    const button = findElement(view, node => node.type === 'Pressable' && findElement(node.props?.children, child => child.props?.children === '보기'));
    button.props.onPress(); await settle(); view = r.render();
    assert.equal(findElement(view, node => node.props?.children === '새 추천이 있어요'), null);
    const before = latestCalls;
    emit('RECOMMENDATION_CREATED', { runId: 'new-run' }); r.advance(300); await settle(); assert.equal(latestCalls, before);
    latest = { ...latest, isStale: true, staleReasons: ['MEMBERS_CHANGED'] };
    emit('DEPARTURE_UPDATED', { userId: ROOM_QUERY_OTHER }); r.advance(300); await settle(); view = r.render();
    assert.ok(findElement(view, node => node.props?.children === '참여자나 출발역이 바뀌었어요'));
    r.unmount();
});

/* ---------- WebSocket/STOMP base (#116): real library, virtual socket and clock ---------- */
const RT_ROOM = '00000000-0000-0000-0000-000000000116';
const RT_OTHER = '00000000-0000-0000-0000-000000000117';
async function realtimeRuntime({ mock = false, token = 'opaque-access', random = () => 0.5, native = false, base, settleSubscriptions = true } = {}) {
    const r = createRuntime(mock ? {} : { ...serverEnv, ...(base ? { EXPO_PUBLIC_API_BASE_URL: base } : {}) });
    r.context.Date = class extends Date {
        constructor(...args) { super(...(args.length ? args : [2000000000000 + r.now()])); }
        static now() { return 2000000000000 + r.now(); }
    };
    if (native) r.native.Platform.OS = 'ios';
    r.auth = r.load('src/services/auth.ts');
    r.store = r.load('src/stores/auth-store.ts');
    r.tokens = r.load('src/services/token-storage.ts');
    // Seed on web storage before exercising RN transport options.
    const platform = r.native.Platform.OS; r.native.Platform.OS = 'web';
    await r.tokens.saveTokens(token, 'rotating-refresh', () => true); r.native.Platform.OS = platform;
    r.store.signIn({ userId: RT_ROOM, nickname: 'realtime' });
    r.sockets = [];
    class FakeSocket {
        readyState = 0; frames = []; binary = [];
        constructor(url, protocols) { this.url = url; this.protocols = protocols; r.sockets.push(this); }
        open() { this.readyState = 1; this.onopen?.({}); }
        send(data) { this.binary.push(typeof data !== 'string'); this.frames.push(typeof data === 'string' ? data : new TextDecoder().decode(data)); }
        receive(command, headers = {}, body = '') { this.onmessage?.({ data: `${command}\n${Object.entries(headers).map(([key, value]) => `${key}:${value}`).join('\n')}\n\n${body}\0` }); }
        close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
        commands(command) { return this.frames.filter(frame => frame.startsWith(`${command}\n`)); }
    }
    r.context.WebSocket = FakeSocket;
    r.rt = r.load('src/services/realtime.ts');
    r.service = r.rt.createRealtimeService({ socketFactory: (url, protocols) => new FakeSocket(url, protocols), random });
    r.connect = async (ready = settleSubscriptions) => {
        await settle(); const socket = r.sockets.at(-1); assert.ok(socket); socket.open();
        socket.receive('CONNECTED', { version: '1.2', 'heart-beat': '10000,10000' }); await settle();
        if (ready) { r.advance(r.rt.SUBSCRIBE_SETTLE_MS); await settle(); }
        return socket;
    };
    r.reconnect = async (delay = 1000) => { r.advance(delay); await settle(); return r.connect(); };
    r.event = (socket, room = RT_ROOM, overrides = {}) => {
        const subscription = socket.commands('SUBSCRIBE').find(frame => frame.includes(`/topic/rooms/${room.toLowerCase()}`));
        const id = subscription.match(/\nid:([^\n]+)/)[1];
        socket.receive('MESSAGE', { subscription: id, 'message-id': 'msg-1' }, JSON.stringify({ type: 'ROOM_UPDATED', roomId: room, payload: {}, at: '2033-05-18T03:33:20Z', ...overrides }));
    };
    r.receipt = (socket, room) => socket.commands('SUBSCRIBE').find(frame => frame.includes(room)).match(/\nreceipt:([^\n]+)/)[1];
    return r;
}

test('116 URL conversion and invalid configuration; mock has no socket or timer', async () => {
    const r = await realtimeRuntime();
    for (const [base, expected] of [['http://3.36.48.140:8080/api/v1', 'ws://3.36.48.140:8080/ws'], ['https://example.test/api/v1', 'wss://example.test/ws']]) assert.equal(r.rt.buildRealtimeUrl(base), expected);
    for (const base of ['', 'ws://example.test/api/v1', 'https://example.test/x/api/v1', 'https://example.test/x/../api/v1', 'https://example.test/api/v1?token=secret', 'https://u:p@example.test/api/v1', 'https://example.test/api/v1#x']) assert.throws(() => r.rt.buildRealtimeUrl(base), /서버 주소/);
    const invalid = await realtimeRuntime({ base: 'https://example.test/wrong' });
    assert.throws(() => invalid.service.subscribeRoomEvents(RT_ROOM, () => {}), /서버 주소/); assert.equal(invalid.sockets.length, 0);
    const mock = await realtimeRuntime({ mock: true });
    mock.service.subscribeRoomEvents('mock-room', () => {})();
    mock.service.forgetRoom('mock-room'); assert.equal(mock.sockets.length, 0); assert.equal(mock.timers.size, 0); assert.equal(mock.service.getRealtimeState(), 'idle');
});

test('116 real STOMP CONNECT headers, RN binary option, shared subscription, receipt and unique IDs', async () => {
    const r = await realtimeRuntime({ native: true }); let reconnected = 0;
    const one = r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onReconnected: () => reconnected++ });
    const two = r.service.subscribeRoomEvents(RT_ROOM.toUpperCase(), () => {});
    const socket = await r.connect();
    assert.equal(socket.url, 'wss://example.test/ws'); assert.deepEqual(plain(socket.protocols), ['v12.stomp']);
    const connect = socket.commands('CONNECT')[0]; assert.match(connect, /Authorization:Bearer opaque-access/); assert.match(connect, /heart-beat:10000,10000/); assert.equal(socket.binary[0], true);
    assert.equal(socket.commands('SUBSCRIBE').length, 1); assert.equal(reconnected, 0);
    one(); assert.equal(socket.commands('UNSUBSCRIBE').length, 0); two(); assert.equal(socket.commands('UNSUBSCRIBE').length, 1);
    const three = r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onReconnected: () => reconnected++ });
    assert.equal(reconnected, 0); assert.equal(socket.commands('SUBSCRIBE').length, 2);
    const ids = socket.commands('SUBSCRIBE').map(frame => frame.match(/\nid:([^\n]+)/)[1]); assert.equal(new Set(ids).size, 2);
    socket.receive('RECEIPT', { 'receipt-id': socket.commands('SUBSCRIBE')[1].match(/\nreceipt:([^\n]+)/)[1] });
    socket.close(); const restored = await r.reconnect(); assert.equal(reconnected, 1);
    r.service.subscribeRoomEvents(RT_OTHER, () => {}, { onReconnected: () => reconnected++ }); assert.equal(reconnected, 1);
    assert.equal(new Set(restored.commands('SUBSCRIBE').map(frame => frame.match(/\nid:([^\n]+)/)[1])).size, 2);
    assert.equal([...socket.frames, ...restored.frames].some(frame => frame.startsWith('SEND')), false);
    three(); r.service.dispose(); await settle(); assert.equal(r.timers.size, 0);
});

test('116 parser discards malformed/unknown/wrong-room events and isolates listeners', async () => {
    const r = await realtimeRuntime(); let received = 0;
    r.service.subscribeRoomEvents(RT_ROOM, () => { throw Error('consumer'); });
    r.service.subscribeRoomEvents(RT_ROOM, () => received++);
    const socket = await r.connect(); const subscription = socket.commands('SUBSCRIBE')[0].match(/\nid:([^\n]+)/)[1];
    socket.receive('MESSAGE', { subscription }, '{');
    for (const overrides of [{ roomId: RT_OTHER }, { type: 'FUTURE_EVENT' }, { payload: [] }, { payload: null }, { at: 'yesterday' }, { at: '2033-02-30T03:33:20Z' }, { at: '2033-05-18T03:33:20+09:00' }, { type: 1 }, { roomId: 'invalid' }]) r.event(socket, RT_ROOM, overrides);
    assert.equal(received, 0); r.event(socket, RT_ROOM.toUpperCase()); assert.equal(received, 1); assert.equal(r.service.getRealtimeState(), 'open');
    r.service.dispose();
});

test('116 idle grace cancels on a new subscriber and closes after 10 seconds without registrations', async () => {
    const r = await realtimeRuntime(); let off = r.service.subscribeRoomEvents(RT_ROOM, () => {}); const socket = await r.connect();
    off(); r.advance(9999); assert.equal(socket.readyState, 1);
    off = r.service.subscribeRoomEvents(RT_OTHER, () => {}); r.advance(1); assert.equal(socket.readyState, 1);
    off(); r.advance(10000); await settle(); assert.equal(socket.readyState, 3); assert.equal(r.service.getRealtimeState(), 'closed'); assert.equal(r.timers.size, 0);
});

test('116 denied subscription uses receipt-id or newest unconfirmed fallback; other rooms recover', async () => {
    for (const code of ['NOT_ROOM_MEMBER', 'ROOM_NOT_FOUND']) for (const receipt of [true, false]) {
        const r = await realtimeRuntime({ settleSubscriptions: false }); const rejected = []; let restored = 0;
        r.service.subscribeRoomEvents(RT_OTHER, () => {}, { onReconnected: () => restored++ });
        r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onRejected: value => rejected.push(value) });
        const socket = await r.connect();
        const cache = r.load('src/services/room-cache.ts');
        cache.cacheJoinedRoom(RT_ROOM, 'ABC123', cache.getRoomCacheScope());
        socket.receive('RECEIPT', { 'receipt-id': r.receipt(socket, RT_OTHER) });
        socket.receive('ERROR', { message: code, ...(receipt ? { 'receipt-id': r.receipt(socket, RT_ROOM) } : {}) });
        assert.deepEqual(rejected, [code]); assert.equal(cache.findCachedRoomIdByCode('ABC123'), undefined);
        const next = await r.reconnect(); next.receive('RECEIPT', { 'receipt-id': r.receipt(next, RT_OTHER) }); assert.equal(next.commands('SUBSCRIBE').length, 1); assert.match(next.commands('SUBSCRIBE')[0], new RegExp(RT_OTHER)); assert.equal(restored, 1); r.service.dispose();
    }
});

test('116 repeated validation/access/internal errors abandon only the offending room after three attempts', async () => {
    for (const code of ['VALIDATION_ERROR', 'ACCESS_DENIED', 'INTERNAL_ERROR']) {
        const r = await realtimeRuntime({ settleSubscriptions: false }); const rejected = [];
        r.service.subscribeRoomEvents(RT_OTHER, () => {});
        r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onRejected: value => rejected.push(value) });
        let socket = await r.connect();
        for (let index = 0; index < 3; index++) {
            socket.receive('ERROR', { message: code, 'receipt-id': r.receipt(socket, RT_ROOM) });
            socket = await r.reconnect();
        }
        assert.deepEqual(rejected, [code]); assert.equal(socket.commands('SUBSCRIBE').length, 1); assert.match(socket.commands('SUBSCRIBE')[0], new RegExp(RT_OTHER)); r.service.dispose();
    }
});

test('116 confirmed subscription resets room failures before a new consecutive failure streak', async () => {
    for (const code of ['VALIDATION_ERROR', 'ACCESS_DENIED', 'INTERNAL_ERROR']) {
        const r = await realtimeRuntime({ settleSubscriptions: false }); const rejected = [];
        r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onRejected: value => rejected.push(value) });
        let socket = await r.connect();
        const fail = async () => {
            socket.receive('ERROR', { message: code, 'receipt-id': r.receipt(socket, RT_ROOM) });
            socket = await r.reconnect();
        };
        await fail(); await fail();
        socket.receive('RECEIPT', { 'receipt-id': r.receipt(socket, RT_ROOM) });
        // Force a fresh SUBSCRIBE while retaining the same room registration and failure counter.
        socket.close(); socket = await r.reconnect();
        await fail(); await fail();
        assert.deepEqual(rejected, []); assert.equal(socket.commands('SUBSCRIBE').length, 1);
        socket.receive('ERROR', { message: code, 'receipt-id': r.receipt(socket, RT_ROOM) });
        assert.deepEqual(rejected, [code]);
        r.service.dispose();
    }
});

test('116 CONNECTED resets unidentified failures while three consecutive failures still reject', async () => {
    const r = await realtimeRuntime(); const rejected = [];
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onRejected: code => rejected.push(code) });
    let socket = await r.connect();
    const fail = () => socket.receive('ERROR', { message: 'INTERNAL_ERROR', 'receipt-id': 'unidentified' });
    for (let index = 0; index < 4; index++) { fail(); socket = await r.reconnect(); }
    assert.deepEqual(rejected, []); assert.equal(socket.commands('SUBSCRIBE').length, 1);
    // Do not send CONNECTED between these errors.
    for (let index = 0; index < 3; index++) {
        fail();
        if (index < 2) { r.advance(1000 * 2 ** index); await settle(); socket = r.sockets.at(-1); socket.open(); }
    }
    assert.deepEqual(rejected, ['INTERNAL_ERROR']); r.service.dispose();
});

test('116 drop diagnostics contain only check names in development and stay silent in production', async () => {
    for (const development of [false, true]) {
        const r = await realtimeRuntime(); const logs = [];
        r.context.__DEV__ = development;
        r.context.console = { ...console, debug: (...args) => logs.push(args.join(' ')) };
        r.service.subscribeRoomEvents(RT_ROOM, () => {}); const socket = await r.connect();
        const subscription = socket.commands('SUBSCRIBE')[0].match(/\nid:([^\n]+)/)[1];
        socket.receive('MESSAGE', { subscription }, 'secret-invalid-json');
        r.event(socket, RT_ROOM, { at: 'secret-invalid-at', payload: { secret: 'private-body' } });
        r.event(socket, RT_ROOM, { type: 'secret-unknown-type' });
        r.event(socket, RT_ROOM, { roomId: RT_OTHER });
        const drops = logs.filter(line => line.startsWith('[realtime] drop:'));
        assert.deepEqual(drops, development ? ['[realtime] drop: invalid JSON', '[realtime] drop: invalid at', '[realtime] drop: unknown type', '[realtime] drop: roomId mismatch'] : []);
        assert.equal(logs.some(line => /secret|private-body|opaque-access/.test(line)), false);
        if (!development) assert.deepEqual(logs, []);
        r.service.dispose();
    }
});

test('116 exponential retry delays, cap, jitter and CONNECTED reset; first connection has no recovery callback', async () => {
    for (const [random, factor] of [[() => 0, 0.8], [() => 0.5, 1], [() => 1, 1.2]]) {
        const r = await realtimeRuntime({ random }); let recovered = 0;
        r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onReconnected: () => recovered++ }); await settle();
        for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
            r.sockets.at(-1).close(); const count = r.sockets.length;
            r.advance(delay * factor - 1); await settle(); assert.equal(r.sockets.length, count);
            r.advance(1); await settle(); assert.equal(r.sockets.length, count + 1);
        }
        const socket = await r.connect(); assert.equal(recovered, 0);
        socket.close(); await r.reconnect(1000 * factor); assert.equal(recovered, 1); r.service.dispose();
    }
});

test('116 imminent expiry refreshes once before CONNECT and shares rotating refresh with REST', async () => {
    const jwt = `e30.${Buffer.from(JSON.stringify({ exp: 2000000030 })).toString('base64url')}.sig`;
    const r = await realtimeRuntime({ token: jwt }); let refreshes = 0; let resolve;
    r.context.fetch = async (url, options) => {
        if (!url.endsWith('/auth/refresh')) return options.headers.Authorization === `Bearer ${jwt}`
            ? jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED' } }, 401) : jsonResponse({ success: true, data: null });
        refreshes++; return new Promise(done => { resolve = done; });
    };
    r.service.subscribeRoomEvents(RT_ROOM, () => {}); const rest = r.load('src/services/api/client.ts').get('/rooms/test'); await settle();
    assert.equal(refreshes, 1); assert.equal(r.sockets.length, 0);
    resolve(jsonResponse({ success: true, data: { accessToken: 'fresh', refreshToken: 'rotated', accessTokenExpiresIn: 3600 } }));
    await rest; await settle(); const socket = await r.connect(); assert.match(socket.commands('CONNECT')[0], /Authorization:Bearer fresh/); r.service.dispose();
});

test('116 auth ERROR refreshes once immediately; repeated rejection or refresh authentication failure clears session', async () => {
    for (const code of ['TOKEN_EXPIRED', 'TOKEN_INVALID', 'AUTH_REQUIRED']) {
        const r = await realtimeRuntime(); let refreshes = 0;
        r.context.fetch = async () => { refreshes++; return jsonResponse({ success: true, data: { accessToken: 'fresh', refreshToken: 'rotated', accessTokenExpiresIn: 3600 } }); };
        r.service.subscribeRoomEvents(RT_ROOM, () => {}); const socket = await r.connect(); socket.receive('ERROR', { message: code });
        await settle(); r.advance(0); await settle(); const next = r.sockets.at(-1); next.open(); assert.equal(refreshes, 1);
        next.receive('ERROR', { message: code }); await settle(); assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.tokens.getAccessToken(), null);
        const count = r.sockets.length; r.advance(60000); await settle(); assert.equal(r.sockets.length, count); r.service.dispose();
    }
    for (const token of [null, `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.sig`]) {
        const r = await realtimeRuntime({ token });
        r.context.fetch = async () => jsonResponse({ success: false, error: { code: 'TOKEN_INVALID' } }, 401);
        r.service.subscribeRoomEvents(RT_ROOM, () => {}); await settle(); await settle(); assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.sockets.length, 0); r.service.dispose();
    }
});

test('116 logout/account switch rejects old messages and old unsubscribe cannot remove new account registration', async () => {
    for (const change of ['switch', 'logout', 'generation']) {
        const r = await realtimeRuntime(); let received = 0;
        const off = r.service.subscribeRoomEvents(RT_ROOM, () => received++); const socket = await r.connect();
        const oldMessage = socket.onmessage;
        if (change === 'switch') r.store.signIn({ userId: RT_OTHER, nickname: 'next' });
        else if (change === 'logout') await r.auth.logoutSession(); else await r.auth.clearLocalSession();
        oldMessage({ data: `MESSAGE\nsubscription:sub-1\n\n${JSON.stringify({ type: 'ROOM_UPDATED', roomId: RT_ROOM, payload: {}, at: '2033-05-18T03:33:20Z' })}\0` });
        assert.equal(received, 0); r.advance(1000); assert.equal(socket.readyState, 3);
        if (change === 'switch') {
            r.service.subscribeRoomEvents(RT_ROOM, () => received++); const next = await r.connect(); off(); r.event(next); assert.equal(received, 1);
        }
        r.service.dispose();
    }
});

test('116 background grace, suspension and foreground recovery; ACCOUNT_WITHDRAWN never retries', async () => {
    const r = await realtimeRuntime(); let recovered = 0;
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onReconnected: () => recovered++ }); const socket = await r.connect();
    r.native.AppState.change('background'); r.advance(20000);
    socket.onmessage?.({ data: '\n' }); // 구독 대기 시간과 별개로 서버 하트비트가 연결을 유지해요.
    r.advance(9999); r.native.AppState.change('active'); assert.equal(socket.readyState, 1); assert.equal(recovered, 0);
    r.native.AppState.change('background'); r.advance(30000); await settle(); assert.equal(socket.readyState, 3);
    const count = r.sockets.length; r.advance(60000); await settle(); assert.equal(r.sockets.length, count);
    r.native.AppState.change('active'); const next = await r.connect(); assert.equal(recovered, 1);
    next.close(1008, 'ACCOUNT_WITHDRAWN'); await settle(); assert.equal(r.store.getAuthStatus(), 'signedOut');
    r.advance(60000); await settle(); assert.equal(r.sockets.length, count + 1); assert.equal(r.timers.size, 0);
});

test('116 successful REST leave forgets only that room; failed leave retains the subscription', async () => {
    for (const success of [true, false]) {
        const r = await realtimeRuntime();
        r.service = r.rt;
        const off = r.rt.subscribeRoomEvents(RT_ROOM, () => {});
        const socket = await r.connect();
        r.context.fetch = async () => success ? jsonResponse({ success: true, data: { roomDeleted: true, newOwnerId: null } }) : jsonResponse({ success: false, error: { code: 'ROOM_BUSY' } }, 409);
        const leave = r.load('src/services/room.ts').leaveRoom(RT_ROOM);
        if (success) await leave; else await assert.rejects(leave, { code: 'ROOM_BUSY' });
        assert.equal(socket.commands('UNSUBSCRIBE').length, success ? 1 : 0);
        off(); r.advance(10000); await settle(); assert.equal(r.timers.size, 0);
    }
});

test('116 auth recovery cannot connect or clear a different account after an awaited refresh', async () => {
    for (const fail of [true, false]) {
        const r = await realtimeRuntime(); let resolve;
        r.context.fetch = async () => new Promise(done => { resolve = done; });
        r.service.subscribeRoomEvents(RT_ROOM, () => {}); const socket = await r.connect();
        socket.receive('ERROR', { message: 'TOKEN_EXPIRED' }); await settle();
        await r.auth.clearLocalSession();
        await r.tokens.saveTokens('new-account-access', 'new-account-refresh', () => true);
        r.store.signIn({ userId: RT_OTHER, nickname: 'new account' });
        resolve(fail ? jsonResponse({ success: false, error: { code: 'TOKEN_INVALID' } }, 401) : jsonResponse({ success: true, data: { accessToken: 'fresh', refreshToken: 'rotated', accessTokenExpiresIn: 3600 } }));
        await settle(); r.advance(60000); await settle();
        assert.equal(r.sockets.length, 1);
        assert.equal(r.store.getSession()?.userId, RT_OTHER);
        assert.equal(r.tokens.getAccessToken(), 'new-account-access');
        r.service.dispose();
    }
});

test('116 listener/state observer exceptions and delayed callbacks after cleanup remain isolated', async () => {
    const r = await realtimeRuntime({ settleSubscriptions: false }); const states = []; let rejected = 0;
    const offState = r.service.subscribeRealtimeState(() => { throw Error('observer'); });
    r.service.subscribeRealtimeState(() => states.push(r.service.getRealtimeState()));
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onRejected: () => { throw Error('rejection'); } });
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onRejected: () => rejected++ });
    r.service.subscribeRoomEvents(RT_OTHER, () => {});
    const socket = await r.connect(); socket.receive('ERROR', { message: 'NOT_ROOM_MEMBER', 'receipt-id': r.receipt(socket, RT_ROOM) });
    assert.equal(rejected, 1); await r.reconnect(); assert.deepEqual(states.slice(0, 3), ['connecting', 'open', 'closed']);
    offState(); r.service.dispose(); r.advance(60000); await settle(); assert.equal(r.timers.size, 0);
});

test('116 foreground checks elapsed background time even when the OS did not run JS timers', async () => {
    const r = await realtimeRuntime(); let recovered = 0;
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onReconnected: () => recovered++ }); const socket = await r.connect();
    r.native.AppState.change('background');
    const originalDate = r.context.Date;
    r.context.Date = class extends originalDate { static now() { return originalDate.now() + 31000; } };
    r.native.AppState.change('active'); assert.equal(socket.readyState, 3); await r.connect(); assert.equal(recovered, 1);
    r.service.dispose(); assert.equal(r.timers.size, 0);
});

test('역 표시 이름은 공백과 빈 값을 정리하고 접미사를 한 번만 붙여요', () => {
    const { formatStationName } = createRuntime().load('src/utils/station-name.ts');
    for (const [name, expected] of [
        ['시청', '시청역'],
        ['서울역', '서울역'],
        ['총신대입구(이수)', '총신대입구(이수)역'],
        ['  시청 \t', '시청역'],
        ['  서울역  ', '서울역'],
        ['역삼', '역삼역'],
        ['', ''],
        [' \t\n', ''],
        [null, ''],
        [undefined, ''],
    ]) {
        assert.equal(formatStationName(name), expected);
    }
});

test('환경변수 기본값·정확한 true 비교·끝 슬래시·주소 누락', () => {
    const defaults = createRuntime().load('src/services/api/config.ts');
    assert.equal(defaults.USE_MOCK, true);
    assert.equal(defaults.useMock(), true);
    assert.equal(defaults.API_BASE_URL, '');
    for (const value of ['false', 'TRUE', '', '1']) {
        const config = createRuntime({ ...serverEnv, EXPO_PUBLIC_USE_MOCK: value }).load('src/services/api/config.ts');
        assert.equal(config.useMock(), false);
        assert.equal(config.API_BASE_URL, 'https://example.test/api/v1');
    }
    assert.throws(() => createRuntime({ EXPO_PUBLIC_USE_MOCK: 'false' }).load('src/services/api/config.ts'), /EXPO_PUBLIC_API_BASE_URL/);
});

test('성공 data·쿼리·JSON 본문·모든 메서드·빈 성공·헤더', async () => {
    const runtime = createRuntime(serverEnv);
    const api = runtime.load('src/services/api/client.ts');
    const calls = [];
    runtime.context.fetch = async (url, options) => { calls.push({ url, options }); return jsonResponse({ success: true, data: { id: 7 } }); };
    assert.deepEqual(plain(await api.get('/stations', { query: { keyword: ' 강남 & ', lineId: 2, zero: 0, flag: false, empty: '', omit: null, skip: undefined } })), { id: 7 });
    assert.equal(calls[0].url, 'https://example.test/api/v1/stations?keyword=%20%EA%B0%95%EB%82%A8%20%26%20&lineId=2&zero=0&flag=false&empty=');
    for (const method of ['post', 'put', 'patch']) {
        await api[method]('/users/me', { nickname: '민지' });
        const options = calls.at(-1).options;
        assert.equal(options.method, method.toUpperCase());
        assert.deepEqual(JSON.parse(options.body), { nickname: '민지' });
    }
    await api.delete('/users/me');
    assert.equal(calls.at(-1).options.method, 'DELETE');
    for (const { options } of calls) {
        assert.match(options.headers['Content-Type'], /application\/json/);
        assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
        assert.equal(Object.hasOwn(options, 'credentials'), false);
    }
    runtime.context.fetch = async () => ({ ok: true, status: 204, text: async () => '' });
    assert.equal(await api.delete('/users/me'), undefined);
    runtime.context.fetch = async () => jsonResponse({ success: true, data: null });
    assert.equal(await api.get('/rooms'), null);
    assert.equal(runtime.timers.size, 0);
});

test('서버 오류 코드·문구·details·상태를 유지하고 기본 문구로 보완', async () => {
    const runtime = createRuntime(serverEnv);
    const api = runtime.load('src/services/api/client.ts');
    const { ApiError } = runtime.load('src/services/api/errors.ts');
    runtime.context.fetch = async () => jsonResponse({ success: false, error: { code: 'NEW_SERVER_CODE', message: '서버 안내', details: { field: 'name' } } }, 422);
    await assert.rejects(api.get('/stations'), error => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, 'NEW_SERVER_CODE');
        assert.equal(error.message, '서버 안내');
        assert.equal(error.status, 422);
        assert.deepEqual(plain(error.details), { field: 'name' });
        return true;
    });
    runtime.context.fetch = async () => jsonResponse({ success: false, error: { code: 'VALIDATION_ERROR', message: '' } });
    await assert.rejects(api.get('/stations'), error => error.code === 'VALIDATION_ERROR' && error.message === '입력한 내용을 확인해 주세요.');
    assert.equal(runtime.timers.size, 0);
});

test('네트워크 실패와 HTML·JSON 파싱·응답 형식 오류를 구분', async () => {
    const runtime = createRuntime(serverEnv);
    const api = runtime.load('src/services/api/client.ts');
    runtime.context.fetch = async () => { throw new TypeError('연결 실패'); };
    await assert.rejects(api.get('/stations'), error => error.code === 'NETWORK_ERROR');
    for (const body of ['<html>오류</html>', '{', '{}', 'null', '{"success":true}', '{"success":false,"error":{}}']) {
        runtime.context.fetch = async () => ({ ok: false, status: 500, text: async () => body });
        await assert.rejects(api.get('/stations'), error => error.code === 'UNKNOWN_ERROR' && error.status === 500);
    }
    runtime.context.fetch = async () => ({ ok: true, status: 200, text: async () => '{' });
    await assert.rejects(api.get('/stations'), error => error.code === 'UNKNOWN_ERROR');
    assert.equal(runtime.timers.size, 0);
});

test('주입된 토큰만 사용하며 비인증 요청은 헤더 생략·401 재시도 없음', async () => {
    const runtime = createRuntime(serverEnv);
    const api = runtime.load('src/services/api/client.ts');
    const calls = [];
    let token = '현재토큰';
    api.setAccessTokenProvider(async () => token);
    runtime.context.fetch = async (_, options) => { calls.push(options); return jsonResponse({ success: true, data: null }); };
    await api.get('/users/me');
    assert.equal(calls.at(-1).headers.Authorization, 'Bearer 현재토큰');
    token = null;
    await api.get('/users/me');
    assert.equal(Object.hasOwn(calls.at(-1).headers, 'Authorization'), false);
    api.setAccessTokenProvider(() => { throw new Error('비인증 요청은 조회하지 않아야 해요.'); });
    await api.post('/auth/kakao', {}, { auth: false });
    assert.equal(Object.hasOwn(calls.at(-1).headers, 'Authorization'), false);
    api.setAccessTokenProvider(null);
    let count = 0;
    runtime.context.fetch = async () => { count++; return jsonResponse({ success: false, error: { code: 'TOKEN_INVALID' } }, 401); };
    await assert.rejects(api.get('/users/me'), error => error.code === 'TOKEN_INVALID');
    assert.equal(count, 1);
});

test('요청과 본문 읽기 모두 10초 후 중단하고 타이머 정리', async () => {
    for (const phase of ['요청', '본문']) {
        const runtime = createRuntime(serverEnv);
        const api = runtime.load('src/services/api/client.ts');
        let signal;
        runtime.context.fetch = (_, options) => {
            signal = options.signal;
            const pending = () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('중단'))));
            return phase === '요청' ? pending() : Promise.resolve({ ok: true, status: 200, text: pending });
        };
        const result = api.get('/stations');
        const rejection = assert.rejects(result, error => error.code === 'NETWORK_ERROR');
        for (let i = 0; i < 5; i++) await Promise.resolve();
        const timer = [...runtime.timers.values()][0];
        assert.equal(timer.ms, 10000);
        timer.callback();
        await rejection;
        assert.equal(signal.aborted, true);
        assert.equal(runtime.timers.size, 0);
    }
});

test('mock 역 검색의 정규화·정렬·미제공·노선·페이지와 서버 전환', async () => {
    const runtime = createRuntime();
    const { searchStations } = runtime.load('src/services/station.ts');
    const mocks = runtime.load('src/mocks/stations.ts');
    for (const keyword of ['', ' ', '강남', ' 강남역 ', '홍대', '공항', '없는역', ...mocks.MOCK_STATIONS.map(station => station.name)]) {
        const result = await searchStations(keyword);
        assert.deepEqual(plain(result.items), plain(mocks.searchStations(keyword)));
        assert.equal(result.totalElements, mocks.searchStations(keyword).length);
    }
    assert.deepEqual(plain((await searchStations('강남')).items.map(station => station.id)), [105, 106]);
    assert.equal((await searchStations('판교')).items[0].isSupported, false);
    assert.equal((await searchStations('강남', { lineId: 7 })).items[0].id, 106);
    assert.equal((await searchStations('강남', { page: 1, size: 1 })).items[0].id, 106);
    assert.equal((await searchStations('강남', { size: 999 })).size, 50);
    assert.equal(runtime.timers.size, 0);

    const server = createRuntime(serverEnv);
    const service = server.load('src/services/station.ts');
    const calls = [];
    const data = { items: [plain(mocks.MOCK_STATIONS[0])], page: 2, size: 50, totalElements: 101 };
    server.context.fetch = async (url, options) => { calls.push({ url, options }); return jsonResponse({ success: true, data }); };
    assert.deepEqual(plain(await service.searchStations('   ')), { items: [], page: 0, size: 50, totalElements: 0 });
    assert.equal(calls.length, 0);
    assert.deepEqual(plain(await service.searchStations(' 서울역 ', { lineId: 1, page: 2, size: 100 })), data);
    assert.equal(calls[0].url, 'https://example.test/api/v1/stations?keyword=%EC%84%9C%EC%9A%B8%EC%97%AD&lineId=1&page=2&size=50');
});

/** 화면 상태와 효과만 구동하는 검사 장치입니다. 브라우저 육안 검사를 대신하지 않습니다. */
function createScreenRuntime(env = {}, screenPath = 'src/app/station-search.tsx', setup = () => {}) {
    let cursor = 0;
    let slots = [];
    const rootSlots = slots;
    const componentSlots = new Map();
    const effects = [];
    const react = {
        useSyncExternalStore: (_subscribe, read) => read(),
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useMemo: callback => callback(),
        useCallback: callback => callback,
        useEffect(callback, dependencies) {
            const index = cursor++;
            const previous = slots[index];
            if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
                effects.push(() => {
                    previous?.cleanup?.();
                    slots[index] = { dependencies, cleanup: callback() };
                });
            }
        },
    };
    const runtime = createRuntime(env, react);
    setup(runtime);
    const screen = runtime.load(screenPath);
    return {
        ...runtime,
        screen,
        render() { slots = rootSlots; cursor = 0; const view = screen.default(); effects.splice(0).forEach(effect => effect()); return view; },
        renderComponent(element) {
            if (!componentSlots.has(element.type)) componentSlots.set(element.type, []);
            slots = componentSlots.get(element.type); cursor = 0;
            const view = element.type(element.props); effects.splice(0).forEach(effect => effect());
            return view;
        },
        unmount() { [rootSlots, ...componentSlots.values()].forEach(values => values.forEach(slot => slot?.cleanup?.())); },
    };
}

function findElement(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(child => findElement(child, predicate)).find(Boolean) ?? null;
    if (predicate(node)) return node;
    return findElement(node.props?.children, predicate);
}

async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }

test('mock 화면의 최근 검색·검색 결과·미제공 표시와 선택 제한 유지', async () => {
    const runtime = createScreenRuntime();
    let view = runtime.render();
    assert.equal(findElement(view, element => element.type === 'FlatList').props.data.length, 0);
    findElement(view, element => element.type === 'TextInput').props.onChangeText('판교');
    runtime.render();
    runtime.advance(300);
    await settle();
    view = runtime.render();
    const list = findElement(view, element => element.type === 'FlatList');
    assert.equal(list.props.data[0].id, 903);
    const wrapper = list.props.renderItem({ item: list.props.data[0], index: 0 });
    const stationRow = wrapper.props.children;
    const row = stationRow.type(stationRow.props);
    assert.equal(findElement(row, element => element.type === 'Text' && element.props.children === '미제공').props.children, '미제공');
    row.props.onPress();
    view = runtime.render();
    const unsupported = findElement(view, element => element.props?.station?.id === 903 && Array.isArray(element.props.nearby));
    assert.equal(unsupported.props.nearby.length, 2);
    assert.equal(runtime.screen.getRecentStations().length, 0);

    let picked;
    runtime.screen.openStationPicker({ purpose: 'origin' }, station => { picked = station; });
    findElement(view, element => element.type === 'TextInput').props.onChangeText('강남');
    runtime.render(); runtime.advance(300); await settle(); view = runtime.render();
    const supported = findElement(view, element => element.type === 'FlatList');
    assert.deepEqual(plain(supported.props.data.map(station => station.id)), [105, 106]);
    const item = supported.props.renderItem({ item: supported.props.data[0], index: 0 }).props.children;
    item.type(item.props).props.onPress();
    assert.equal(picked.id, 105);
    assert.equal(runtime.screen.getRecentStations()[0].id, 105);
    runtime.unmount();
    assert.equal(runtime.timers.size, 0);
});

test('서버 검색 화면이 늦은 이전 응답과 닫힌 화면의 응답을 무시', async () => {
    const runtime = createScreenRuntime(serverEnv);
    const pending = [];
    runtime.context.fetch = () => new Promise(resolve => pending.push(resolve));
    let view = runtime.render();
    findElement(view, element => element.type === 'TextInput').props.onChangeText('이전');
    runtime.render(); runtime.advance(300); await settle();
    view = runtime.render();
    findElement(view, element => element.type === 'TextInput').props.onChangeText('현재');
    runtime.render(); runtime.advance(300); await settle();
    const station = { ...plain(runtime.load('src/mocks/stations.ts').MOCK_STATIONS[0]), name: '현재' };
    pending[1](jsonResponse({ success: true, data: { items: [station], page: 0, size: 50, totalElements: 1 } }));
    await settle();
    pending[0](jsonResponse({ success: true, data: { items: [], page: 0, size: 50, totalElements: 0 } }));
    await settle(); view = runtime.render();
    assert.equal(findElement(view, element => element.type === 'FlatList').props.data[0].name, '현재');
    findElement(view, element => element.type === 'TextInput').props.onChangeText('닫기 전');
    runtime.render(); runtime.advance(300); await settle(); runtime.unmount();
    pending[2](jsonResponse({ success: true, data: { items: [], page: 0, size: 50, totalElements: 0 } }));
    await settle();
    assert.equal(runtime.timers.size, 0);
});

test('서버 모드의 미지원 역 안내에 mock 대안역과 선택 경로가 없음', async () => {
    const runtime = createScreenRuntime(serverEnv);
    // 서울역과 같은 위치에 두어 기존 계산이라면 mock ID 101이 추천되도록 합니다.
    const station = { id: 88001, name: '서버 미지원역', latitude: 37.5547, longitude: 126.9707, isSupported: false, lines: [] };
    runtime.context.fetch = async () => jsonResponse({ success: true, data: { items: [station], page: 0, size: 50, totalElements: 1 } });
    assert.deepEqual(plain(runtime.screen.findNearbySupported(station)), []);
    let picked;
    runtime.screen.openStationPicker({ purpose: 'origin' }, value => { picked = value; });
    let view = runtime.render();
    findElement(view, element => element.type === 'TextInput').props.onChangeText('서버');
    runtime.render(); runtime.advance(300); await settle(); view = runtime.render();
    const list = findElement(view, element => element.type === 'FlatList');
    const item = list.props.renderItem({ item: list.props.data[0], index: 0 }).props.children;
    item.type(item.props).props.onPress();
    view = runtime.render();
    const sheet = findElement(view, element => element.props?.station?.id === station.id && Array.isArray(element.props.nearby));
    assert.deepEqual(plain(sheet.props.nearby), []);
    const renderedSheet = sheet.type(sheet.props);
    assert.equal(findElement(renderedSheet, element => element.props?.children === '대신 이런 역은 어떠세요?'), null);
    assert.equal(findElement(renderedSheet, element => element.props?.accessibilityLabel?.includes('선택, 도보')), null);
    sheet.props.onPickNearby(runtime.load('src/mocks/stations.ts').MOCK_STATIONS[0]);
    assert.equal(picked, undefined);
    assert.equal(runtime.screen.getRecentStations().length, 0);
    runtime.unmount();
    assert.equal(runtime.timers.size, 0);
});

test('300ms 디바운스는 연속 입력을 한 요청으로 묶고 삭제·이탈 시 취소', async () => {
    const runtime = createScreenRuntime(serverEnv);
    const calls = [];
    runtime.context.fetch = async url => { calls.push(url); return jsonResponse({ success: true, data: { items: [], page: 0, size: 50, totalElements: 0 } }); };
    let view = runtime.render();
    for (const text of ['강', '강남', '강남역']) {
        findElement(view, element => element.type === 'TextInput').props.onChangeText(text);
        view = runtime.render(); runtime.advance(100); await settle();
        assert.equal(calls.length, 0);
    }
    runtime.advance(199); await settle(); assert.equal(calls.length, 0);
    runtime.advance(1); await settle(); assert.equal(calls.length, 1);
    assert.match(calls[0], /keyword=%EA%B0%95%EB%82%A8%EC%97%AD/);
    view = runtime.render();
    findElement(view, element => element.type === 'TextInput').props.onChangeText('사당');
    view = runtime.render(); runtime.advance(100);
    findElement(view, element => element.type === 'TextInput').props.onChangeText('');
    view = runtime.render(); runtime.advance(300); await settle();
    assert.equal(calls.length, 1);
    findElement(view, element => element.type === 'TextInput').props.onChangeText('잠실');
    runtime.render(); runtime.unmount(); runtime.advance(300); await settle();
    assert.equal(calls.length, 1);
    assert.equal(runtime.timers.size, 0);
});

test('fetchStation: mock 반환·없는 역 STATION_NOT_FOUND·서버 파싱과 오류 코드 유지', async () => {
    const mock = createRuntime();
    const service = mock.load('src/services/station.ts');
    const mocks = mock.load('src/mocks/stations.ts');
    const { ApiError } = mock.load('src/services/api/errors.ts');
    const detail = await service.fetchStation(105);
    assert.deepEqual(plain(detail), plain(mocks.MOCK_STATIONS.find(station => station.id === 105)));
    detail.lines[0].color = '#000000';
    assert.notEqual(mocks.MOCK_STATIONS.find(station => station.id === 105).lines[0].color, '#000000');
    for (const id of [999999, 0, -1, 1.5, Number.NaN]) {
        await assert.rejects(service.fetchStation(id), error => error instanceof ApiError && error.code === 'STATION_NOT_FOUND' && error.status === 404);
    }

    const server = createRuntime(serverEnv);
    const api = server.load('src/services/station.ts');
    const calls = [];
    const station = { id: 88001, name: '서버역', latitude: 37.5, longitude: 127, isSupported: false, lines: [{ lineId: 41, lineName: '수인분당선', color: '#F5A200', stationCode: 'K211' }] };
    server.context.fetch = async url => { calls.push(url); return jsonResponse({ success: true, data: station }); };
    assert.deepEqual(plain(await api.fetchStation(88001)), station);
    assert.equal(calls[0], 'https://example.test/api/v1/stations/88001');
    // 서버 모드에서는 mock 목록에 있는 ID 라도 mock 값을 돌려주지 않고 서버를 불러요.
    await api.fetchStation(105);
    assert.equal(calls[1], 'https://example.test/api/v1/stations/105');
    await assert.rejects(api.fetchStation(0), error => error.code === 'STATION_NOT_FOUND');
    assert.equal(calls.length, 2);

    server.context.fetch = async () => jsonResponse({ success: false, error: { code: 'STATION_NOT_FOUND', message: '역을 찾을 수 없습니다.' } }, 404);
    await assert.rejects(api.fetchStation(1), error => error.code === 'STATION_NOT_FOUND' && error.status === 404 && error.message === '역을 찾을 수 없습니다.');
    server.context.fetch = async () => jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED' } }, 401);
    await assert.rejects(api.fetchStation(1), error => error.code === 'TOKEN_EXPIRED' && error.status === 401);
    for (const data of [null, {}, { ...station, lines: null }, { ...station, id: '88001' }, { ...station, lines: [{ lineId: 1 }] }]) {
        server.context.fetch = async () => jsonResponse({ success: true, data });
        await assert.rejects(api.fetchStation(1), error => error.code === 'UNKNOWN_ERROR');
    }
    assert.equal(server.timers.size, 0);
});

test('fetchLines: mock 노선·서버 파싱·실패하면 기존 노선 값으로 대체', async () => {
    const mock = createRuntime();
    const service = mock.load('src/services/station.ts');
    const { MOCK_LINES } = mock.load('src/mocks/stations.ts');
    const lines = await service.fetchLines();
    assert.deepEqual(plain(lines.slice(0, 2)), [
        { id: 1, lineCode: '1', name: '1호선', color: '#0052A4' },
        { id: 2, lineCode: '2', name: '2호선', color: '#00A84D' },
    ]);
    // 기존 하드코딩 색(direction.ts LINE_COLORS)과 같은 값이어야 대체해도 화면이 바뀌지 않아요.
    const { LINE_COLORS } = mock.load('src/services/direction.ts');
    for (const [id, color] of Object.entries(LINE_COLORS)) assert.equal(lines.find(line => line.id === Number(id)).color, color);
    // 서버(DB 시드)와 같은 lineCode 형식: 1호선 "1" … 8호선 "8"
    assert.deepEqual(plain(lines.filter(line => line.id <= 8).map(line => line.lineCode)), ['1', '2', '3', '4', '5', '6', '7', '8']);
    lines[0].color = '#000000';
    assert.equal(MOCK_LINES[0].color, '#0052A4');

    const server = createRuntime(serverEnv);
    const api = server.load('src/services/station.ts');
    const fallback = plain(server.load('src/mocks/stations.ts').MOCK_LINES);
    const data = [{ id: 2, lineCode: '2', name: '2호선', color: '#00A84D' }, { id: 41, lineCode: 'K', name: '수인분당선', color: '#F5A200' }];
    const calls = [];
    server.context.fetch = async url => { calls.push(url); return jsonResponse({ success: true, data }); };
    assert.deepEqual(plain(await api.fetchLines()), data);
    assert.equal(calls[0], 'https://example.test/api/v1/lines');
    const failures = [
        async () => { throw new TypeError('연결 실패'); },
        async () => jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR' } }, 500),
        async () => jsonResponse({ success: false, error: { code: 'AUTH_REQUIRED' } }, 401),
        async () => ({ ok: true, status: 200, text: async () => '<html>' }),
        async () => jsonResponse({ success: true, data: [{ id: '2', name: '2호선' }] }),
        async () => jsonResponse({ success: true, data: { items: [] } }),
    ];
    for (const failure of failures) {
        server.context.fetch = failure;
        assert.deepEqual(plain(await api.fetchLines()), fallback);
    }
    assert.equal(server.timers.size, 0);
});

test('역 검색: 50자 초과는 서버를 부르지 않고 VALIDATION_ERROR, 응답 형식 오류는 UNKNOWN_ERROR', async () => {
    const server = createRuntime(serverEnv);
    const api = server.load('src/services/station.ts');
    const calls = [];
    server.context.fetch = async url => { calls.push(url); return jsonResponse({ success: true, data: { items: [], page: 0, size: 50, totalElements: 0 } }); };
    await api.searchStations(`  ${'가'.repeat(50)}  `);
    assert.equal(calls.length, 1);
    await assert.rejects(api.searchStations('가'.repeat(51)), error => error.code === 'VALIDATION_ERROR' && error.status === 400);
    assert.equal(calls.length, 1);
    // 서버는 코드 포인트로 세요: 이모지 26개(코드 포인트 26, UTF-16 52)는 서버를 부르고, 51 코드 포인트는 거절해요.
    const emoji = '🚇'.repeat(26);
    assert.equal(Array.from(emoji).length, 26);
    assert.equal(emoji.length, 52);
    await api.searchStations(emoji);
    assert.equal(calls.length, 2);
    await assert.rejects(api.searchStations(`${'🚇'.repeat(26)}${'가'.repeat(25)}`), error => error.code === 'VALIDATION_ERROR' && error.status === 400);
    assert.equal(calls.length, 2);
    server.context.fetch = async () => jsonResponse({ success: true, data: { items: [{ id: 1, name: '역' }], page: 0, size: 50, totalElements: 1 } });
    await assert.rejects(api.searchStations('역'), error => error.code === 'UNKNOWN_ERROR');
    const mock = createRuntime().load('src/services/station.ts');
    await assert.rejects(mock.searchStations('가'.repeat(51)), error => error.code === 'VALIDATION_ERROR');
});

test('검색 화면이 로딩·결과 없음·401·네트워크·4xx·5xx 를 구분하고 입력을 50자로 제한', async () => {
    const runtime = createScreenRuntime(serverEnv);
    let respond;
    runtime.context.fetch = async () => respond();
    const texts = node => {
        if (!node || typeof node !== 'object') return typeof node === 'string' || typeof node === 'number' ? [String(node)] : [];
        if (Array.isArray(node)) return node.flatMap(texts);
        return texts(node.props?.children);
    };
    const searchFor = async keyword => {
        const view = runtime.render();
        findElement(view, element => element.type === 'TextInput').props.onChangeText(keyword);
        const loading = runtime.render();
        runtime.advance(300); await settle();
        return { loading, view: runtime.render() };
    };
    const retryButton = view => findElement(view, element => element.type === 'Pressable' && texts(element).includes('다시 시도'));

    assert.equal(findElement(runtime.render(), element => element.type === 'TextInput').props.maxLength, 50);

    respond = () => jsonResponse({ success: true, data: { items: [], page: 0, size: 50, totalElements: 0 } });
    let { loading, view } = await searchFor('없는역');
    assert.ok(texts(loading).includes('역을 검색하고 있어요'));
    assert.ok(texts(findElement(view, element => typeof element.type === 'function' && element.props.keyword === '없는역')?.type({ keyword: '없는역', onRetry() {} })).join('').includes('일치하는'));

    const cases = [
        [() => jsonResponse({ success: false, error: { code: 'AUTH_REQUIRED' } }, 401), '로그인이 필요해요', false],
        [() => jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED', message: '만료' } }, 401), '로그인이 필요해요', false],
        [() => { throw new TypeError('연결 실패'); }, '서버에 연결하지 못했어요', true],
        [() => jsonResponse({ success: false, error: { code: 'VALIDATION_ERROR', message: 'keyword 는 50자 이하' } }, 400), '검색어를 확인해 주세요', false],
        [() => jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR', message: 'NullPointerException' } }, 500), '역 정보를 불러오지 못했어요', true],
    ];
    for (const [index, [response, title, retry]] of cases.entries()) {
        respond = response;
        ({ view } = await searchFor(`역${index}`));
        assert.ok(texts(view).includes(title), title);
        assert.equal(!!retryButton(view), retry, title);
        assert.equal(texts(view).includes('NullPointerException'), false);
    }

    // 다시 시도는 같은 검색어로 한 번 더 요청해요.
    let count = 0;
    respond = () => { count++; throw new TypeError('연결 실패'); };
    ({ view } = await searchFor('재시도'));
    respond = () => { count++; return jsonResponse({ success: true, data: { items: [{ id: 88002, name: '재시도', latitude: 37.5, longitude: 127, isSupported: true, lines: [] }], page: 0, size: 50, totalElements: 1 } }); };
    retryButton(view).props.onPress();
    runtime.render(); runtime.advance(300); await settle(); view = runtime.render();
    assert.equal(count, 2);
    assert.equal(findElement(view, element => element.type === 'FlatList').props.data[0].id, 88002);
    runtime.unmount();
});

test('검색 결과가 첫 페이지보다 많으면 50개만 보여주고 안내', async () => {
    const runtime = createScreenRuntime(serverEnv);
    const items = Array.from({ length: 50 }, (_, i) => ({ id: 90000 + i, name: `서버역${i}`, latitude: 37.5, longitude: 127, isSupported: true, lines: [] }));
    const calls = [];
    runtime.context.fetch = async url => { calls.push(url); return jsonResponse({ success: true, data: { items, page: 0, size: 50, totalElements: 120 } }); };
    let view = runtime.render();
    findElement(view, element => element.type === 'TextInput').props.onChangeText('서버');
    runtime.render(); runtime.advance(300); await settle(); view = runtime.render();
    assert.match(calls[0], /page=0&size=50$/);
    const list = findElement(view, element => element.type === 'FlatList');
    assert.equal(list.props.data.length, 50);
    assert.deepEqual(plain(list.props.ListFooterComponent.props.children.slice(0, 4)), ['검색 결과 ', 120, '개 중 ', 50]);
    runtime.unmount();
});

test('서버 모드에서 고른 서버 역(id 포함)을 호출 화면에 그대로 돌려줌', async () => {
    const runtime = createScreenRuntime(serverEnv);
    // mock 서울역(101)과 같은 id 지만 서버 값이 그대로 전달돼야 해요.
    const station = { id: 101, name: '서버 건대입구', latitude: 37.54, longitude: 127.07, isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D', stationCode: '212' }] };
    runtime.context.fetch = async () => jsonResponse({ success: true, data: { items: [station], page: 0, size: 50, totalElements: 1 } });
    let picked;
    runtime.screen.openStationPicker({ purpose: 'departure' }, value => { picked = value; });
    let view = runtime.render();
    findElement(view, element => element.type === 'TextInput').props.onChangeText('건대');
    runtime.render(); runtime.advance(300); await settle(); view = runtime.render();
    const list = findElement(view, element => element.type === 'FlatList');
    const item = list.props.renderItem({ item: list.props.data[0], index: 0 }).props.children;
    item.type(item.props).props.onPress();
    assert.deepEqual(plain(picked), station);
    assert.deepEqual(plain(runtime.screen.getRecentStations()[0]), station);
    runtime.screen.clearRecentStations();
    runtime.unmount();
});

/* ---------- 혼잡도 조회 (#86, 명세 6.2) ---------- */

const congestionData = (overrides = {}) => ({
    stationId: 222, lineId: 2, direction: 'INNER', dayType: 'WEEKDAY', slotStart: '08:00', slotDate: '2026-11-11',
    firstTrain: false, supported: true, pct: 78, level: 'NORMAL', levelLabel: '보통', source: 'PREDICTED', ...overrides,
});

async function mockCongestion(runtime, service, query, mock) {
    const result = service.fetchCongestion(query, mock);
    runtime.advance(500);
    return result;
}

test('혼잡도 서버 요청: 쿼리 값·date 가 있으면 dayType 생략·방향값 그대로', async () => {
    const server = createRuntime(serverEnv);
    const service = server.load('src/services/congestion.ts');
    const calls = [];
    server.context.fetch = async url => { calls.push(url); return jsonResponse({ success: true, data: congestionData() }); };
    await service.fetchCongestion({ stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', date: '2026-11-11', dayType: 'SUNDAY' });
    assert.equal(calls[0], 'https://example.test/api/v1/congestion?stationId=222&lineId=2&direction=INNER&time=08%3A10&date=2026-11-11');
    await service.fetchCongestion({ stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', dayType: 'SATURDAY' });
    assert.equal(calls[1], 'https://example.test/api/v1/congestion?stationId=222&lineId=2&direction=INNER&time=08%3A10&dayType=SATURDAY');
    // 1호선 UP(소요산 방향)·DOWN(인천·신창 방향)을 포함해 방향값을 바꾸지 않고 그대로 실어요.
    for (const [lineId, direction] of [[1, 'UP'], [1, 'DOWN'], [2, 'INNER'], [2, 'OUTER'], [6, 'LOOP']]) {
        await service.fetchCongestion({ stationId: 150, lineId, direction, time: '00:00', dayType: 'WEEKDAY' });
        const params = new URL(calls.at(-1)).searchParams;
        assert.equal(params.get('lineId'), String(lineId));
        assert.equal(params.get('direction'), direction);
        assert.equal(params.get('time'), '00:00');
    }
    // 서버 모드에서는 mock 상태 인자를 무시하고 서버를 불러요.
    await service.fetchCongestion({ stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', dayType: 'WEEKDAY' }, 'error');
    assert.equal(calls.length, 8);
    assert.equal(server.timers.size, 0);
});

test('혼잡도 응답 검사: 정상·데이터 없음 통과, 형식 오류는 UNKNOWN_ERROR', async () => {
    const server = createRuntime(serverEnv);
    const service = server.load('src/services/congestion.ts');
    const { toCongestion } = server.load('src/types/congestion.ts');
    const query = { stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', date: '2026-11-11' };
    const respond = data => { server.context.fetch = async () => jsonResponse({ success: true, data }); };

    respond({ ...congestionData({ source: 'ESTIMATED' }), extra: 1 });
    const ok = await service.fetchCongestion(query);
    assert.deepEqual(plain(ok), congestionData({ source: 'ESTIMATED' }));
    assert.deepEqual(plain(toCongestion(ok)), { supported: true, kind: 'ESTIMATED', pct: 78, level: 'NORMAL', levelLabel: '보통' });

    // 데이터 없음(200): 네 값은 보지 않고 null 로 돌려줘요. slotDate 는 date 가 없으면 null 이에요.
    for (const empty of [
        congestionData({ supported: false, pct: null, level: null, levelLabel: null, source: null, slotDate: null }),
        congestionData({ supported: false, pct: 12, level: '이상한값', levelLabel: 3, source: 'X', slotDate: null }),
        congestionData({ supported: false, direction: 'INNER', lineId: 1, firstTrain: true, slotStart: '05:30' }),
    ]) {
        respond(empty);
        const data = await service.fetchCongestion(query);
        assert.equal(data.supported, false);
        assert.deepEqual([data.pct, data.level, data.levelLabel, data.source], [null, null, null, null]);
        assert.deepEqual(plain(toCongestion(data)), { supported: false, kind: null, pct: null, level: null, levelLabel: null });
    }

    const broken = [
        null, {}, [],
        ...['stationId', 'lineId', 'direction', 'dayType', 'slotStart', 'slotDate', 'firstTrain', 'supported']
            .map(key => { const data = congestionData(); delete data[key]; return data; }),
        congestionData({ stationId: '222' }),
        congestionData({ direction: 'NORTH' }),
        congestionData({ dayType: 'HOLIDAY' }),
        congestionData({ slotStart: '8:00' }),
        congestionData({ slotDate: '2026/11/11' }),
        congestionData({ firstTrain: 'false' }),
        congestionData({ supported: 'true' }),
        // supported=true 인데 값이 빠졌거나 형식이 달라요.
        ...['pct', 'level', 'levelLabel', 'source'].map(key => congestionData({ [key]: null })),
        congestionData({ level: 'BUSY' }),
        congestionData({ pct: '78' }),
        congestionData({ source: undefined, kind: 'PREDICTED' }),
    ];
    for (const data of broken) {
        respond(data);
        await assert.rejects(service.fetchCongestion(query), error => error.code === 'UNKNOWN_ERROR', JSON.stringify(data));
    }
    assert.equal(server.timers.size, 0);
});

test('혼잡도 오류 코드: 400·401·404(STATION_NOT_FOUND·NOT_FOUND)를 code 그대로 구분', async () => {
    const server = createRuntime(serverEnv);
    const service = server.load('src/services/congestion.ts');
    const { ApiError, API_ERROR_MESSAGES, isAuthError } = server.load('src/services/api/errors.ts');
    const query = { stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', dayType: 'WEEKDAY' };
    const cases = [
        ['VALIDATION_ERROR', 400, null],
        ['AUTH_REQUIRED', 401, null],
        ['TOKEN_EXPIRED', 401, null],
        ['TOKEN_INVALID', 401, null],
        ['STATION_NOT_FOUND', 404, null],
        ['NOT_FOUND', 404, { lineId: 2 }],
    ];
    for (const [code, status, details] of cases) {
        server.context.fetch = async () => jsonResponse({ success: false, error: { code, message: '', details } }, status);
        await assert.rejects(service.fetchCongestion(query), error => {
            assert.ok(error instanceof ApiError);
            assert.equal(error.code, code);
            assert.equal(error.status, status);
            assert.equal(error.message, API_ERROR_MESSAGES[code]);
            assert.deepEqual(plain(error.details), details);
            assert.equal(isAuthError(error), status === 401);
            return true;
        });
    }
    assert.equal(API_ERROR_MESSAGES.NOT_FOUND, '해당 노선에서 그 역의 혼잡도를 찾지 못했어요.');
});

test('혼잡도 잘못된 요청은 서버를 부르지 않고 VALIDATION_ERROR(400), mock 도 같음', async () => {
    const server = createRuntime(serverEnv);
    const service = server.load('src/services/congestion.ts');
    let count = 0;
    server.context.fetch = async () => { count++; return jsonResponse({ success: true, data: congestionData() }); };
    const base = { stationId: 222, lineId: 2, direction: 'INNER', time: '08:10', dayType: 'WEEKDAY' };
    const invalid = [
        { ...base, time: '24:00' },
        { ...base, time: '8:10' },
        { ...base, time: '08:60' },
        { ...base, time: undefined },
        { ...base, dayType: undefined },
        { ...base, dayType: 'HOLIDAY' },
        { ...base, dayType: undefined, date: '2026-11-31' },
        { ...base, date: '2026/11/11' },
        { ...base, date: '' },
        { ...base, direction: 'up' },
        { ...base, direction: undefined },
        { ...base, stationId: 0 },
        { ...base, stationId: 1.5 },
        { ...base, lineId: Number.NaN },
    ];
    const mockRuntime = createRuntime();
    const mockService = mockRuntime.load('src/services/congestion.ts');
    for (const query of invalid) {
        await assert.rejects(service.fetchCongestion(query), error => error.code === 'VALIDATION_ERROR' && error.status === 400, JSON.stringify(query));
        await assert.rejects(mockService.fetchCongestion(query), error => error.code === 'VALIDATION_ERROR' && error.status === 400, JSON.stringify(query));
    }
    assert.equal(count, 0);
    assert.equal(mockRuntime.timers.size, 0);
    // 경계값은 통과해요: 00:00·23:59, date 가 있으면 dayType 이 없어도 돼요.
    await service.fetchCongestion({ ...base, time: '00:00' });
    await service.fetchCongestion({ ...base, time: '23:59' });
    await service.fetchCongestion({ ...base, dayType: undefined, date: '2028-02-29' });
    assert.equal(count, 3);
});

test('resolveSlot: 05:30 시작·39칸·자정 이후 전날 영업일·01:00~05:29 첫차·영업일 dayType', () => {
    const { resolveSlot, CONGESTION_SLOT_STARTS, FIRST_TRAIN_SLOT } = createRuntime().load('src/services/congestion.ts');
    assert.equal(FIRST_TRAIN_SLOT, '05:30');
    assert.equal(CONGESTION_SLOT_STARTS.length, 39);
    assert.deepEqual(plain(CONGESTION_SLOT_STARTS.slice(0, 2)), ['05:30', '06:00']);
    assert.deepEqual(plain(CONGESTION_SLOT_STARTS.slice(-4)), ['23:00', '23:30', '00:00', '00:30']);
    // 2026-11-13 금, 11-14 토, 11-15 일, 11-16 월
    const at = (day, hour, minute) => new Date(2026, 10, day, hour, minute);
    const cases = [
        [at(13, 5, 30), { slotStart: '05:30', slotDate: '2026-11-13', firstTrain: false, dayType: 'WEEKDAY' }],
        [at(13, 14, 0), { slotStart: '14:00', slotDate: '2026-11-13', firstTrain: false, dayType: 'WEEKDAY' }],
        [at(13, 23, 45), { slotStart: '23:30', slotDate: '2026-11-13', firstTrain: false, dayType: 'WEEKDAY' }],
        [at(13, 23, 59), { slotStart: '23:30', slotDate: '2026-11-13', firstTrain: false, dayType: 'WEEKDAY' }],
        [at(14, 0, 10), { slotStart: '00:00', slotDate: '2026-11-13', firstTrain: false, dayType: 'WEEKDAY' }],
        [at(14, 0, 59), { slotStart: '00:30', slotDate: '2026-11-13', firstTrain: false, dayType: 'WEEKDAY' }],
        [at(14, 1, 0), { slotStart: '05:30', slotDate: '2026-11-14', firstTrain: true, dayType: 'SATURDAY' }],
        [at(14, 3, 0), { slotStart: '05:30', slotDate: '2026-11-14', firstTrain: true, dayType: 'SATURDAY' }],
        [at(14, 5, 29), { slotStart: '05:30', slotDate: '2026-11-14', firstTrain: true, dayType: 'SATURDAY' }],
        [at(15, 0, 20), { slotStart: '00:00', slotDate: '2026-11-14', firstTrain: false, dayType: 'SATURDAY' }],
        [at(16, 0, 40), { slotStart: '00:30', slotDate: '2026-11-15', firstTrain: false, dayType: 'SUNDAY' }],
        [new Date(2026, 11, 1, 0, 5), { slotStart: '00:00', slotDate: '2026-11-30', firstTrain: false, dayType: 'WEEKDAY' }],
    ];
    for (const [date, expected] of cases) assert.deepEqual(plain(resolveSlot(date)), expected, date.toString());
    // 하루 1분 단위로 모든 결과가 39칸 안에 있어요.
    for (let minute = 0; minute < 24 * 60; minute++) {
        assert.ok(CONGESTION_SLOT_STARTS.includes(resolveSlot(at(13, 0, minute)).slotStart));
    }
});

test('mock 혼잡도: slotDate·dayType 규칙, 여러 단계·데이터 없음·첫차·오류 상태', async () => {
    const runtime = createRuntime();
    const service = runtime.load('src/services/congestion.ts');
    const { toCongestion } = runtime.load('src/types/congestion.ts');
    const { ApiError } = runtime.load('src/services/api/errors.ts');
    runtime.context.fetch = async () => { throw new Error('mock 모드에서는 서버를 부르지 않아야 해요.'); };
    const base = { stationId: 222, lineId: 2, direction: 'INNER' };

    // date 가 있으면 영업일 날짜·영업일 dayType(요청 dayType 무시). 토요일 00:10 → 금요일 영업일.
    let data = await mockCongestion(runtime, service, { ...base, time: '00:10', date: '2026-11-14', dayType: 'SUNDAY' });
    assert.deepEqual([data.slotStart, data.slotDate, data.dayType, data.firstTrain], ['00:00', '2026-11-13', 'WEEKDAY', false]);
    data = await mockCongestion(runtime, service, { ...base, time: '14:00', date: '2026-11-14' });
    assert.deepEqual([data.slotStart, data.slotDate, data.dayType, data.firstTrain], ['14:00', '2026-11-14', 'SATURDAY', false]);
    data = await mockCongestion(runtime, service, { ...base, time: '03:00', date: '2026-11-15' });
    assert.deepEqual([data.slotStart, data.slotDate, data.dayType, data.firstTrain], ['05:30', '2026-11-15', 'SUNDAY', true]);
    // date 가 없으면 slotDate 는 null, dayType 은 요청 값 그대로예요.
    for (const [time, slotStart, firstTrain] of [['14:00', '14:00', false], ['03:00', '05:30', true], ['00:40', '00:30', false]]) {
        data = await mockCongestion(runtime, service, { ...base, time, dayType: 'SATURDAY' });
        assert.deepEqual([data.slotStart, data.slotDate, data.dayType, data.firstTrain], [slotStart, null, 'SATURDAY', firstTrain]);
    }

    // 여러 단계가 나오고, 출처는 MOCK 이에요.
    const levels = new Set();
    for (const stationId of [220, 221, 222, 223]) {
        for (const time of ['08:00', '14:00']) {
            const item = await mockCongestion(runtime, service, { stationId, lineId: 2, direction: 'OUTER', time, dayType: 'WEEKDAY' });
            assert.equal(item.supported, true);
            assert.equal(item.source, 'MOCK');
            levels.add(item.level);
        }
    }
    assert.ok(levels.size >= 3);

    // 데이터 없음: 역 109, 그 노선에 없는 방향(1호선 INNER, 2호선 UP)은 오류가 아닌 회색이에요.
    for (const query of [
        { stationId: 109, lineId: 1, direction: 'UP', time: '14:00', dayType: 'WEEKDAY' },
        { stationId: 150, lineId: 1, direction: 'INNER', time: '14:00', dayType: 'WEEKDAY' },
        { stationId: 222, lineId: 2, direction: 'UP', time: '14:00', dayType: 'WEEKDAY' },
    ]) {
        const empty = await mockCongestion(runtime, service, query);
        assert.deepEqual(plain(toCongestion(empty)), { supported: false, kind: null, pct: null, level: null, levelLabel: null });
        assert.equal(empty.direction, query.direction);
    }
    // 1호선 UP·DOWN 은 정상이에요.
    for (const direction of ['UP', 'DOWN']) {
        const item = await mockCongestion(runtime, service, { stationId: 150, lineId: 1, direction, time: '14:00', dayType: 'WEEKDAY' });
        assert.equal(item.supported, true);
        assert.equal(item.direction, direction);
    }

    await assert.rejects(mockCongestion(runtime, service, { ...base, time: '14:00', dayType: 'WEEKDAY' }, 'error'), error => error instanceof ApiError && error.code === 'INTERNAL_ERROR' && error.status === 500);
    await assert.rejects(mockCongestion(runtime, service, { ...base, time: '14:00', dayType: 'WEEKDAY' }, 'network'), error => error instanceof ApiError && error.code === 'NETWORK_ERROR');
    assert.equal(runtime.timers.size, 0);
});
function authRuntime(mock = false) {
    const r = createRuntime({ ...serverEnv, EXPO_PUBLIC_USE_MOCK: String(mock) });
    r.native.Platform.OS = 'android';
    const disk = new Map();
    const faults = { read: false, write: false, remove: false };
    r.external['expo-secure-store'] = {
        getItemAsync: async key => { if (faults.read) throw Error(); return disk.get(key) ?? null; },
        setItemAsync: async (key, value) => { if (faults.write) throw Error(); disk.set(key, value); },
        deleteItemAsync: async key => { if (faults.remove) throw Error(); disk.delete(key); },
    };
    r.external['@react-native-seoul/kakao-login'] = { login: async () => ({ accessToken: 'token-1' }) };
    let redirects = 0;
    r.external['expo-router'].router.replace = () => redirects++;
    const auth = r.load('src/services/auth.ts');
    const api = r.load('src/services/api/client.ts');
    const storage = r.load('src/services/token-storage.ts');
    const store = r.load('src/stores/auth-store.ts');
    const calls = [];
    let responder = async url => url.endsWith('/auth/kakao') ? ok(loginData()) : ok(null);
    r.context.fetch = async (url, options) => { calls.push({ url, options }); return responder(url, options); };
    return { ...r, auth, api, storage, store, disk, faults, calls, redirects: () => redirects, respond: fn => { responder = fn; } };
}
const tokenData = () => ({ accessToken: 'token-2', refreshToken: 'token-3', accessTokenExpiresIn: 1800 });
const loginData = () => ({ ...tokenData(), user: { id: 'user-1', nickname: '사용자' }, isNewUser: false });
const ok = data => jsonResponse({ success: true, data });
const fail = (code, status = 401) => jsonResponse({ success: false, error: { code } }, status);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

const userData = () => ({ id: 'user-1', nickname: '새닉네임', createdAt: '2026-11-11T00:00:00Z' });

/** #130: 마이 화면은 기기 권한을 조회하므로 포커스 효과와 권한 조회를 지정해요. */
function myPermissionSetup(runtime) {
    runtime.permissions = { camera: { status: 'granted', granted: true }, location: { status: 'granted', granted: true } };
    // 실제 React처럼 안정적인 콜백을 써서 포커스 효과가 렌더마다 다시 돌지 않게 해요.
    runtime.external.react.useCallback = (callback, dependencies) => {
        const ref = runtime.external.react.useRef(null);
        if (!ref.current || dependencies.some((value, index) => value !== ref.current.dependencies[index])) ref.current = { callback, dependencies };
        return ref.current.callback;
    };
    runtime.external['expo-router'].useFocusEffect = callback => runtime.external.react.useEffect(callback, [callback]);
    runtime.external['expo-image-picker'] = { ...runtime.external['expo-image-picker'], getCameraPermissionsAsync: async () => runtime.permissions.camera };
    runtime.external['expo-location'] = { ...runtime.external['expo-location'], getForegroundPermissionsAsync: async () => runtime.permissions.location };
}
async function myScreenRuntime() {
    const r = createScreenRuntime(serverEnv, 'src/app/my.tsx', myPermissionSetup);
    r.load('src/stores/auth-store.ts').signIn({ userId: 'user-1', nickname: '이전이름' });
    r.context.fetch = async () => ok(userData());
    r.render(); await flush();
    return r;
}

test('서버 마이 화면은 조회한 닉네임을 표시하고 수정·탈퇴 시트를 열어요', async () => {
    const r = await myScreenRuntime(); let view = r.render();
    assert.ok(findElement(view, element => element.props?.children === '새닉네임'));
    const pressText = text => {
        findElement(view, element => element.type === 'Pressable' && findElement(element.props.children, child => child.props?.children === text)).props.onPress();
        view = r.render();
    };
    pressText('닉네임 수정');
    assert.ok(findElement(view, element => element.props?.current === '새닉네임'));
    pressText('회원 탈퇴');
    const sheet = findElement(view, element => element.props?.title === '회원 탈퇴');
    assert.ok(sheet);
    assert.equal(sheet.props.successText, undefined);
    assert.equal(sheet.props.onDone, undefined);
    assert.ok(sheet.props.details.some(text => text.includes('모든 약속방에서 나가요')));
    r.unmount();
});

test('닉네임 시트는 서버 검증·락 경합의 안내와 입력을 유지하고 401을 중복 안내하지 않아요', async () => {
    for (const [code, status] of [['VALIDATION_ERROR', 400], ['ROOM_BUSY', 409], ['TOKEN_INVALID', 401]]) {
        const r = await myScreenRuntime(); let view = r.render();
        findElement(view, element => element.type === 'Pressable' && findElement(element.props.children, child => child.props?.children === '닉네임 수정')).props.onPress();
        const sheet = findElement(r.render(), element => element.props?.current === '새닉네임');
        let form = r.renderComponent(sheet);
        findElement(form, element => element.type === 'TextInput').props.onChangeText('  유지할이름  ');
        form = r.renderComponent(sheet);
        r.context.fetch = async () => fail(code, status);
        await findElement(form, element => element.type === 'TextInput').props.onSubmitEditing();
        form = r.renderComponent(sheet);
        assert.equal(findElement(form, element => element.type === 'TextInput').props.value, '  유지할이름  ');
        const messages = r.load('src/services/api/errors.ts').API_ERROR_MESSAGES;
        assert.equal(!!findElement(form, element => element.props?.children === messages[code]), status !== 401);
        r.unmount();
    }
});

test('탈퇴 시트는 ROOM_BUSY 재시도를 안내하고 인증 오류에는 안내·이동을 추가하지 않아요', async () => {
    for (const [code, status] of [['ROOM_BUSY', 409], ['TOKEN_INVALID', 401]]) {
        const r = await myScreenRuntime(); const view = r.render();
        findElement(view, element => element.type === 'Pressable' && findElement(element.props.children, child => child.props?.children === '회원 탈퇴')).props.onPress();
        const sheet = findElement(r.render(), element => element.props?.title === '회원 탈퇴');
        r.context.fetch = async () => fail(code, status);
        let redirects = 0; r.external['expo-router'].router.replace = () => redirects++;
        let form = r.renderComponent(sheet);
        await findElement(form, element => element.type === 'Pressable' && findElement(element.props.children, child => child.props?.children === '탈퇴하기')).props.onPress();
        form = r.renderComponent(sheet);
        const message = r.load('src/services/api/errors.ts').API_ERROR_MESSAGES[code];
        assert.equal(!!findElement(form, element => element.props?.children === message), status !== 401);
        assert.equal(redirects, status === 401 ? 1 : 0);
        r.unmount();
    }
});

function selectedRoute(runtime) {
    const routes = runtime.load('src/stores/route-store.ts');
    routes.setSelectedRoute({ route: { routeId: 'route-1' } });
    return routes;
}

test('내 정보 GET은 인증을 보내고 응답으로 복원된 세션을 갱신해요', async () => {
    const r = authRuntime(); r.disk.set('linkro.refresh', 'token-1');
    r.respond(async () => ok(tokenData())); await r.auth.refreshSession();
    assert.equal(r.store.getSession().nickname, null);
    r.respond(async () => ok(userData()));
    const user = await r.load('src/services/user.ts').fetchMe(true);
    assert.deepEqual(plain(user), userData());
    assert.deepEqual(plain(r.store.getSession()), { userId: 'user-1', nickname: '새닉네임' });
    assert.equal(r.store.getAuthStatus(), 'signedIn');
    assert.equal(r.calls.at(-1).url, 'https://example.test/api/v1/users/me');
    assert.equal(r.calls.at(-1).options.method, 'GET');
    assert.equal(r.calls.at(-1).options.headers.Authorization, 'Bearer token-2');
    assert.equal(r.redirects(), 0);
});

test('내 정보 GET의 필수 문자열 누락·잘못된 타입은 세션을 바꾸지 않고 UNKNOWN_ERROR예요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao();
    const service = r.load('src/services/user.ts');
    const before = plain(r.store.getSession());
    const broken = [null, [], {}, ...['id', 'nickname', 'createdAt'].flatMap(key => {
        const missing = userData(); delete missing[key];
        return [missing, { ...userData(), [key]: null }, { ...userData(), [key]: 1 }];
    })];
    for (const data of broken) {
        r.respond(async () => ok(data));
        await assert.rejects(service.fetchMe(), { code: 'UNKNOWN_ERROR' });
        assert.deepEqual(plain(r.store.getSession()), before);
    }
});

test('닉네임 PATCH는 공백을 빼고 보내며 가입 시각 없는 응답으로 세션을 갱신해요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao();
    const profile = { id: 'user-1', nickname: '서버닉네임' };
    r.respond(async () => ok(profile));
    const user = await r.load('src/services/user.ts').updateNickname('  요청닉네임 \t', true);
    assert.deepEqual(plain(user), profile);
    assert.deepEqual(plain(r.store.getSession()), { userId: profile.id, nickname: profile.nickname });
    const call = r.calls.at(-1);
    assert.equal(call.url, 'https://example.test/api/v1/users/me');
    assert.equal(call.options.method, 'PATCH');
    assert.deepEqual(JSON.parse(call.options.body), { nickname: '요청닉네임' });
    assert.equal(call.options.headers.Authorization, 'Bearer token-2');
    for (const data of [null, [], {}, { id: 1, nickname: '이름' }, { id: 'user-1' }, { id: 'user-1', nickname: null }]) {
        r.respond(async () => ok(data));
        await assert.rejects(r.load('src/services/user.ts').updateNickname('이름'), { code: 'UNKNOWN_ERROR' });
        assert.equal(r.store.getSession().nickname, profile.nickname);
    }
});

test('닉네임은 이모지 포함 코드 포인트 1·2·20·21자 경계를 요청 전에 검사해요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao();
    const service = r.load('src/services/user.ts');
    for (const character of ['가', '😀']) {
        for (const length of [1, 2, 20, 21]) {
            const nickname = `  ${character.repeat(length)}  `;
            assert.equal(service.nicknameLength(nickname), length);
            const valid = length === 2 || length === 20;
            assert.equal(service.validateNickname(nickname) === null, valid);
            const count = r.calls.length;
            r.respond(async () => ok({ id: 'user-1', nickname: nickname.trim() }));
            if (valid) await service.updateNickname(nickname);
            else await assert.rejects(service.updateNickname(nickname), { code: 'VALIDATION_ERROR' });
            assert.equal(r.calls.length - count, valid ? 1 : 0);
        }
    }
    for (const value of ['', '  ']) await assert.rejects(service.updateNickname(value), { code: 'VALIDATION_ERROR' });
});

test('사용자 API는 VALIDATION_ERROR·ROOM_BUSY·TOKEN_INVALID 코드를 그대로 전달해요', async () => {
    for (const [method, invoke] of [
        ['GET', service => service.fetchMe()],
        ['PATCH', service => service.updateNickname('새이름')],
        ['DELETE', service => service.withdraw()],
    ]) {
        for (const [code, status] of [['VALIDATION_ERROR', 400], ['ROOM_BUSY', 409], ['TOKEN_INVALID', 401]]) {
            const r = authRuntime(); await r.auth.loginWithKakao();
            r.respond(async () => fail(code, status));
            await assert.rejects(invoke(r.load('src/services/user.ts')), error => error.code === code && error.status === status);
            assert.equal(r.calls.at(-1).options.method, method);
            assert.equal(r.store.getAuthStatus(), status === 401 ? 'signedOut' : 'signedIn');
            assert.equal(r.redirects(), status === 401 ? 1 : 0);
        }
    }
});

test('탈퇴 성공은 로컬 인증·선택 경로만 지우고 로그인으로 한 번 이동해요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao();
    const routes = selectedRoute(r);
    r.respond(async () => ok(null));
    await r.load('src/services/user.ts').withdraw(true);
    assert.equal(r.calls.at(-1).options.method, 'DELETE');
    assert.equal(r.calls.at(-1).url, 'https://example.test/api/v1/users/me');
    assert.equal(r.calls.at(-1).options.body, undefined);
    assert.equal(r.storage.getAccessToken(), null);
    assert.equal(await r.storage.readRefreshToken(), null);
    assert.equal(r.disk.size, 0);
    assert.equal(r.store.getAuthStatus(), 'signedOut');
    assert.equal(r.store.getSession(), null);
    assert.equal(routes.getSelectedRoute(), null);
    assert.equal(r.redirects(), 1);
    assert.equal(r.calls.filter(call => call.url.endsWith('/auth/logout')).length, 0);
});

test('사용자 조회의 만료 응답은 기존 클라이언트가 한 번 갱신한 뒤 세션을 갱신해요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); let refreshes = 0;
    r.respond(async (url, options) => {
        if (url.endsWith('/auth/refresh')) { refreshes++; return ok({ ...tokenData(), accessToken: 'token-4' }); }
        return options.headers.Authorization === 'Bearer token-4' ? ok(userData()) : fail('TOKEN_EXPIRED');
    });
    await r.load('src/services/user.ts').fetchMe();
    assert.equal(refreshes, 1);
    assert.equal(r.store.getSession().nickname, '새닉네임');
    assert.equal(r.redirects(), 0);
});

test('탈퇴 후 기기 저장값 삭제 실패도 로그인과 경로를 해제하고 기존 경고로 알려요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); const routes = selectedRoute(r);
    r.faults.remove = true; r.respond(async () => ok(null));
    await r.load('src/services/user.ts').withdraw();
    assert.equal(r.store.getAuthStatus(), 'signedOut');
    assert.equal(routes.getSelectedRoute(), null);
    assert.equal(r.storage.getAccessToken(), null);
    assert.equal(await r.storage.readRefreshToken(), null);
    assert.equal(r.storage.hasTokenDeletionFailed(), true);
    assert.equal(r.redirects(), 1);
});

test('탈퇴 ROOM_BUSY·네트워크·시간 초과는 인증과 선택 경로를 유지해요', async () => {
    for (const failure of ['busy', 'network', 'timeout']) {
        const r = authRuntime(); await r.auth.loginWithKakao();
        const routes = selectedRoute(r);
        const before = plain(r.store.getSession());
        r.respond(async (_url, options) => {
            if (failure === 'busy') return fail('ROOM_BUSY', 409);
            if (failure === 'network') throw Error();
            return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error())));
        });
        const pending = r.load('src/services/user.ts').withdraw();
        const rejected = assert.rejects(pending, { code: failure === 'busy' ? 'ROOM_BUSY' : 'NETWORK_ERROR' });
        if (failure === 'timeout') { await flush(); r.advance(10000); }
        await rejected;
        assert.deepEqual(plain(r.store.getSession()), before);
        assert.equal(r.store.getAuthStatus(), 'signedIn');
        assert.notEqual(r.storage.getAccessToken(), null);
        assert.equal(r.disk.size, 1);
        assert.notEqual(routes.getSelectedRoute(), null);
        assert.equal(r.redirects(), 0);
    }
});

test('탈퇴 응답 유실 뒤 재시도 401은 공통 처리로 한 번만 정리해요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); const routes = selectedRoute(r);
    const service = r.load('src/services/user.ts');
    r.respond(async () => { throw Error(); });
    await assert.rejects(service.withdraw(), { code: 'NETWORK_ERROR' });
    assert.equal(r.redirects(), 0);
    r.respond(async () => fail('TOKEN_INVALID'));
    await assert.rejects(service.withdraw(), { code: 'TOKEN_INVALID' });
    assert.equal(r.store.getAuthStatus(), 'signedOut');
    assert.equal(routes.getSelectedRoute(), null);
    assert.equal(r.disk.size, 0);
    assert.equal(r.redirects(), 1);
    assert.equal(r.calls.filter(call => call.url.endsWith('/auth/logout') || call.url.endsWith('/auth/refresh')).length, 0);
});

test('탈퇴 중이던 갱신 응답이 늦게 와도 인증을 되살리지 않아요', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); const late = deferred();
    r.respond(async url => url.endsWith('/auth/refresh') ? late.promise : ok(null));
    const refresh = r.auth.refreshSession();
    const rejected = assert.rejects(refresh, { code: 'AUTH_REQUIRED' });
    await flush();
    await r.load('src/services/user.ts').withdraw();
    late.resolve(ok(tokenData())); await rejected;
    assert.equal(r.store.getAuthStatus(), 'signedOut');
    assert.equal(r.storage.getAccessToken(), null);
    assert.equal(r.disk.size, 0);
    assert.equal(r.redirects(), 1);
});

test('이전 사용자의 늦은 조회·수정·탈퇴 응답은 새 로그인을 바꾸지 않아요', async () => {
    for (const invoke of [service => service.fetchMe(), service => service.updateNickname('이전이름'), service => service.withdraw()]) {
        const r = authRuntime(); await r.auth.loginWithKakao(); const late = deferred();
        r.respond(async () => late.promise);
        const pending = invoke(r.load('src/services/user.ts'));
        const rejected = assert.rejects(pending, { code: 'AUTH_REQUIRED' }); await flush();
        r.respond(async () => ok(loginData())); await r.auth.loginWithKakao();
        late.resolve(ok(userData())); await rejected;
        assert.equal(r.store.getAuthStatus(), 'signedIn');
        assert.equal(r.store.getSession().nickname, '사용자');
        assert.equal(r.storage.getAccessToken(), 'token-2');
        assert.equal(r.redirects(), 0);
    }
});

test('mock 내 정보·수정·로그아웃·탈퇴와 실패 플래그는 서버를 호출하지 않아요', async () => {
    const r = authRuntime(true); const service = r.load('src/services/user.ts');
    const run = async pending => { r.advance(700); await flush(); return pending; };
    for (const invoke of [() => service.fetchMe(true), () => service.updateNickname('새이름', true), () => service.logout(true), () => service.withdraw(true)]) {
        service.mockKakaoLogin();
        const pending = invoke();
        const rejected = assert.rejects(pending, { code: 'NETWORK_ERROR' });
        r.advance(700); await rejected;
        assert.equal(r.store.getAuthStatus(), 'signedIn');
    }
    const original = await run(service.fetchMe());
    const saved = await run(service.updateNickname('  모크이름  '));
    assert.equal(saved.nickname, '모크이름');
    assert.equal((await run(service.fetchMe())).nickname, '모크이름');
    await run(service.updateNickname(original.nickname));
    for (const invoke of [() => service.logout(), () => service.withdraw()]) {
        service.mockKakaoLogin(); const routes = selectedRoute(r);
        await run(invoke());
        assert.equal(r.store.getAuthStatus(), 'signedOut');
        assert.equal(routes.getSelectedRoute(), null);
    }
    assert.equal(r.calls.length, 0);
});

test('카카오 본문·비인증 헤더·저장 후 Bearer 주입', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); await r.api.get('/stations');
    assert.deepEqual(JSON.parse(r.calls[0].options.body), { kakaoAccessToken: 'token-1' });
    assert.equal(r.calls[0].options.headers.Authorization, undefined);
    assert.equal(r.calls[1].options.headers.Authorization, 'Bearer token-2');
    assert.equal([...r.disk.values()][0], 'token-3');
    assert.equal(r.store.getAuthStatus(), 'signedIn');
});

test('로그인 응답 필수 필드 검사와 서버 오류 코드 보존', async () => {
    for (const key of ['accessToken', 'refreshToken', 'accessTokenExpiresIn', 'user', 'isNewUser']) {
        const r = authRuntime(); const data = loginData(); delete data[key]; r.respond(async () => ok(data));
        await assert.rejects(r.auth.loginWithKakao(), { code: 'UNKNOWN_ERROR' });
        assert.notEqual(r.store.getAuthStatus(), 'signedIn');
    }
    for (const code of ['KAKAO_AUTH_FAILED', 'EXTERNAL_API_ERROR']) {
        const r = authRuntime(); r.respond(async () => fail(code, code === 'EXTERNAL_API_ERROR' ? 502 : 401));
        await assert.rejects(r.auth.loginWithKakao(), { code });
    }
});

test('만료 후 한 번 갱신·새 헤더로 재시도·Refresh 회전·모든 진입점 Promise 공유', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); let count = 0;
    r.respond(async (url, options) => {
        if (url.endsWith('/auth/refresh')) { count++; assert.equal(options.headers.Authorization, undefined); assert.deepEqual(JSON.parse(options.body), { refreshToken: 'token-3' }); return ok({ ...tokenData(), accessToken: 'token-4', refreshToken: 'token-5' }); }
        return options.headers.Authorization === 'Bearer token-4' ? ok('성공') : fail('TOKEN_EXPIRED');
    });
    assert.deepEqual(await Promise.all([r.api.get('/one'), r.api.get('/two'), r.api.get('/three')]), ['성공', '성공', '성공']);
    assert.equal(count, 1); assert.equal([...r.disk.values()][0], 'token-5');
    r.respond(async () => { count++; return ok(tokenData()); });
    const first = r.auth.refreshSession(); assert.equal(first, r.auth.refreshSession());
    await first; assert.equal(count, 2); // 요청의 회전값 검사가 이전 값 재사용도 잡아요.
});

test('재시도 요청이 다시 401이면 추가 갱신 없이 실패 처리', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); let count = 0;
    r.respond(async url => url.endsWith('/auth/refresh') ? (count++, ok({ ...tokenData(), accessToken: 'token-4' })) : fail('TOKEN_EXPIRED'));
    await assert.rejects(r.api.get('/stations'), { code: 'TOKEN_EXPIRED' });
    assert.equal(count, 1); assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.redirects(), 1);
});

test('늦은 이전 토큰의 401은 갱신 없이 현재 토큰으로 한 번 재시도', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); const late = deferred(); let count = 0;
    r.respond(async (url, options) => {
        if (url.endsWith('/auth/refresh')) { count++; return ok({ ...tokenData(), accessToken: 'token-4' }); }
        if (options.headers.Authorization === 'Bearer token-4') return ok('성공');
        return url.endsWith('/late') ? late.promise : fail('TOKEN_EXPIRED');
    });
    const old = r.api.get('/late'); await flush(); await r.api.get('/now');
    late.resolve(fail('TOKEN_EXPIRED')); assert.equal(await old, '성공'); assert.equal(count, 1);
});

test('갱신 401은 토큰 삭제·로그인 이동, 네트워크·409·5xx는 보존', async () => {
    for (const [code, status] of [['TOKEN_INVALID', 401], ['AUTH_REQUIRED', 401], ['ROOM_BUSY', 409], ['EXTERNAL_API_ERROR', 502], ['NETWORK_ERROR', 0]]) {
        const r = authRuntime(); await r.auth.loginWithKakao();
        r.respond(async url => {
            if (!url.endsWith('/auth/refresh')) return fail('TOKEN_EXPIRED');
            if (!status) throw Error(); return fail(code, status);
        });
        await assert.rejects(r.api.get('/stations'), { code });
        if (status === 401) { assert.equal(r.disk.size, 0); assert.equal(r.storage.getAccessToken(), null); assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.redirects(), 1); }
        else { assert.equal(r.disk.size, 1); assert.equal(r.storage.getAccessToken(), 'token-2'); }
        if (!status) { const count = r.calls.length; await assert.rejects(r.auth.refreshSession(), { code: 'REFRESH_UNCERTAIN' }); assert.equal(r.calls.length, count); }
    }
});

test('auth:false 재귀 방지와 TOKEN_INVALID·AUTH_REQUIRED 즉시 실패 이동', async () => {
    for (const code of ['TOKEN_INVALID', 'AUTH_REQUIRED', 'TOKEN_EXPIRED']) {
        const r = authRuntime(); await r.auth.loginWithKakao(); r.respond(async () => fail(code));
        await assert.rejects(r.api.post('/auth/refresh', {}, { auth: false }), { code }); assert.equal(r.redirects(), 0);
        if (code !== 'TOKEN_EXPIRED') { const count = r.calls.length; await assert.rejects(r.api.get('/stations'), { code }); assert.equal(r.calls.length, count + 1); assert.equal(r.redirects(), 1); }
    }
});

test('로그아웃 서버 실패도 삭제·signedOut, 갱신 중 로그아웃의 늦은 응답 무시', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); const late = deferred();
    r.respond(async url => { if (url.endsWith('/auth/refresh')) return late.promise; throw Error(); });
    const refresh = r.auth.refreshSession(); const rejection = assert.rejects(refresh, { code: 'AUTH_REQUIRED' }); await flush();
    await r.auth.logoutSession(); late.resolve(ok({ ...tokenData(), accessToken: 'token-4' })); await rejection;
    assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.storage.getAccessToken(), null); assert.equal(r.disk.size, 0);
    const logout = r.calls.find(call => call.url.endsWith('/auth/logout')); assert.ok(logout); assert.equal(logout.options.headers.Authorization, undefined);
});

test('이전 세션의 늦은 401·로그인 성공이 새 세션을 변경하지 않음', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); const late = deferred();
    r.respond(async () => late.promise); const old = r.api.get('/stations'); const rejected = assert.rejects(old, { code: 'TOKEN_INVALID' }); await flush();
    r.respond(async () => ok(loginData())); await r.auth.loginWithKakao(); late.resolve(fail('TOKEN_INVALID')); await rejected;
    assert.equal(r.store.getAuthStatus(), 'signedIn'); assert.equal(r.storage.getAccessToken(), 'token-2'); assert.equal(r.redirects(), 0);
    const loginLate = deferred(); r.respond(async () => loginLate.promise); const login = r.auth.loginWithKakao(); const loginRejected = assert.rejects(login, { code: 'AUTH_REQUIRED' }); await flush();
    r.respond(async () => ok(loginData())); await r.auth.loginWithKakao(); loginLate.resolve(ok({ ...loginData(), accessToken: 'token-4' })); await loginRejected;
    assert.equal(r.storage.getAccessToken(), 'token-2');
});

test('SecureStore 저장·읽기·삭제 실패와 복원 사용자 미확인', async () => {
    const r = authRuntime(); r.faults.write = true;
    await assert.rejects(r.auth.loginWithKakao(), { code: 'TOKEN_STORAGE_ERROR' }); assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.storage.getAccessToken(), null);
    r.faults.write = false; await r.auth.loginWithKakao(); r.faults.remove = true;
    await r.auth.logoutSession(); assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.storage.getAccessToken(), null); assert.equal(r.storage.hasTokenDeletionFailed(), true); assert.equal(r.disk.size, 1); assert.equal(await r.storage.readRefreshToken(), null);
    const restored = authRuntime(); restored.disk.set('linkro.refresh', 'token-1'); restored.respond(async () => ok(tokenData()));
    await restored.auth.refreshSession(); assert.deepEqual(plain(restored.store.getSession()), { userId: null, nickname: null });
    const unreadable = authRuntime(); unreadable.faults.read = true; await assert.rejects(unreadable.auth.refreshSession(), { code: 'AUTH_REQUIRED' }); assert.equal(unreadable.calls.length, 0);
});

test('mock 로그인·갱신·로그아웃은 서버를 호출하지 않아요', async () => {
    const r = authRuntime(true); await r.auth.loginWithKakao(); await r.auth.refreshSession(); await r.auth.logoutSession(); assert.equal(r.calls.length, 0);
});

test('카카오 취소와 웹 미지원, 웹 저장소는 네이티브 모듈 접근 없음', async () => {
    const r = authRuntime(); const kakao = r.load('src/services/kakao.ts');
    r.external['@react-native-seoul/kakao-login'].login = async () => { throw { code: 'RNKakaoLogins', message: 'ClientFailed(Cancelled)' }; };
    await assert.rejects(kakao.getKakaoAccessToken(), error => kakao.isKakaoLoginCancelled(error));
    r.native.Platform.OS = 'web'; delete r.external['@react-native-seoul/kakao-login']; delete r.external['expo-secure-store'];
    await assert.rejects(kakao.getKakaoAccessToken(), { code: 'KAKAO_UNSUPPORTED' });
    await r.storage.saveTokens('token-1', 'token-2', () => true); assert.equal(await r.storage.readRefreshToken(), 'token-2'); await r.storage.clearTokens(); assert.equal(await r.storage.readRefreshToken(), null);
});
test('사용자 서비스 로그아웃도 서버 모드 인증 서비스를 호출', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao();
    r.respond(async () => { throw Error(); });
    await r.load('src/services/user.ts').logout(true);
    assert.equal(r.store.getAuthStatus(), 'signedOut'); assert.equal(r.storage.getAccessToken(), null); assert.equal(r.disk.size, 0);
    assert.equal(r.calls.filter(call => call.url.endsWith('/auth/logout')).length, 1);
});

test('복원 진입점과 만료 요청이 겹쳐도 갱신은 한 번', async () => {
    const r = authRuntime(); await r.auth.loginWithKakao(); const late = deferred(); let count = 0;
    r.respond(async (url, options) => {
        if (url.endsWith('/auth/refresh')) { count++; return late.promise; }
        return options.headers.Authorization === 'Bearer token-4' ? ok(null) : fail('TOKEN_EXPIRED');
    });
    const restore = r.auth.refreshSession(); const request = r.api.get('/stations'); await flush();
    assert.equal(count, 1); late.resolve(ok({ ...tokenData(), accessToken: 'token-4' }));
    await Promise.all([restore, request]); assert.equal(count, 1);
});
test('서버 모드는 복원 중 보호 화면을 가리고 signedOut은 로그인으로 이동, unknown은 mock 전용', () => {
    for (const mock of [false, true]) {
        const r = createRuntime({ ...serverEnv, EXPO_PUBLIC_USE_MOCK: String(mock) }, {
            useEffect() {}, useState: () => ['', () => {}], useSyncExternalStore: (_, get) => get(),
        });
        r.external['expo-router'].usePathname = () => '/home';
        r.external['expo-router'].Redirect = 'Redirect';
        const gate = r.load('src/components/auth-gate.tsx').default;
        const store = r.load('src/stores/auth-store.ts');
        if (mock) { assert.equal(store.getAuthStatus(), 'unknown'); assert.equal(gate({ children: '보호 화면' }), '보호 화면'); }
        else {
            assert.equal(store.getAuthStatus(), 'restoring');
            assert.equal(findElement(gate({ children: '보호 화면' }), element => element.type === 'ActivityIndicator').props.accessibilityLabel, '로그인을 복원하고 있어요');
            store.signOut(); const view = gate({ children: '보호 화면' }); assert.equal(view.type, 'Redirect'); assert.equal(view.props.href, '/login');
        }
    }
});

const routeOrigin = { id: 88001, name: '서버 출발', lines: [2], isSupported: true };
const routeDestination = { id: 99002, name: '서버 도착', lines: [2], isSupported: true };
const missingRouteCongestion = () => ({ supported: false, kind: null, pct: null, level: null, levelLabel: null });

function routeData() {
    const congestion = { supported: true, kind: 'ESTIMATED', pct: 87.3, level: 'NORMAL', levelLabel: '서버 라벨' };
    return {
        routeSource: 'KAKAO',
        routes: [{
            routeId: 'server-route-1', routeType: null,
            summary: {
                totalTimeSec: 913, arrivalAt: '2026-11-11T23:41:17+09:00', fare: 1789,
                fareSource: 'ESTIMATED', transferCount: 1, walkingMinutes: 3, congestion,
            },
            steps: [{
                type: 'WALKING', guidance: '서버 도보 안내', durationSec: 83, distanceM: 57,
                line: null, direction: null, directionCode: null, stops: [], path: null, stations: [],
            }, {
                type: 'SUBWAY', guidance: '서버 승차 안내', durationSec: 830, distanceM: 6789,
                line: { id: 2, name: '2호선', color: '#00a84d' }, direction: null, directionCode: 'INNER',
                stops: [{ id: 88001, name: '서버 출발', order: 0 }, { id: 99002, name: '서버 도착', order: 1 }],
                path: [[127.01, 37.5], [127.02, 37.51]],
                stations: [
                    { id: 88001, name: '서버 출발', slotStart: '23:30', slotDate: null, firstTrain: false, congestion },
                    { id: 99002, name: '서버 도착', slotStart: '00:00', slotDate: '2026-11-11', firstTrain: false, congestion: null },
                ],
            }],
        }],
    };
}

test('경로 서버 요청 URL·본문·roomId 선택 포함과 departAt 생략, 서버 ID 사용', async () => {
    const r = createRuntime(serverEnv);
    const calls = [];
    r.context.fetch = async (url, options) => { calls.push({ url, options }); return jsonResponse({ success: true, data: routeData() }); };
    const service = r.load('src/services/route.ts');
    for (const options of [undefined, {}, { roomId: undefined }, { roomId: 'server-room-7' }]) {
        // 지원 여부 판단은 서버가 하며 서버 모드에서 mock 역 목록을 검사하지 않아요.
        await service.searchRoute({ ...routeOrigin, isSupported: false }, routeDestination, options);
        const call = calls.at(-1);
        assert.equal(call.url, 'https://example.test/api/v1/routes/search');
        assert.equal(call.options.method, 'POST');
        assert.deepEqual(JSON.parse(call.options.body), {
            originStationId: 88001, destinationStationId: 99002,
            ...(options?.roomId === undefined ? {} : { roomId: 'server-room-7' }),
        });
        assert.equal(Object.hasOwn(JSON.parse(call.options.body), 'departAt'), false);
    }
    assert.equal(calls.length, 4);
    assert.equal(r.timers.size, 0);
});

test('경로 정상 응답의 서버 값·null·대기 필드 생략을 보존하고 혼잡도만 정리', async () => {
    for (const routeSource of ['KAKAO', 'INTERNAL']) {
        const r = createRuntime(serverEnv);
        const data = routeData(); data.routeSource = routeSource;
        r.context.fetch = async () => jsonResponse({ success: true, data });
        const result = plain(await r.load('src/services/route.ts').searchRoute(routeOrigin, routeDestination));
        const expected = plain(data);
        Object.assign(expected, { appointmentPassed: false, notice: null });
        Object.assign(expected.routes[0].summary, { noService: false, serviceNotice: null, arrivesAfterAppointment: false });
        expected.routes[0].steps[1].stations[1].congestion = missingRouteCongestion();
        assert.deepEqual(result, expected);
        assert.equal(result.routes[0].summary.arrivalAt, '2026-11-11T23:41:17+09:00');
        for (const field of ['waitSec', 'waitKind', 'transferWaitSec', 'totalWithWaitSec']) {
            assert.equal(Object.hasOwn(result.routes[0].summary, field), false);
        }
        assert.equal(result.routes[0].steps[1].direction, null);
        assert.equal(result.routes[0].steps[1].directionCode, 'INNER');
    }
});

test('120/121 new route fields preserve server times and slots, and default older responses', () => {
    const r = createRuntime(serverEnv);
    const parse = r.load('src/services/route.ts').__parseRouteSearch;
    const old = plain(parse(routeData()));
    assert.equal(old.appointmentPassed, false); assert.equal(old.notice, null);
    assert.equal(old.routes[0].summary.noService, false);
    assert.equal(old.routes[0].summary.serviceNotice, null);
    assert.equal(old.routes[0].summary.arrivesAfterAppointment, false);
    assert.equal(old.routes[0].summary.departureAt, undefined);
    const data = routeData();
    Object.assign(data, { appointmentPassed: true, notice: '약속 시각이 이미 지나 지금 출발 기준으로 안내합니다.' });
    Object.assign(data.routes[0].summary, { departureAt: '2026-11-12T05:36:00+09:00', arrivalAt: '2026-11-12T05:51:13+09:00',
        noService: true, serviceNotice: '요청한 시각에는 이 경로를 운행하는 열차가 없어 첫차(11월 12일 05:36 출발) 기준으로 안내합니다.', arrivesAfterAppointment: true });
    Object.assign(data.routes[0].steps[1].stations[0], { slotStart: '05:30', slotDate: '2026-11-12', firstTrain: true });
    const result = plain(parse(data));
    assert.equal(result.appointmentPassed, true); assert.equal(result.notice, data.notice);
    assert.deepEqual(result.routes[0].summary, data.routes[0].summary);
    assert.deepEqual(result.routes[0].steps[1].stations[0], data.routes[0].steps[1].stations[0]);
    assert.equal(r.load('src/components/route/format.ts').formatClock(data.routes[0].summary.departureAt), '05:36');
});

test('120/121 malformed new fields fail parsing with UNKNOWN_ERROR', () => {
    const r = createRuntime(serverEnv); const parse = r.load('src/services/route.ts').__parseRouteSearch;
    for (const [field, invalid] of [['appointmentPassed', ['true', 1, null]], ['notice', [false, 1, {}]],
        ['noService', ['false', 0, null]], ['serviceNotice', [true, 12, []]],
        ['arrivesAfterAppointment', ['true', 1, null]], ['departureAt', [null, 123, 'invalid']]]) {
        for (const value of invalid) {
            const data = routeData();
            (['appointmentPassed', 'notice'].includes(field) ? data : data.routes[0].summary)[field] = value;
            assert.throws(() => parse(data), { code: 'UNKNOWN_ERROR' }, field);
        }
    }
});

test('120/121 service notice and late badge render only for active flags in both card states', () => {
    const r = createRuntime(); const notices = r.load('src/components/route/RouteNotices.tsx').default;
    const card = r.load('src/components/route/RouteCard.tsx').default;
    for (const noService of [false, true]) for (const serviceNotice of [null, '첫차 기준 안내']) for (const arrivesAfterAppointment of [false, true]) {
        const route = r.load('src/services/route.ts').__parseRouteSearch(routeData()).routes[0];
        Object.assign(route.summary, { noService, serviceNotice, arrivesAfterAppointment });
        const view = notices({ summary: route.summary });
        assert.equal(!!findElement(view, e => e.props?.children === '첫차 기준 안내'), noService && serviceNotice !== null);
        assert.equal(!!findElement(view, e => e.props?.children === '약속 시각보다 늦게 도착해요'), arrivesAfterAppointment);
        for (const expanded of [false, true]) assert.ok(findElement(card({ route, expanded }), e => e.type === notices));
    }
});

test('120/121 result notice needs appointmentPassed and non-null notice; roomId follows room context', async () => {
    for (const appointmentPassed of [false, true]) for (const notice of [null, '이미 지난 약속 안내']) for (const roomId of [undefined, 'room-120']) {
        const r = routeScreenRuntime({ departure: '강남', destination: '사당', roomId }); const bodies = [];
        r.context.fetch = async (url, options) => {
            if (url.endsWith('/routes/search')) {
                bodies.push(JSON.parse(options.body));
                return jsonResponse({ success: true, data: { ...routeData(), appointmentPassed, notice } });
            }
            return jsonResponse({ success: true, data: stationSearchData([url.includes(encodeURIComponent('강남')) ? serverRouteStation(88001, '강남') : serverRouteStation(99002, '사당')]) });
        };
        r.render(); await settle(); r.render(); await settle(); const view = r.render();
        assert.equal(!!findElement(view, e => e.props?.children === '이미 지난 약속 안내'), appointmentPassed && notice !== null);
        assert.equal(bodies.length, 1);
        assert.deepEqual(bodies[0], { originStationId: 88001, destinationStationId: 99002, ...(roomId ? { roomId } : {}) });
        assert.equal(Object.hasOwn(bodies[0], 'departAt'), false); r.unmount();
    }
});

test('경로 요약 혼잡도 null·미제공과 stations null은 화면용 미제공·빈 배열', async () => {
    const cases = [null, missingRouteCongestion(), { supported: false, kind: 'MOCK', pct: 90, level: 'NORMAL', levelLabel: '이 값은 표시하지 않아요' }];
    for (const congestion of cases) {
        const r = createRuntime(serverEnv);
        const data = routeData();
        data.routes[0].summary.congestion = congestion;
        data.routes[0].steps[1].stations = null;
        r.context.fetch = async () => jsonResponse({ success: true, data });
        const result = await r.load('src/services/route.ts').searchRoute(routeOrigin, routeDestination);
        assert.deepEqual(plain(result.routes[0].summary.congestion), missingRouteCongestion());
        assert.deepEqual(plain(result.routes[0].steps[1].stations), []);
    }
});

test('경로가 내려주는 선택 대기 필드는 검사 후 그대로 보존', async () => {
    const r = createRuntime(serverEnv); const data = routeData();
    Object.assign(data.routes[0].summary, { waitSec: 180, waitKind: 'ESTIMATED', transferWaitSec: 120, totalWithWaitSec: 1213 });
    Object.assign(data.routes[0].steps[1], { waitSec: null, waitKind: 'NONE', nextTrains: [] });
    r.context.fetch = async () => jsonResponse({ success: true, data });
    const result = plain(await r.load('src/services/route.ts').searchRoute(routeOrigin, routeDestination));
    assert.deepEqual(result.routes[0].summary, { ...data.routes[0].summary, noService: false, serviceNotice: null, arrivesAfterAppointment: false });
    assert.equal(result.routes[0].steps[1].waitSec, null);
    assert.deepEqual(result.routes[0].steps[1].nextTrains, []);
});

test('경로 응답의 화면 사용 필드 누락·잘못된 타입은 일반 경로 오류', async () => {
    const mutations = [];
    const missing = (select, fields) => fields.forEach(field => mutations.push(data => { delete select(data)[field]; }));
    missing(data => data, ['routeSource', 'routes']);
    missing(data => data.routes[0], ['routeId', 'routeType', 'summary', 'steps']);
    missing(data => data.routes[0].summary, ['totalTimeSec', 'arrivalAt', 'fare', 'fareSource', 'transferCount', 'walkingMinutes', 'congestion']);
    missing(data => data.routes[0].steps[1], ['type', 'guidance', 'durationSec', 'distanceM', 'line', 'direction', 'directionCode', 'stops', 'path', 'stations']);
    missing(data => data.routes[0].steps[1].stations[0], ['id', 'name', 'slotStart', 'slotDate', 'firstTrain', 'congestion']);
    missing(data => data.routes[0].summary.congestion, ['supported', 'kind', 'pct', 'level', 'levelLabel']);
    mutations.push(
        data => { data.routeSource = 'UNKNOWN'; },
        data => { data.routes = {}; },
        data => { data.routes[0].routeId = 123; },
        data => { data.routes[0].routeType = 'OTHER'; },
        data => { data.routes[0].summary.totalTimeSec = '913'; },
        data => { data.routes[0].summary.arrivalAt = 'invalid'; },
        data => { data.routes[0].summary.fareSource = null; },
        data => { data.routes[0].summary.congestion.kind = null; },
        data => { data.routes[0].summary.congestion.level = 'INVALID'; },
        data => { data.routes[0].summary.congestion.pct = '87.3'; },
        data => { data.routes[0].steps[1].line = null; },
        data => { data.routes[0].steps[1].line.id = '2'; },
        data => { data.routes[0].steps[1].stops[0].order = '0'; },
        data => { data.routes[0].steps[1].directionCode = 'INVALID'; },
        data => { data.routes[0].steps[1].path = [[127, null]]; },
        data => { data.routes[0].steps[1].stations[0].firstTrain = 'false'; },
        data => { data.routes[0].summary.totalWithWaitSec = '1213'; },
        data => { data.routes[0].steps[1].waitKind = 'OTHER'; },
        data => { data.routes[0].steps[1].nextTrains = [null]; },
    );
    const r = createRuntime(serverEnv);
    let current;
    r.context.fetch = async () => jsonResponse({ success: true, data: current });
    const service = r.load('src/services/route.ts');
    for (let i = 0; i < mutations.length; i++) {
        current = routeData(); mutations[i](current);
        await assert.rejects(service.searchRoute(routeOrigin, routeDestination), error => error instanceof r.load('src/types/route.ts').RouteSearchError && error.code === 'EXTERNAL_API_ERROR', `변형 ${i}`);
    }
});

test('경로 오류 매핑 422·404·403·400·5xx와 TOKEN 계열 원본 보존', async () => {
    const r = createRuntime(serverEnv);
    const { searchRoute } = r.load('src/services/route.ts');
    const { ApiError } = r.load('src/services/api/errors.ts');
    for (const [code, status, expected] of [
        ['STATION_UNSUPPORTED', 422, 'STATION_UNSUPPORTED'], ['ROUTE_NOT_FOUND', 404, 'ROUTE_NOT_FOUND'],
        ['STATION_NOT_FOUND', 404, 'STATION_NOT_FOUND'], ['NOT_ROOM_MEMBER', 403, 'EXTERNAL_API_ERROR'],
        ['VALIDATION_ERROR', 400, 'EXTERNAL_API_ERROR'], ['EXTERNAL_API_ERROR', 502, 'EXTERNAL_API_ERROR'],
        ['UNKNOWN_ERROR', 500, 'EXTERNAL_API_ERROR'], ['TOKEN_EXPIRED', 401, 'TOKEN_EXPIRED'],
        ['TOKEN_INVALID', 401, 'TOKEN_INVALID'], ['TOKEN_FUTURE', 401, 'TOKEN_FUTURE'], ['AUTH_REQUIRED', 401, 'AUTH_REQUIRED'],
    ]) {
        let calls = 0;
        r.context.fetch = async () => { calls++; return jsonResponse({ success: false, error: { code, message: '서버 오류', details: { check: true } } }, status); };
        await assert.rejects(searchRoute(routeOrigin, routeDestination), error => error.code === expected
            && (status !== 401 || error instanceof ApiError && error.status === 401 && error.message === '서버 오류' && error.details.check));
        assert.equal(calls, 1);
    }
    r.context.fetch = async () => { throw new TypeError('연결 실패'); };
    await assert.rejects(searchRoute(routeOrigin, routeDestination), { code: 'NETWORK_ERROR' });
});

test('경로 시간 초과는 10초·NETWORK_ERROR, 요청·본문 모두 재시도 없음', async () => {
    for (const phase of ['request', 'body']) {
        const r = createRuntime(serverEnv); let calls = 0;
        r.context.fetch = (_url, options) => {
            calls++;
            const pending = () => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('중단'))));
            return phase === 'request' ? pending() : Promise.resolve({ ok: true, status: 200, text: pending });
        };
        const result = r.load('src/services/route.ts').searchRoute(routeOrigin, routeDestination);
        const rejected = assert.rejects(result, { code: 'NETWORK_ERROR' });
        await settle();
        assert.equal([...r.timers.values()][0].ms, 10000);
        r.advance(9999); await settle(); assert.equal(r.timers.size, 1);
        r.advance(1); await rejected;
        assert.equal(calls, 1); assert.equal(r.timers.size, 0);
    }
});

test('mock 경로의 기존 대기·도착 시각·오류 동작 유지, 서버 호출 없음', async () => {
    const r = createRuntime(); let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    const service = r.load('src/services/route.ts');
    const stations = r.load('src/mocks/routes.ts').MOCK_STATIONS;
    const origin = stations.find(station => station.name === '건대입구');
    const destination = stations.find(station => station.name === '사당');
    assert.ok(origin); assert.ok(destination);
    const pending = service.searchRoute(origin, destination, { roomId: 'mock-room' });
    r.advance(800); const result = await pending;
    assert.ok(result.routes.length);
    assert.equal(result.appointmentPassed, false); assert.equal(result.notice, null);
    for (const route of result.routes) {
        assert.equal(route.summary.noService, false); assert.equal(route.summary.serviceNotice, null);
        assert.equal(route.summary.arrivesAfterAppointment, false); assert.equal(route.summary.departureAt, undefined);
    }
    const first = result.routes.find(route => route.routeId === 'r1');
    assert.ok(first.summary.totalWithWaitSec); assert.ok(Number.isFinite(Date.parse(first.summary.arrivalAt)));
    const unsupported = service.searchRoute({ ...origin, isSupported: false }, destination);
    const rejected = assert.rejects(unsupported, { code: 'STATION_UNSUPPORTED' }); r.advance(800); await rejected;
    const notFound = service.searchRoute({ ...origin, name: '없는 역' }, destination);
    const notFoundRejected = assert.rejects(notFound, { code: 'ROUTE_NOT_FOUND' }); r.advance(800); await notFoundRejected;
    assert.equal(calls, 0);
});

function routeScreenRuntime(params, mock = false) {
    const r = createScreenRuntime(mock ? {} : serverEnv, 'src/app/route-search.tsx');
    r.external['expo-router'].useLocalSearchParams = () => params;
    // 경로 화면의 검색 effect가 실제 React처럼 안정적인 콜백을 보도록 해요.
    r.external.react.useCallback = (callback, dependencies) => {
        const ref = r.external.react.useRef(null);
        if (!ref.current || dependencies.some((value, index) => value !== ref.current.dependencies[index])) {
            ref.current = { callback, dependencies };
        }
        return ref.current.callback;
    };
    return r;
}

function stationSearchData(items) { return { items, page: 0, size: 50, totalElements: items.length }; }
function serverRouteStation(id, name, isSupported = true) {
    return { id, name, isSupported, latitude: 37.5, longitude: 127, lines: [{ lineId: 2, lineName: '2호선', color: '#00a84d', stationCode: String(id) }] };
}

test('경로 화면 초기 역은 서버 지원 역의 접미사 제외 정확한 이름과 ID 사용, 실패·미일치는 null', async () => {
    for (const outcome of ['found', 'missing', 'network']) {
        const r = routeScreenRuntime({ departure: ' 강남역 ', destination: '사당' });
        const calls = [];
        r.context.fetch = async (url, options) => {
            calls.push({ url, options });
            if (url.endsWith('/routes/search')) return jsonResponse({ success: true, data: routeData() });
            if (outcome === 'network') throw Error();
            const items = url.includes(encodeURIComponent('강남'))
                ? [serverRouteStation(701, '강남', false), serverRouteStation(702, '강남구청'), ...(outcome === 'found' ? [serverRouteStation(88001, '강남')] : [])]
                : [serverRouteStation(99002, '사당역')];
            return jsonResponse({ success: true, data: stationSearchData(items) });
        };
        r.render(); await settle(); let view = r.render(); await settle();
        const origin = findElement(view, element => element.props?.label === '출발').props.station;
        assert.equal(origin?.id ?? null, outcome === 'found' ? 88001 : null);
        assert.equal(findElement(view, element => element.props?.label === '도착').props.station?.id ?? null, outcome === 'network' ? null : 99002);
        if (outcome === 'found') {
            const request = calls.find(call => call.url.endsWith('/routes/search'));
            assert.deepEqual(JSON.parse(request.options.body), { originStationId: 88001, destinationStationId: 99002 });
        }
        r.unmount(); await settle();
    }
});

test('경로 초기 역의 늦은 응답은 바뀐 초기값·사용자의 새 선택을 덮지 않아요', async () => {
    const params = { departure: '이전' }; const r = routeScreenRuntime(params);
    const pending = [];
    r.context.fetch = () => new Promise(resolve => pending.push(resolve));
    r.render(); await settle(); params.departure = '현재'; r.render(); await settle();
    pending[1](jsonResponse({ success: true, data: stationSearchData([serverRouteStation(88001, '현재')]) }));
    await settle(); let view = r.render();
    assert.equal(findElement(view, element => element.props?.label === '출발').props.station.id, 88001);
    pending[0](jsonResponse({ success: true, data: stationSearchData([serverRouteStation(77001, '이전')]) }));
    await settle(); view = r.render();
    assert.equal(findElement(view, element => element.props?.label === '출발').props.station.id, 88001);
    // 피커에서 새 역을 고르는 동안 초기 조회를 무효화해요.
    params.departure = '느린초기값'; r.render(); await settle(); view = r.render();
    findElement(view, element => element.props?.label === '출발').props.onPress();
    // 피커 자체의 선택 동작은 기존 B-1 검사가 담당해요. 열기만 해도 초기 조회는 무효가 돼요.
    pending[2](jsonResponse({ success: true, data: stationSearchData([serverRouteStation(66001, '느린초기값')]) }));
    await settle(); view = r.render();
    assert.equal(findElement(view, element => element.props?.label === '출발').props.station.id, 88001);
    r.unmount();
});

test('경로 화면은 TOKEN 오류를 중복 안내하지 않고 경로 오류 코드는 기존 안내로 전달', async () => {
    for (const code of ['TOKEN_INVALID', 'TOKEN_EXPIRED', 'STATION_UNSUPPORTED', 'STATION_NOT_FOUND', 'ROUTE_NOT_FOUND', 'NETWORK_ERROR']) {
        const r = routeScreenRuntime({ departure: '강남', destination: '사당' });
        r.context.fetch = async url => {
            if (url.endsWith('/routes/search')) {
                if (code === 'NETWORK_ERROR') throw Error();
                return jsonResponse({ success: false, error: { code } }, code.startsWith('TOKEN_') ? 401 : code === 'STATION_UNSUPPORTED' ? 422 : 404);
            }
            return jsonResponse({ success: true, data: stationSearchData([url.includes(encodeURIComponent('강남')) ? serverRouteStation(88001, '강남') : serverRouteStation(99002, '사당')]) });
        };
        r.render(); await settle(); r.render(); await settle(); const view = r.render();
        const message = findElement(view, element => element.props?.code === code);
        assert.equal(!!message, !code.startsWith('TOKEN_'));
        r.unmount(); await settle();
    }
});

test('경로 표시: 미제공 회색·예상 요금·대기 필드 없는 시간·방향 코드 유지', () => {
    const r = createRuntime(); const route = routeData().routes[0];
    route.steps[1].stations[1].congestion = missingRouteCongestion();
    const congestion = r.load('src/components/route/Congestion.tsx');
    assert.equal(congestion.congestionColor(missingRouteCongestion()), congestion.UNSUPPORTED_COLOR);
    const empty = congestion.default({ congestion: missingRouteCongestion() });
    assert.ok(findElement(empty, element => element.props?.children === '혼잡도 데이터 미제공'));
    const format = r.load('src/components/route/format.ts');
    assert.equal(format.formatTotalTime(route.summary), '15분');
    assert.equal(format.formatWait(route.steps[1], false), '');
    assert.equal(format.formatDirection(route.steps[1]), '내선');
    for (const [directionCode, expected] of [['UP', '상행'], ['DOWN', '하행'], ['INNER', '내선'], ['OUTER', '외선'], ['LOOP', '순환']]) {
        assert.equal(format.formatDirection({ ...route.steps[1], directionCode, direction: null }), expected);
    }
    const card = r.load('src/components/route/RouteCard.tsx').default;
    assert.ok(findElement(card({ route, expanded: true }), element => element.props?.children === '예상'));
    const collapsed = card({ route, expanded: false });
    assert.ok(findElement(collapsed, element => Array.isArray(element.props?.children) && element.props.children.includes('예상 ')));
});

test('mock 경로 화면 초기값은 기존 mock 역을 그대로 사용해요', async () => {
    const r = routeScreenRuntime({ departure: '건대입구', destination: '사당' }, true);
    let calls = 0; r.context.fetch = async () => { calls++; throw Error(); };
    r.render(); await settle(); let view = r.render();
    assert.equal(findElement(view, element => element.props?.label === '출발').props.station.id, 114);
    assert.equal(findElement(view, element => element.props?.label === '도착').props.station.id, 109);
    r.advance(800); await settle(); view = r.render();
    assert.ok(findElement(view, element => element.props?.route?.routeId === 'r1'));
    assert.equal(calls, 0); r.unmount();
});

test('늦은 경로 응답은 최신 검색·동일역·미선택·닫힌 화면 상태를 덮지 않아요', async () => {
    for (const outcome of ['newer', 'same', 'empty', 'unmounted']) {
        const params = { departure: '건대입구', destination: '사당' };
        const r = routeScreenRuntime(params, true);
        const types = r.load('src/types/route.ts');
        const pending = [];
        r.load('src/services/route.ts').searchRoute = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
        r.render(); await settle(); let view = r.render(); await settle();
        assert.equal(pending.length, 1);
        if (outcome === 'unmounted') r.unmount();
        else {
            params.departure = outcome === 'newer' ? '홍대입구' : outcome === 'same' ? '사당' : '없는역';
            r.render(); await settle(); r.render(); await settle();
            if (outcome === 'newer') {
                assert.equal(pending.length, 2);
                const newer = routeData(); newer.routes[0].routeId = 'newest';
                pending[1].resolve(newer); await settle();
            }
        }
        pending[0].resolve(routeData()); await settle(); view = r.render();
        assert.equal(findElement(view, element => element.props?.route?.routeId === 'server-route-1'), null);
        if (outcome === 'newer') assert.ok(findElement(view, element => element.props?.route?.routeId === 'newest'));
        assert.ok(types.RouteSearchError); r.unmount();
    }
});

/* ---------- 실시간 도착정보 (#95, 명세 6.3) ---------- */

const ARRIVALS_BASE_MS = Date.parse('2026-11-11T08:00:00+09:00');
// 실서버(BE ArrivalResponse) 응답 모양이에요. stationId·lineId·nextStationName 은 없고, 행선지는 destinationName,
// message 는 항상 arvlMsg2 원문 문자열이에요.
const arrivalTrain = (overrides = {}) => ({
    destinationName: '성수', directionCode: 'INNER', secondsUntil: 125, stopsAway: null, message: '2분 5초 후', lastTrain: false, express: false, ...overrides,
});
const arrivalsData = (overrides = {}) => ({
    available: true, reason: null,
    receivedAt: '2026-11-11T08:00:00+09:00', trains: [arrivalTrain(), arrivalTrain({ secondsUntil: 365 })], ...overrides,
});
const arrivalsQuery = { stationId: 222, lineId: 2, nextStationId: 223, directionCode: 'INNER', limit: 2 };

test('도착정보 서버 요청: 경로·lineId 항상·선택 값은 있을 때만·limit 1~5', async () => {
    const r = createRuntime(serverEnv);
    const calls = [];
    r.context.fetch = async (url, options) => { calls.push({ url, options }); return ok(arrivalsData()); };
    const { fetchArrivals } = r.load('src/services/arrivals.ts');
    const base = 'https://example.test/api/v1/stations/222/arrivals';
    for (const [query, expected] of [
        [arrivalsQuery, `${base}?lineId=2&nextStationId=223&directionCode=INNER&limit=2`],
        [{ stationId: 222, lineId: 2 }, `${base}?lineId=2`],
        [{ stationId: 222, lineId: 2, nextStationId: undefined, directionCode: undefined, limit: undefined }, `${base}?lineId=2`],
        [{ stationId: 222, lineId: 2, directionCode: 'UP' }, `${base}?lineId=2&directionCode=UP`],
        [{ stationId: 222, lineId: 2, nextStationId: 223 }, `${base}?lineId=2&nextStationId=223`],
        [{ stationId: 222, lineId: 2, limit: 0 }, `${base}?lineId=2&limit=1`],
        [{ stationId: 222, lineId: 2, limit: 9 }, `${base}?lineId=2&limit=5`],
        [{ stationId: 222, lineId: 2, limit: 3.7 }, `${base}?lineId=2&limit=3`],
        [{ stationId: 222, lineId: 2, limit: NaN }, `${base}?lineId=2&limit=2`],
    ]) {
        await fetchArrivals(query);
        assert.equal(calls.at(-1).url, expected);
        assert.equal(calls.at(-1).options.method, 'GET');
    }
    assert.equal(calls.length, 9);
    assert.equal(r.timers.size, 0);
});

test('도착정보 잘못된 ID·방향은 /stations/NaN 같은 요청 없이 VALIDATION_ERROR', async () => {
    const r = createRuntime(serverEnv);
    let calls = 0;
    r.context.fetch = async () => { calls++; return ok(arrivalsData()); };
    const { fetchArrivals } = r.load('src/services/arrivals.ts');
    for (const query of [
        { stationId: NaN, lineId: 2 }, { stationId: undefined, lineId: 2 }, { stationId: '222', lineId: 2 },
        { stationId: 0, lineId: 2 }, { stationId: 1.5, lineId: 2 }, { stationId: 222, lineId: NaN },
        { stationId: 222, lineId: null }, { stationId: 222, lineId: 2, nextStationId: NaN },
        { stationId: 222, lineId: 2, directionCode: 'NORTH' },
    ]) {
        await assert.rejects(fetchArrivals(query), { code: 'VALIDATION_ERROR', status: 400 });
    }
    assert.equal(calls, 0);
});

test('도착정보 응답: 정상·빈 열차·available:false 는 오류 없이 통과', async () => {
    const r = createRuntime(serverEnv);
    let current;
    r.context.fetch = async () => ok(current);
    const { fetchArrivals } = r.load('src/services/arrivals.ts');

    current = { ...arrivalsData({ trains: [arrivalTrain({ directionCode: null, message: '전역 출발' })] }), extra: 1 };
    assert.deepEqual(plain(await fetchArrivals(arrivalsQuery)), arrivalsData({ trains: [arrivalTrain({ directionCode: null, message: '전역 출발' })] }));
    // BE 사실: secondsUntil 은 알 수 없으면 null("[N]번째 전역"), directionCode 는 매핑 안 되면 null, stopsAway 는 "[N]번째 전역"이 아니면 null,
    // available:true 면 reason:null 이에요. 모두 정상으로 받아요.
    const realTrains = [
        arrivalTrain({ directionCode: null, secondsUntil: null, stopsAway: 2, message: '[2]번째 전역' }),
        arrivalTrain({ directionCode: null, stopsAway: null, message: '2분 5초 후' }),
    ];
    current = arrivalsData({ reason: null, trains: realTrains });
    assert.deepEqual(plain(await fetchArrivals(arrivalsQuery)), arrivalsData({ reason: null, trains: realTrains }));
    // 화면이 쓰지 않는 값(directionCode·stopsAway·lastTrain·express)은 없어도 통과하고, 형식이 다르면 빼요.
    current = arrivalsData({ trains: [{ destinationName: '성수', secondsUntil: 90, message: '1분 30초 후' }, arrivalTrain({ stopsAway: '2', lastTrain: 'N', express: 1 })] });
    assert.deepEqual(plain((await fetchArrivals(arrivalsQuery)).trains), [
        { destinationName: '성수', directionCode: null, secondsUntil: 90, message: '1분 30초 후' },
        { destinationName: '성수', directionCode: 'INNER', secondsUntil: 125, message: '2분 5초 후' },
    ]);
    // 이전 이름 destinationLabel 로 와도 같은 값으로 받아요. stationId·lineId 는 숫자로 올 때만 담아요.
    current = { ...arrivalsData({ trains: [{ destinationLabel: '석남행', secondsUntil: 30, message: '30초 후' }] }), stationId: 222, lineId: 2 };
    const legacy = plain(await fetchArrivals(arrivalsQuery));
    assert.equal(legacy.trains[0].destinationName, '석남행');
    assert.equal(legacy.stationId, 222); assert.equal(legacy.lineId, 2);
    current = arrivalsData({ stationId: '222', lineId: null });
    const loose = plain(await fetchArrivals(arrivalsQuery));
    assert.equal(Object.hasOwn(loose, 'stationId'), false); assert.equal(Object.hasOwn(loose, 'lineId'), false);
    current = arrivalsData({ trains: [] });
    assert.deepEqual(plain(await fetchArrivals(arrivalsQuery)), arrivalsData({ trains: [] }));

    for (const reason of ['UNSUPPORTED_STATION', 'NO_DATA', 'UPSTREAM_ERROR', 'DISABLED']) {
        // available:false 면 reason 만 보고 나머지(이상한 trains 포함)는 들여다보지 않아요.
        for (const extra of [{ receivedAt: null, trains: [] }, { receivedAt: 'x', trains: [null] }, { receivedAt: undefined, trains: undefined }]) {
            current = { available: false, reason, ...extra };
            const result = plain(await fetchArrivals(arrivalsQuery));
            assert.equal(result.available, false);
            assert.equal(result.reason, reason);
            assert.deepEqual(result.trains, []);
        }
    }
});

test('도착정보 응답의 필드 누락·형식 오류는 UNKNOWN_ERROR', async () => {
    const r = createRuntime(serverEnv);
    let current;
    r.context.fetch = async () => ok(current);
    const { fetchArrivals } = r.load('src/services/arrivals.ts');
    const cases = [
        null, [], '응답',
        ...['available', 'receivedAt', 'trains'].map(key => { const data = arrivalsData(); delete data[key]; return data; }),
        ...['destinationName', 'secondsUntil', 'message'].map(key => {
            const train = arrivalTrain(); delete train[key]; return arrivalsData({ trains: [train] });
        }),
        arrivalsData({ available: 'true' }),
        arrivalsData({ receivedAt: null }), arrivalsData({ receivedAt: '시각 아님' }), arrivalsData({ receivedAt: 1731279600000 }),
        arrivalsData({ trains: {} }), arrivalsData({ trains: [null] }),
        arrivalsData({ trains: [arrivalTrain({ destinationName: null })] }),
        arrivalsData({ trains: [arrivalTrain({ destinationName: undefined, destinationLabel: 3 })] }),
        arrivalsData({ trains: [arrivalTrain({ directionCode: 'NORTH' })] }),
        arrivalsData({ trains: [arrivalTrain({ secondsUntil: '125' })] }),
        arrivalsData({ trains: [arrivalTrain({ secondsUntil: undefined })] }),
        arrivalsData({ trains: [arrivalTrain({ message: 0 })] }),
        { available: false, reason: null, receivedAt: null, trains: [] },
        { available: false, reason: 'OTHER', receivedAt: null, trains: [] },
        { available: false, receivedAt: null, trains: [] },
    ];
    for (let i = 0; i < cases.length; i++) {
        current = cases[i];
        await assert.rejects(fetchArrivals(arrivalsQuery), { code: 'UNKNOWN_ERROR' }, `변형 ${i}`);
    }
});

test('도착정보 서버 오류 code·상태를 그대로 전달하고 재시도하지 않아요', async () => {
    const r = createRuntime(serverEnv);
    const { fetchArrivals } = r.load('src/services/arrivals.ts');
    for (const [code, status] of [
        ['VALIDATION_ERROR', 400], ['STATION_NOT_FOUND', 404], ['NOT_FOUND', 404], ['INTERNAL_ERROR', 500],
        ['TOKEN_INVALID', 401], ['AUTH_REQUIRED', 401],
    ]) {
        let calls = 0;
        r.context.fetch = async () => { calls++; return jsonResponse({ success: false, error: { code, message: '서버 문구' } }, status); };
        await assert.rejects(fetchArrivals(arrivalsQuery), { code, status, message: '서버 문구' });
        assert.equal(calls, 1);
    }
    r.context.fetch = async () => { throw new TypeError('연결 실패'); };
    await assert.rejects(fetchArrivals(arrivalsQuery), { code: 'NETWORK_ERROR' });
});

test('도착정보 mock 은 기존 동작(정상·none·fail)을 유지하고 서버를 부르지 않으며, 서버 모드는 mock 인자를 무시', async () => {
    const mock = createRuntime();
    let calls = 0;
    mock.context.fetch = async () => { calls++; throw Error(); };
    const service = mock.load('src/services/arrivals.ts');
    const run = async (...args) => { const pending = service.fetchArrivals(...args); mock.advance(400); return pending; };
    const normal = plain(await run(arrivalsQuery));
    assert.equal(normal.available, true);
    assert.equal(normal.trains.length, 2);
    assert.equal(normal.trains[0].destinationName, '성수');
    assert.deepEqual(Object.keys(normal.trains[0]).sort(), ['destinationName', 'directionCode', 'express', 'lastTrain', 'message', 'secondsUntil', 'stopsAway']);
    assert.equal(Object.hasOwn(normal, 'stationId'), false);
    assert.equal(normal.trains[0].directionCode, 'INNER');
    assert.equal(normal.trains[0].message, `${Math.floor(normal.trains[0].secondsUntil / 60)}분 ${normal.trains[0].secondsUntil % 60}초 후`);
    assert.equal(normal.trains[1].secondsUntil - normal.trains[0].secondsUntil, 240);
    assert.ok(Number.isFinite(Date.parse(normal.receivedAt)));
    assert.equal((await run({ ...arrivalsQuery, limit: 9 })).trains.length, 5);
    assert.deepEqual(plain(await run(arrivalsQuery, 'none')), { available: false, reason: 'NO_DATA', receivedAt: null, trains: [] });
    const failed = service.fetchArrivals(arrivalsQuery, 'fail'); const rejected = assert.rejects(failed); mock.advance(400); await rejected;
    assert.equal(calls, 0);

    const server = createRuntime(serverEnv);
    let serverCalls = 0;
    server.context.fetch = async () => { serverCalls++; return ok(arrivalsData()); };
    const { fetchArrivals } = server.load('src/services/arrivals.ts');
    for (const flag of ['none', 'fail']) {
        assert.deepEqual(plain(await fetchArrivals(arrivalsQuery, flag)), arrivalsData());
    }
    assert.equal(serverCalls, 2);
    assert.equal(server.timers.size, 0);
});

test('"곧 도착" 표시: secondsUntil 이 숫자면 message 와 상관없이 카운트다운, null 일 때만 message', () => {
    const format = createRuntime().load('src/components/route/format.ts');
    const { formatNextTrain, formatDestination, ARRIVING_SOON_SEC } = format;
    const train = (secondsUntil, message = null) => ({ destinationName: '성수', secondsUntil, message });
    assert.equal(formatDestination('성수'), '성수행');
    assert.equal(formatDestination('성수행'), '성수행');
    assert.equal(formatDestination(' 석남 '), '석남행');
    assert.equal(ARRIVING_SOON_SEC, 60);
    assert.equal(Object.hasOwn(format, 'isTimeMessage'), false);
    // secondsUntil 이 숫자면 message(시간 문구든 상태 문구든)와 상관없이 계산해요. 경계: 60 → 1분 0초, 59·0 → 곧 도착
    for (const message of ['2분 50초 후', '전역 출발', '[2]번째 전역', '[3]번째 전역 (남영)', '성수행 전역 도착', '', null]) {
        assert.equal(formatNextTrain(train(60, message), 0), '성수행 1분 0초', String(message));
        assert.equal(formatNextTrain(train(59, message), 0), '성수행 곧 도착', String(message));
        assert.equal(formatNextTrain(train(0, message), 0), '성수행 곧 도착', String(message));
        assert.equal(formatNextTrain(train(100, message), 0), '성수행 1분 40초', String(message));
        assert.equal(formatNextTrain(train(100, message), 41), '성수행 곧 도착', String(message));
    }
    // 지난 시간을 빼고, 0 아래로 내려가지 않아요.
    assert.equal(formatNextTrain(train(125), 65), '성수행 1분 0초');
    assert.equal(formatNextTrain(train(125), 66), '성수행 곧 도착');
    assert.equal(formatNextTrain(train(30), 500), '성수행 곧 도착');
    assert.equal(formatNextTrain(train(125), -30), '성수행 2분 5초');
    // secondsUntil 이 null 일 때만 message 를 "성수행 · 문구"로 보여주고, 행선지는 한 번만 나와요.
    // 맨 앞 "[N]" 은 대괄호만 빼고(#103), 괄호 안 역 이름과 나머지 글자는 서버 원문 그대로예요.
    assert.equal(formatNextTrain(train(null, '[2]번째 전역'), 0), '성수행 · 2번째 전역');
    assert.equal(formatNextTrain({ destinationName: '의정부', secondsUntil: null, message: '[3]번째 전역 (남영)' }, 0), '의정부행 · 3번째 전역 (남영)');
    assert.equal(formatNextTrain(train(null, '[12]번째 전역 (남영)'), 0), '성수행 · 12번째 전역 (남영)');
    assert.equal(formatNextTrain(train(null, '성수행 [3]번째 전역 (남영)'), 0), '성수행 · 3번째 전역 (남영)');
    assert.equal(formatNextTrain(train(null, '전역 출발 [3]'), 0), '성수행 · 전역 출발 [3]');
    assert.equal(formatNextTrain(train(null, '[급행] 전역 출발'), 0), '성수행 · [급행] 전역 출발');
    assert.equal(formatNextTrain(train(null, ' 전역 출발 '), 99), '성수행 · 전역 출발');
    assert.equal(formatNextTrain(train(null, '성수행 전역 출발'), 0), '성수행 · 전역 출발');
    assert.equal(formatNextTrain(train(null, '성수행'), 0), '성수행');
    assert.equal(formatNextTrain(train(null, '   '), 0), '성수행');
    assert.equal(formatNextTrain(train(null, null), 0), '성수행');
    assert.equal(formatNextTrain({ destinationName: '성수행', secondsUntil: null, message: '성수행 · 전역 출발' }, 0), '성수행 · 전역 출발');
});

/** NextTrains 컴포넌트만 구동해요. 실제 React·브라우저 렌더링 검사를 대신하지 않아요. */
function nextTrainsRuntime(env = serverEnv, baseMs = ARRIVALS_BASE_MS) {
    const r = createScreenRuntime(env, 'src/components/route/NextTrains.tsx');
    // 화면 진입(focus) 효과를 한 번만 실행하도록 실제 React 처럼 안정적인 콜백을 써요.
    r.external.react.useCallback = (callback, dependencies) => {
        const ref = r.external.react.useRef(null);
        if (!ref.current || dependencies.some((value, index) => value !== ref.current.dependencies[index])) {
            ref.current = { callback, dependencies };
        }
        return ref.current.callback;
    };
    r.external['expo-router'].useFocusEffect = callback => r.external.react.useEffect(callback, [callback]);
    // vm 안의 Date 는 바깥과 따로라서 그 안에서 가상 시계에 맞춰요.
    vm.runInContext('Date', r.context).now = () => baseMs + r.now();
    const calls = [];
    let responder = async () => ok(arrivalsData());
    r.context.fetch = async (url, options) => { calls.push(url); return responder(url, options); };
    const step = {
        type: 'SUBWAY', line: { id: 2, name: '2호선', color: '#00a84d' }, directionCode: 'INNER', direction: null,
        stops: [{ id: 222, name: '강남', order: 0 }, { id: 223, name: '역삼', order: 1 }, { id: 224, name: '선릉', order: 2 }],
    };
    const element = (props = {}) => ({ type: r.screen.default, props: { step, ...props } });
    const text = props => {
        const view = r.renderComponent(element(props));
        if (!view) return null;
        const flat = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(flat).join('') : typeof node === 'object' ? flat(node.props?.children) : String(node);
        return flat(view);
    };
    const receivedNow = () => new Date(baseMs + r.now()).toISOString();
    return { ...r, calls, text, receivedNow, respond: fn => { responder = fn; } };
}

test('NextTrains: 첫 승차 구간 조건으로 부르고 카운트다운 중 1분 아래에서 "곧 도착", 20초 전에는 다시 부르지 않아요', async () => {
    const r = nextTrainsRuntime();
    r.respond(async () => ok(arrivalsData({ receivedAt: r.receivedNow(), trains: [arrivalTrain({ secondsUntil: 61 }), arrivalTrain({ secondsUntil: 300 })] })));
    assert.equal(r.text(), '다음 열차 확인 중');
    await flush();
    assert.deepEqual(r.calls, ['https://example.test/api/v1/stations/222/arrivals?lineId=2&nextStationId=223&directionCode=INNER&limit=2']);
    assert.equal(r.text(), '다음 열차 · 성수행 1분 1초 · 성수행 5분 0초');
    r.advance(1000); assert.equal(r.text(), '다음 열차 · 성수행 1분 0초 · 성수행 4분 59초');
    r.advance(1000); assert.equal(r.text(), '다음 열차 · 성수행 곧 도착 · 성수행 4분 58초');
    r.advance(17999); await flush();
    assert.equal(r.calls.length, 1);
    r.advance(1); await flush();
    assert.equal(r.calls.length, 2);
    r.advance(20000); await flush();
    assert.equal(r.calls.length, 3);
    // secondsUntil 이 null 일 때만 message 를 보여주고, 숫자인 열차는 message 와 상관없이 카운트다운해요.
    r.respond(async () => ok(arrivalsData({ receivedAt: r.receivedNow(), trains: [
            arrivalTrain({ secondsUntil: null, stopsAway: 2, message: '[2]번째 전역' }),
            arrivalTrain({ secondsUntil: 200, message: '전역 출발' }),
        ] })));
    r.advance(20000); await flush();
    assert.equal(r.text(), '다음 열차 · 성수행 · 2번째 전역 · 성수행 3분 20초');
    r.advance(1000);
    assert.equal(r.text(), '다음 열차 · 성수행 · 2번째 전역 · 성수행 3분 19초');
    r.unmount();
    assert.equal(r.timers.size, 0);
});

test('NextTrains: available:false(receivedAt null)·receivedAt 없음·빈 열차·UNKNOWN_ERROR·서버 오류·네트워크 실패면 줄만 숨겨요', async () => {
    for (const outcome of ['unavailable', 'noReceivedAt', 'empty', 'malformed', 'server', 'network']) {
        const r = nextTrainsRuntime();
        r.respond(async () => ok(arrivalsData({ receivedAt: r.receivedNow() })));
        r.text(); await flush();
        assert.ok(r.text().startsWith('다음 열차 · 성수행'), outcome);
        r.respond(async () => {
            // BE 는 available:false 여도 reason·receivedAt(null 가능)·trains([])를 항상 보내요.
            if (outcome === 'unavailable') return ok({ available: false, reason: 'UNSUPPORTED_STATION', receivedAt: null, trains: [] });
            if (outcome === 'noReceivedAt') return ok(arrivalsData({ receivedAt: null }));
            if (outcome === 'empty') return ok(arrivalsData({ receivedAt: r.receivedNow(), trains: [] }));
            if (outcome === 'malformed') return ok(arrivalsData({ trains: [{ secondsUntil: '1' }] }));
            if (outcome === 'server') return jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR' } }, 500);
            throw new TypeError('연결 실패');
        });
        r.advance(20000); await flush();
        assert.equal(r.text(), null, outcome);
        r.unmount();
    }
});

test('NextTrains: 인증 오류는 이전 값을 유지하고, 토큰 갱신 중에도 줄이 유지되며 겹쳐 부르지 않아요', async () => {
    const r = nextTrainsRuntime();
    const api = r.load('src/services/api/client.ts');
    let token = 'token-old';
    const refresh = deferred();
    let refreshes = 0;
    api.setAccessTokenProvider(() => token);
    api.setTokenRefresher(async () => { refreshes++; await refresh.promise; token = 'token-new'; });
    const authHeaders = [];
    r.respond(async (_url, options) => {
        authHeaders.push(options.headers.Authorization);
        return ok(arrivalsData({ receivedAt: r.receivedNow(), trains: [arrivalTrain({ secondsUntil: 600 })] }));
    });
    r.text(); await flush();
    assert.equal(r.text(), '다음 열차 · 성수행 10분 0초');

    // TOKEN_INVALID 처럼 갱신 없이 실패하는 인증 오류: 이전 값을 그대로 둬요.
    r.respond(async () => fail('TOKEN_INVALID'));
    r.advance(20000); await flush();
    assert.equal(r.text(), '다음 열차 · 성수행 9분 40초');

    // TOKEN_EXPIRED: 갱신이 끝날 때까지 요청이 끝나지 않으므로 이전 값이 보이고, 다음 폴링은 건너뛰어요.
    r.respond(async (_url, options) => {
        authHeaders.push(options.headers.Authorization);
        if (options.headers.Authorization === 'Bearer token-old') return fail('TOKEN_EXPIRED');
        return ok(arrivalsData({ receivedAt: r.receivedNow(), trains: [arrivalTrain({ secondsUntil: 90 })] }));
    });
    const before = r.calls.length;
    r.advance(20000); await flush();
    assert.equal(r.calls.length, before + 1);
    assert.equal(refreshes, 1);
    assert.equal(r.text(), '다음 열차 · 성수행 9분 20초');
    r.advance(20000); await flush();
    assert.equal(r.calls.length, before + 1, '갱신 중에는 다음 폴링을 겹쳐 보내지 않아요');
    assert.equal(r.text(), '다음 열차 · 성수행 9분 0초');
    refresh.resolve(); await flush();
    assert.equal(r.calls.length, before + 2);
    assert.equal(authHeaders.at(-1), 'Bearer token-new');
    assert.equal(r.text(), '다음 열차 · 성수행 1분 30초');
    r.unmount();
});

test('NextTrains: mock 모드의 정상·none·fail 표시와 서버 미호출', async () => {
    for (const flag of [undefined, 'none', 'fail']) {
        const r = nextTrainsRuntime({});
        r.text({ mock: flag });
        r.advance(400); await flush();
        const shown = r.text({ mock: flag });
        if (flag) assert.equal(shown, null, flag);
        else assert.match(shown, /^다음 열차 · 성수행 3분 2초 · 성수행 7분 2초$/);
        assert.equal(r.calls.length, 0);
        r.unmount();
    }
});

// 2026-11-11 강남 → 사당 안내 화면에서 실서버가 실제로 보낸 응답을 그대로 옮겼어요.
const REAL_ARRIVALS_RESPONSE = '{"data":{"available":true,"reason":null,"receivedAt":"2026-11-11T20:54:55+09:00","trains":['
    + '{"destinationName":"성수","directionCode":"INNER","secondsUntil":100,"stopsAway":null,"message":"2분 20초 후","lastTrain":false,"express":false},'
    + '{"destinationName":"성수","directionCode":"INNER","secondsUntil":370,"stopsAway":null,"message":"6분 50초 후","lastTrain":false,"express":false}]},"success":true}';

/** 기기 시계를 receivedAt 에 맞추고, 첫 호출만 실서버 응답을 줘요. 이후 폴링은 끝나지 않게 둬서(겹침 방지로 건너뜀) 받은 값의 카운트다운만 봐요. */
async function realArrivalsScreen() {
    const r = nextTrainsRuntime(serverEnv, Date.parse('2026-11-11T20:54:55+09:00'));
    let first = true;
    r.respond(() => {
        if (!first) return new Promise(() => {});
        first = false;
        return Promise.resolve({ ok: true, status: 200, text: async () => REAL_ARRIVALS_RESPONSE });
    });
    r.text(); await flush();
    return r;
}

test('NextTrains: message 가 항상 있는 실서버 응답도 secondsUntil 로 카운트다운하고 41초 뒤 첫 열차는 곧 도착', async () => {
    const r = await realArrivalsScreen();
    const shown = r.text();
    assert.ok(shown, '줄이 보여야 해요');
    assert.equal((shown.match(/성수행/g) ?? []).length, 2);
    assert.equal(shown, '다음 열차 · 성수행 1분 40초 · 성수행 6분 10초');
    r.advance(1000);
    assert.equal(r.text(), '다음 열차 · 성수행 1분 39초 · 성수행 6분 9초');
    r.advance(40000); await flush();
    // 20초에 다시 불렀고, 그 요청이 끝나지 않아 40초 폴링은 겹침 방지로 건너뛰었어요.
    assert.equal(r.calls.length, 2);
    assert.equal(r.text(), '다음 열차 · 성수행 곧 도착 · 성수행 5분 29초');
    r.unmount();
});

const ROOM_QUERY_ME = '11111111-1111-4111-8111-111111111111';
function chat118Message(overrides = {}) {
    return { id: '01900000-0000-7000-8000-000000000001', senderType: 'USER', senderId: ROOM_QUERY_ME,
        nickname: '서버 나', content: '  @링크로 안녕 😀  ', createdAt: '2026-11-12T10:00:00Z', meta: null, ...overrides };
}

test('118 REST body 원문·코드포인트 1000 경계·잘못된 본문 선차단', async () => {
    const r = roomQueryRuntime(); const chat = r.load('src/services/chat.ts');
    r.respond(async (_url, options) => ok({ message: chat118Message({ content: JSON.parse(options.body).content }), aiPending: true }));
    for (const content of ['  @링크로 안녕 😀  ', '@linkro hello', '가'.repeat(1000), '😀'.repeat(1000)]) {
        const result = await chat.sendChatMessage(ROOM_QUERY_ID, { content }, { mock: 'chat-send-error', clientId: 'local-only' });
        assert.equal(result.message.content, content);
        assert.deepEqual(JSON.parse(r.calls.at(-1).options.body), { content });
        assert.equal(chat.chatContentLength(content), [...content].length);
    }
    const count = r.calls.length;
    for (const content of [' \t\n', 'a\0b', '가'.repeat(1001), '😀'.repeat(1001), ' ' + '가'.repeat(1000), null, 3]) {
        await assert.rejects(chat.sendChatMessage(ROOM_QUERY_ID, { content }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(r.calls.length, count);
    assert.equal(chat.toChatDisplayContent('@linkro'), '@linkro');
});

test('118 커서 페이지·AI SYSTEM nullable 파싱·시간순 병합과 id 중복 제거', async () => {
    const r = roomQueryRuntime(); const chat = r.load('src/services/chat.ts');
    const newest = chat118Message();
    const ai = chat118Message({ id: ROOM_QUERY_ID, senderType: 'AI', senderId: null, nickname: null, createdAt: '2026-11-12T09:59:00Z' });
    const system = chat118Message({ id: ROOM_QUERY_ID2, senderType: 'SYSTEM', senderId: null, nickname: null, createdAt: '2026-11-12T09:58:00Z' });
    r.respond(async url => ok(url.includes('cursor=') ? { items: [ai, system], nextCursor: null, hasMore: false } : { items: [newest, ai], nextCursor: ai.id, hasMore: true }));
    const page1 = await chat.fetchChatMessages(ROOM_QUERY_ID);
    const page2 = await chat.fetchChatMessages(ROOM_QUERY_ID, { cursor: page1.nextCursor });
    assert.ok(r.calls[1].url.endsWith(`?cursor=${ai.id}&size=30`));
    const { mergeChatMessages } = r.load('src/hooks/use-room-chat.ts');
    assert.deepEqual(plain(mergeChatMessages(page1.items, page2.items)), [system, ai, newest]);
    assert.equal(page2.hasMore, false); assert.equal(page2.nextCursor, null);
    assert.equal(chat.parseChatMessage(chat118Message({ nickname: null })).nickname, null);
    for (const malformed of [{ senderType: 'BOGUS' }, { senderType: ['AI'], senderId: null, nickname: null }, { senderId: null }, { nickname: undefined }, { meta: {} }, { createdAt: 'bad' }, { id: 'bad' }, { senderType: 'AI' }]) {
        r.respond(async () => ok({ items: [chat118Message(malformed)], nextCursor: null, hasMore: false }));
        await assert.rejects(chat.fetchChatMessages(ROOM_QUERY_ID), { code: 'UNKNOWN_ERROR' });
    }
    for (const raw of [{ items: [], hasMore: false, nextCursor: ai.id }, { items: [], hasMore: true, nextCursor: null }, { message: newest, aiPending: 'true' }]) {
        r.respond(async () => ok(raw));
        await assert.rejects(raw.message ? chat.sendChatMessage(ROOM_QUERY_ID, { content: 'hi' }) : chat.fetchChatMessages(ROOM_QUERY_ID), { code: 'UNKNOWN_ERROR' });
    }
});

test('118 오류 매핑·403/404 캐시 제거·인증 오류 보존', async () => {
    for (const [code, status, expected] of [['NOT_ROOM_MEMBER', 403, 'NOT_ROOM_MEMBER'], ['ROOM_NOT_FOUND', 404, 'ROOM_NOT_FOUND'],
        ['VALIDATION_ERROR', 400, 'VALIDATION_ERROR'], ['INTERNAL_ERROR', 500, 'UNKNOWN_ERROR'], ['TOKEN_INVALID', 401, 'TOKEN_INVALID'], ['NETWORK_ERROR', 0, 'NETWORK_ERROR']]) {
        for (const method of ['send', 'fetch']) {
            const r = roomQueryRuntime(); room107Seed(r); const chat = r.load('src/services/chat.ts');
            r.respond(async () => { if (!status) throw TypeError(); return recoFail(code, status, { content: 'invalid' }); });
            await assert.rejects(method === 'send' ? chat.sendChatMessage(ROOM_QUERY_ID, { content: '안녕' }) : chat.fetchChatMessages(ROOM_QUERY_ID), { code: expected });
            if (status === 403 || status === 404) assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID), undefined);
        }
    }
});

test('118 mock 멘션 변환·trim·로컬 재시도·커서 동작 유지', async () => {
    const r = createRuntime(); const chat = r.load('src/services/chat.ts'); let calls = 0;
    r.context.fetch = () => { calls++; throw Error(); };
    const request = { content: '  @링크로 안녕  ' };
    const sent = await finishRoomMock(r, chat.sendChatMessage('room-4', request, { clientId: 'same' }));
    assert.equal(sent.message.content, '@linkro 안녕'); assert.equal(sent.aiPending, true);
    const retry = await finishRoomMock(r, chat.sendChatMessage('room-4', request, { clientId: 'same' }));
    assert.equal(retry.message.id, sent.message.id);
    const page = await finishRoomMock(r, chat.fetchChatMessages('room-4', { size: 3 }));
    assert.equal(page.items.length, 3); assert.equal(page.hasMore, true);
    const older = await finishRoomMock(r, chat.fetchChatMessages('room-4', { cursor: page.nextCursor }));
    assert.ok(!older.items.some(item => item.id === page.items[0].id));
    assert.equal(chat.toChatDisplayContent('@linkro'), '@링크로'); assert.equal(calls, 0);
});

function chat118Hook(realtimeState = 'closed') {
    const r = roomQueryScreen('src/hooks/use-room-chat.ts');
    r.external.react.useSyncExternalStore = (_subscribe, read) => read();
    let listener, options;
    const stateListeners = new Set();
    const realtime = r.load('src/services/realtime.ts');
    realtime.getRealtimeState = () => realtimeState;
    realtime.subscribeRealtimeState = callback => { stateListeners.add(callback); return () => stateListeners.delete(callback); };
    realtime.subscribeRoomEvents = (_room, callback, callbacks) => {
        listener = callback; options = callbacks; r.subscribed = true;
        return () => { r.subscribed = false; };
    };
    r.event = (payload, type = 'MESSAGE_CREATED') => listener?.({ type, roomId: ROOM_QUERY_ID, payload, at: payload.createdAt });
    r.captureEvent = () => { const current = listener; return payload => current({ type: 'MESSAGE_CREATED', roomId: ROOM_QUERY_ID, payload, at: payload.createdAt }); };
    r.reconnect = () => options.onReconnected();
    r.prepared = () => options.onSubscribed();
    r.reject = code => options.onRejected(code);
    r.realtimeState = value => { realtimeState = value; stateListeners.forEach(callback => callback()); };
    r.screen.default = () => r.screen.useRoomChat(ROOM_QUERY_ID);
    room107TrackFocus(r);
    return r;
}

test('118 realtime 구독 예외에도 초기 로드·전송·3초 REST AI 수신 유지', async () => {
    for (const dev of [false, true]) {
        const r = chat118Hook('closed');
        const logs = [];
        r.context.__DEV__ = dev;
        r.context.console = { ...console, debug: (...args) => logs.push(args) };
        let subscriptions = 0, gets = 0, posts = 0;
        r.load('src/services/realtime.ts').subscribeRoomEvents = () => {
            subscriptions++;
            throw Error('invalid https://private.test/api token=secret message=private');
        };
        const question = chat118Message();
        let items = [];
        r.context.fetch = async (_url, options) => {
            if (options.method === 'POST') {
                posts++; items = [question];
                return ok({ message: question, aiPending: true });
            }
            gets++;
            return ok({ items, hasMore: false, nextCursor: null });
        };
        assert.doesNotThrow(() => r.render());
        await settle();
        assert.equal(subscriptions, 1);
        assert.equal(r.render().status, 'ready');
        assert.equal(gets, 1);
        r.render().setDraft(question.content); r.render().send(); await settle();
        assert.equal(posts, 1);
        assert.equal(r.render().pending.length, 0);
        assert.equal(r.render().messages[0].id, question.id);
        assert.equal(r.render().aiPending, 1);
        const reply = chat118Message({ id: ROOM_QUERY_ID, senderType: 'AI', senderId: null, nickname: null, createdAt: '2026-11-12T10:00:03Z' });
        items = [reply, question];
        r.advance(2999); await settle(); assert.equal(gets, 1);
        r.advance(1); await settle();
        assert.equal(gets, 2);
        assert.deepEqual(plain(r.render().messages), [question, reply]);
        assert.equal(r.render().aiPending, 0);
        assert.deepEqual(logs, dev ? [['[chat] realtime subscription unavailable; using REST fallback']] : []);
        assert.doesNotThrow(() => r.unmount());
        assert.equal(r.timers.size, 0);
    }
});

test('118 realtime 초기 조회 중 USER SYSTEM AI 병합·정렬·중복·형식 검증', async () => {
    const r = chat118Hook('open'); let resolve;
    r.context.fetch = async () => await new Promise(done => { resolve = done; });
    r.render(); await settle();
    const user = chat118Message();
    const ai = chat118Message({ id: ROOM_QUERY_ID, senderType: 'AI', senderId: null, nickname: null, createdAt: '2026-11-12T10:00:02Z' });
    const system = chat118Message({ id: ROOM_QUERY_ID2, senderType: 'SYSTEM', senderId: null, nickname: null, createdAt: '2026-11-12T10:00:01Z' });
    r.event(ai); r.event(user); r.event(system); r.event(user);
    r.event(chat118Message({ id: 'bad' })); r.event(chat118Message({ meta: {} })); r.event(user, 'MEMBER_JOINED');
    resolve(ok({ items: [user], hasMore: true, nextCursor: user.id })); await settle();
    const view = r.render();
    assert.deepEqual(plain(view.messages), [user, system, ai]); assert.equal(view.hasMore, true);
    r.unmount(); assert.equal(r.subscribed, false); assert.equal(r.timers.size, 0);
});

test('118 realtime 내 이벤트는 응답 이전·timeout 이후 oldest pending 하나만 확인', async () => {
    for (const late of [false, true]) {
        const r = chat118Hook('open'); let resolve;
        const old = chat118Message({ content: '같은 본문' });
        const saved = chat118Message({ id: ROOM_QUERY_ID, content: old.content });
        r.context.fetch = async (_url, options) => options.method === 'POST'
            ? await new Promise((done, reject) => { resolve = done; options.signal.addEventListener('abort', () => reject(Error('timeout'))); })
            : ok({ items: [old], hasMore: false, nextCursor: null });
        r.render(); await settle(); r.render().setDraft(old.content); r.render().send(); await settle();
        r.event(old); assert.equal(r.render().pending.length, 1);
        if (late) { r.advance(10000); await settle(); assert.equal(r.render().pending[0].status, 'failed'); }
        r.event(saved); assert.equal(r.render().pending.length, 0);
        resolve(ok({ message: saved, aiPending: false })); await settle();
        assert.equal(r.render().messages.length, 2); r.unmount();
    }
    const r = chat118Hook('open');
    r.context.fetch = async (_url, options) => { if (options.method === 'POST') throw TypeError('lost'); return ok({ items: [], hasMore: false, nextCursor: null }); };
    r.render(); await settle();
    for (let i = 0; i < 2; i++) { r.render().setDraft('같은 본문'); r.render().send(); await settle(); }
    const first = r.render().pending[0].clientId;
    const saved = chat118Message({ content: '같은 본문' });
    r.event(saved); r.event(saved);
    assert.equal(r.render().pending.length, 1); assert.notEqual(r.render().pending[0].clientId, first);
    r.unmount();
});

test('118 realtime AI·정확한 SYSTEM 실패만 대기 해제·응답 전 AI도 처리', async () => {
    for (const content of [null, 'AI 사용 한도를 초과해 답변하지 못했어요.', 'AI가 답변을 만들지 못했어요.']) {
        const r = chat118Hook('open');
        r.context.fetch = async (_url, options) => ok(options.method === 'POST'
            ? { message: chat118Message(), aiPending: true } : { items: [], hasMore: false, nextCursor: null });
        r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
        const system = chat118Message({ id: ROOM_QUERY_ID, senderType: 'SYSTEM', senderId: null, nickname: null,
            content: 'AI링크로님이 참여했어요.', createdAt: '2026-11-12T10:00:03Z' });
        r.event(system); assert.equal(r.render().aiPending, 1);
        r.event({ ...system, id: ROOM_QUERY_ID2, senderType: content ? 'SYSTEM' : 'AI', content: content ?? '답변' });
        assert.equal(r.render().aiPending, 0); assert.equal(r.timers.size, 0); r.unmount();
    }
    const r = chat118Hook('open'); let resolve;
    r.context.fetch = async (_url, options) => options.method === 'POST' ? await new Promise(done => { resolve = done; }) : ok({ items: [], hasMore: false, nextCursor: null });
    r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
    r.event(chat118Message({ id: ROOM_QUERY_ID, senderType: 'AI', senderId: null, nickname: null, createdAt: '2026-11-12T10:00:03Z' }));
    resolve(ok({ message: chat118Message(), aiPending: true })); await settle();
    assert.equal(r.render().aiPending, 0); assert.equal(r.timers.size, 0); r.unmount();
});

test('118 realtime open은 60초 1회 REST·연결 종료는 3초 폴백·복구 시 폴백 중지', async () => {
    for (const fallback of [false, true]) {
        const r = chat118Hook('open'); let gets = 0;
        r.context.fetch = async (_url, options) => {
            if (options.method === 'POST') return ok({ message: chat118Message(), aiPending: true });
            gets++; return ok({ items: [], hasMore: false, nextCursor: null });
        };
        r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
        r.advance(3000); await settle(); assert.equal(gets, 1);
        if (fallback) { r.realtimeState('closed'); r.advance(3000); await settle(); assert.equal(gets, 2); r.realtimeState('open'); }
        r.advance(57000); await settle();
        assert.equal(gets, fallback ? 3 : 2); assert.equal(r.render().aiPending, 0);
        r.advance(60000); await settle(); assert.equal(gets, fallback ? 3 : 2); r.unmount();
    }
});

test('118 realtime 재연결 병합·refreshAgain·draft pending 유지·blur 수신', async () => {
    const r = chat118Hook('open'); let gets = 0, resolve;
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') throw TypeError('전송 실패');
        gets++;
        if (gets === 2) return await new Promise(done => { resolve = done; });
        return ok({ items: [], hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); r.render().setDraft('보류'); r.render().send(); await settle();
    r.render().setDraft('작성 중'); const pending = plain(r.render().pending);
    r.reconnect(); await settle(); r.reconnect();
    const missed = chat118Message({ content: '놓친 메시지', senderId: ROOM_QUERY_OTHER });
    resolve(ok({ items: [missed], hasMore: false, nextCursor: null })); await settle();
    assert.equal(gets, 3); assert.deepEqual(plain(r.render().pending), pending); assert.equal(r.render().draft, '작성 중');
    r.blur(); r.event(chat118Message({ id: ROOM_QUERY_ID, content: 'blur 중', senderId: ROOM_QUERY_OTHER }));
    assert.equal(r.render().messages.length, 2); assert.equal(r.subscribed, true); r.unmount();
});

test('118 realtime 접근 거부만 blocked·늦은 초기 응답 및 이벤트 무시', async () => {
    for (const code of ['NOT_ROOM_MEMBER', 'ROOM_NOT_FOUND', 'VALIDATION_ERROR', 'INTERNAL_ERROR']) {
        const r = chat118Hook('open'); let resolve;
        r.context.fetch = async () => await new Promise(done => { resolve = done; });
        r.render(); await settle(); r.reject(code);
        resolve(ok({ items: [chat118Message()], hasMore: false, nextCursor: null })); await settle(); r.event(chat118Message());
        const denied = ['NOT_ROOM_MEMBER', 'ROOM_NOT_FOUND'].includes(code);
        assert.equal(r.render().blocked, denied); assert.equal(r.render().messages.length, denied ? 0 : 1);
        assert.equal(r.timers.size, 0); r.unmount();
    }
});

test('118 realtime 이전 방·계정·unmount 이벤트 무시·blur AI 타이머 정리', async () => {
    for (const stop of ['room', 'account', 'unmount', 'blur']) {
        const r = chat118Hook('open');
        r.context.fetch = async (_url, options) => ok(options.method === 'POST' ? { message: chat118Message(), aiPending: true } : { items: [], hasMore: false, nextCursor: null });
        r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
        const event = r.captureEvent();
        if (stop === 'room') { r.screen.default = () => r.screen.useRoomChat(ROOM_QUERY_ID2); r.render(); await settle(); }
        if (stop === 'account') { r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '다른 계정' }); r.render(); await settle(); }
        if (stop === 'unmount') r.unmount();
        if (stop === 'blur') r.blur();
        event(chat118Message({ id: ROOM_QUERY_ID2, senderType: 'AI', senderId: null, nickname: null, createdAt: '2026-11-12T10:00:03Z' }));
        const view = r.render();
        if (stop === 'blur') { assert.equal(view.messages.length, 2); assert.equal(view.aiPending, 0); }
        else assert.ok(!view.messages.some(message => message.id === ROOM_QUERY_ID2));
        r.unmount(); assert.equal(r.timers.size, 0);
    }
});

test('118 realtime fallback 진행 중 60초 안전 조회는 같은 REST를 공유하고 늦은 결과도 중복 없음', async () => {
    const r = chat118Hook('closed'); let gets = 0, resolve;
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') return ok({ message: chat118Message(), aiPending: true });
        gets++;
        if (gets > 1) return await new Promise(done => { resolve = done; });
        return ok({ items: [], hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
    r.advance(3000); await settle(); assert.equal(gets, 2);
    r.advance(57000); await settle(); assert.equal(gets, 2);
    const reply = chat118Message({ id: ROOM_QUERY_ID, senderType: 'AI', senderId: null, nickname: null, createdAt: '2026-11-12T10:00:03Z' });
    r.event(reply); resolve(ok({ items: [reply], hasMore: false, nextCursor: null })); await settle();
    assert.equal(r.render().messages.length, 2); assert.equal(r.render().aiPending, 0); assert.equal(r.timers.size, 0); r.unmount();
});

test('118 mock 훅은 realtime 구독 없이 기존 알림으로 AI 답변 수신', async () => {
    const r = createScreenRuntime({}, 'src/hooks/use-room-chat.ts');
    r.external['expo-router'].useFocusEffect = callback => r.external.react.useEffect(callback, []);
    r.external.react.useCallback = (callback, dependencies) => {
        const ref = r.external.react.useRef(null);
        if (!ref.current || dependencies.some((value, index) => value !== ref.current.dependencies[index])) ref.current = { callback, dependencies };
        return ref.current.callback;
    };
    const realtime = r.load('src/services/realtime.ts');
    realtime.subscribeRoomEvents = () => { throw Error('mock은 realtime 구독 불가'); };
    realtime.subscribeRealtimeState = () => { throw Error('mock은 realtime 상태 구독 불가'); };
    r.screen.default = () => r.screen.useRoomChat('room-4');
    r.render();
    for (let i = 0; i < 15; i++) { r.advance(400); await settle(); }
    assert.equal(r.render().status, 'ready');
    const before = r.render().messages.length;
    r.render().setDraft('  @링크로 질문  '); r.render().send();
    for (let i = 0; i < 30; i++) { r.advance(400); await settle(); }
    assert.equal(r.render().messages.length, before + 2); assert.equal(r.render().aiPending, 0);
    assert.ok(r.render().messages.some(message => message.content === '@linkro 질문'));
    r.unmount(); assert.equal(r.timers.size, 0);
});

test('118 먼저 응답된 내 메시지 이벤트가 동일 본문의 다른 pending을 제거하지 않음', async () => {
    const r = chat118Hook('open'); const responses = [];
    r.context.fetch = async (_url, options) => options.method === 'POST'
        ? await new Promise(resolve => responses.push(resolve)) : ok({ items: [], hasMore: false, nextCursor: null });
    r.render(); await settle();
    for (let i = 0; i < 2; i++) { r.render().setDraft('동일 본문'); r.render().send(); await settle(); }
    const saved = chat118Message({ content: '동일 본문' });
    responses[0](ok({ message: saved, aiPending: false })); await settle();
    const remaining = r.render().pending[0].clientId;
    r.event(saved); assert.equal(r.render().pending.length, 1); assert.equal(r.render().pending[0].clientId, remaining);
    const second = { ...saved, id: ROOM_QUERY_ID };
    r.event(second); assert.equal(r.render().pending.length, 0);
    responses[1](ok({ message: second, aiPending: false })); await settle();
    assert.equal(r.render().messages.length, 2); r.unmount();
});

test('118 훅 AI 3초 수신·id 중복 제거·화면 이탈 타이머 해제', async () => {
    const r = chat118Hook(); let items = []; let posts = 0;
    const question = chat118Message();
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') { posts++; items = [question]; return ok({ message: question, aiPending: true }); }
        return ok({ items, hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); r.render().setDraft(question.content); r.render().send(); r.render().send(); await settle();
    assert.equal(posts, 1); assert.equal(r.render().aiPending, 1);
    items = [chat118Message({ id: ROOM_QUERY_ID, senderType: 'AI', senderId: null, nickname: null, createdAt: '2026-11-12T10:00:03Z' }), question];
    r.advance(3000); await settle();
    assert.equal(r.render().aiPending, 0); assert.equal(r.render().messages.length, 2);
    assert.equal(r.timers.size, 0); r.unmount();
});

test('118 훅 재전송은 최신 조회로 저장된 동일 메시지를 확인하고 POST 중복을 막아요', async () => {
    const r = chat118Hook(); let saved; let posts = 0; let gets = 0;
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') {
            posts++; saved = chat118Message({ content: JSON.parse(options.body).content, createdAt: new Date(Date.now() + 1000).toISOString() });
            throw TypeError('응답 유실');
        }
        gets++; return ok({ items: saved ? [saved] : [], hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); r.render().setDraft('그대로 보낼 본문'); r.render().send(); await settle();
    const entry = r.render().pending[0]; assert.equal(entry.status, 'failed');
    r.render().retrySend(entry); r.render().retrySend(entry); await settle();
    assert.equal(posts, 1); assert.equal(gets, 2); assert.equal(r.render().pending.length, 0); assert.equal(r.render().messages.length, 1); r.unmount();
});

test('118 재전송은 폰보다 과거인 서버 시각이어도 새 ID의 동일 본문을 저장된 메시지로 판단해요', async () => {
    const r = chat118Hook(); let saved; let posts = 0;
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') {
            posts++;
            saved = chat118Message({ content: JSON.parse(options.body).content, createdAt: new Date(Date.now() - 3600_000).toISOString() });
            throw TypeError('저장 후 응답 유실');
        }
        return ok({ items: saved ? [saved] : [], hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); r.render().setDraft('시계가 달라도 중복 방지'); r.render().send(); await settle();
    const entry = r.render().pending[0];
    assert.ok(Date.parse(entry.createdAt) > Date.parse(saved.createdAt));
    r.render().retrySend(entry); await settle();
    assert.equal(posts, 1); assert.equal(r.render().pending.length, 0);
    assert.deepEqual(plain(r.render().messages), [saved]); r.unmount();
});

test('118 재전송 확인은 화면에 있던 ID·다른 작성자·다른 본문을 저장된 메시지로 오인하지 않아요', async () => {
    const r = chat118Hook(); let posts = 0;
    const old = chat118Message({ content: '같은 본문' });
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') {
            posts++;
            if (posts === 1) throw TypeError('전송 실패');
            return ok({ message: chat118Message({ id: ROOM_QUERY_ME, content: old.content }), aiPending: false });
        }
        return ok({ items: posts === 0 ? [old] : [old,
                chat118Message({ id: ROOM_QUERY_ID, senderId: ROOM_QUERY_OTHER, content: old.content }),
                chat118Message({ id: ROOM_QUERY_ID2, content: '다른 본문' })], hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); r.render().setDraft(old.content); r.render().send(); await settle();
    r.render().retrySend(r.render().pending[0]); await settle();
    await settle();
    assert.equal(posts, 2); assert.equal(r.render().pending.length, 0); r.unmount();
});

test('118 타임아웃 뒤 새로고침·화면 복귀로 저장된 메시지가 합쳐져도 재전송 POST를 추가하지 않아요', async () => {
    for (const returnToScreen of [false, true]) {
        const r = chat118Hook(); let saved; let posts = 0;
        r.context.fetch = async (_url, options) => {
            if (options.method === 'POST') {
                posts++;
                saved = chat118Message({ content: JSON.parse(options.body).content, createdAt: new Date(Date.now() - 3600_000).toISOString() });
                return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('timeout'))));
            }
            return ok({ items: saved ? [saved] : [], hasMore: false, nextCursor: null });
        };
        r.render(); await settle(); r.render().setDraft('서버에는 저장됐어요'); r.render().send(); await settle();
        r.advance(10_000); await settle(); assert.equal(r.render().pending[0].status, 'failed');
        if (returnToScreen) { r.blur(); r.focus(); await settle(); }
        else await r.render().reload();
        assert.equal(r.render().messages[0].id, saved.id);
        const entry = r.render().pending[0];
        r.render().retrySend(entry); await settle(); await settle();
        assert.equal(posts, 1); assert.equal(r.render().pending.length, 0);
        assert.deepEqual(plain(r.render().messages), [saved]); r.unmount();
    }
});

test('118 서버에 닿지 못한 전송은 화면 복귀 후 옛 동일 본문을 성공으로 오인하지 않고 POST를 재시도해요', async () => {
    const r = chat118Hook(); let posts = 0;
    const old = chat118Message({ id: ROOM_QUERY_ID, content: '같은 본문을 새로 보내요' });
    const items = [old];
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') {
            posts++;
            if (posts === 1) throw TypeError('서버에 도달하기 전 연결 실패');
            const message = chat118Message({ id: ROOM_QUERY_ID2, content: JSON.parse(options.body).content });
            items.unshift(message); return ok({ message, aiPending: false });
        }
        return ok({ items, hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); assert.equal(r.render().messages[0].id, old.id);
    r.render().setDraft(old.content); r.render().send(); await settle();
    const failed = r.render().pending[0]; assert.equal(failed.status, 'failed'); assert.equal(posts, 1);
    r.blur(); r.focus(); await settle();
    assert.deepEqual(plain(r.render().messages), [old]);
    assert.equal(r.render().pending[0].clientId, failed.clientId);
    r.render().retrySend(r.render().pending[0]); await settle(); await settle();
    assert.equal(posts, 2, '복귀 후 재시도는 POST를 정확히 한 번 더 보내야 해요');
    assert.equal(r.render().pending.length, 0);
    assert.deepEqual(new Set(r.render().messages.map(message => message.id)), new Set([old.id, ROOM_QUERY_ID2]));
    r.unmount();
});

test('118 의도적으로 같은 본문을 두 번 보내면 두 번째 기준의 첫 메시지를 저장 결과로 오인하지 않아요', async () => {
    const r = chat118Hook(); let posts = 0; const items = [];
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') {
            posts++;
            if (posts === 2) throw TypeError('두 번째 전송 실패: 서버 저장 안 됨');
            const message = chat118Message({ id: posts === 1 ? ROOM_QUERY_ID : ROOM_QUERY_ID2, content: JSON.parse(options.body).content });
            items.unshift(message); return ok({ message, aiPending: false });
        }
        return ok({ items, hasMore: false, nextCursor: null });
    };
    r.render(); await settle();
    r.render().setDraft('같은 내용을 다시 보냅니다'); r.render().send(); await settle(); await settle();
    assert.equal(r.render().messages.length, 1); assert.equal(r.render().pending.length, 0);
    r.render().setDraft('같은 내용을 다시 보냅니다'); r.render().send(); await settle();
    assert.equal(r.render().pending[0].status, 'failed');
    await r.render().reload();
    r.render().retrySend(r.render().pending[0]); await settle(); await settle();
    assert.equal(posts, 3); assert.equal(r.render().pending.length, 0);
    assert.equal(r.render().messages.length, 2);
    assert.equal(new Set(r.render().messages.map(message => message.id)).size, 2); r.unmount();
});

test('118 AI 재조회는 AI·링크로 닉네임 입장 안내를 무시하고 지정된 실패 안내만 감지해요', async () => {
    for (const failure of ['AI 사용 한도를 초과해 답변하지 못했어요.', 'AI가 답변을 만들지 못했어요. 다시 시도해 주세요.']) {
        const r = chat118Hook(); let items = [];
        r.context.fetch = async (_url, options) => ok(options.method === 'POST'
            ? { message: chat118Message(), aiPending: true } : { items, hasMore: false, nextCursor: null });
        r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
        items = [chat118Message({ id: ROOM_QUERY_ID, senderType: 'SYSTEM', senderId: null, nickname: null,
            content: 'AI링크로님이 참여했어요.', createdAt: '2026-11-12T10:00:03Z' })];
        r.advance(3000); await settle(); assert.equal(r.render().aiPending, 1);
        items.unshift(chat118Message({ id: ROOM_QUERY_ID2, senderType: 'SYSTEM', senderId: null, nickname: null,
            content: failure, createdAt: '2026-11-12T10:00:06Z' }));
        r.advance(3000); await settle(); assert.equal(r.render().aiPending, 0);
        assert.equal(r.timers.size, 0); r.unmount();
    }
});

test('118 목록 검증 오류는 조회 안내, 전송 검증 오류는 본문 규칙을 표시해요', async () => {
    const r = roomQueryRuntime(); const chat = r.load('src/services/chat.ts');
    r.respond(async () => recoFail('VALIDATION_ERROR', 400, { cursor: 'invalid' }));
    await assert.rejects(chat.fetchChatMessages(ROOM_QUERY_ID), error => error.code === 'VALIDATION_ERROR'
        && error.message === '대화를 불러오지 못했어요. 다시 시도해 주세요.');
    await assert.rejects(chat.sendChatMessage(ROOM_QUERY_ID, { content: '본문' }), error => error.code === 'VALIDATION_ERROR'
        && error.message.includes('1,000자'));
});

test('118 훅 AI 최대 60초·blur·계정 변경 뒤 재조회 중단', async () => {
    for (const stop of ['deadline', 'blur', 'account']) {
        const r = chat118Hook(); let calls = 0;
        r.context.fetch = async (_url, options) => {
            calls++;
            return ok(options.method === 'POST' ? { message: chat118Message(), aiPending: true } : { items: [], hasMore: false, nextCursor: null });
        };
        r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle(); assert.equal(r.render().aiPending, 1);
        if (stop === 'blur') r.blur();
        if (stop === 'account') r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '다른 계정' });
        const before = calls;
        for (let i = 0; i < 21; i++) { r.advance(3000); await settle(); }
        if (stop === 'deadline') { assert.equal(r.render().aiPending, 0); assert.equal(calls, before + 20); }
        else assert.equal(calls, before);
        r.unmount(); assert.equal(r.timers.size, 0);
    }
});

test('118 훅 타임아웃 재시도 전 조회 실패는 POST를 추가하지 않아요', async () => {
    const r = chat118Hook(); let posts = 0;
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') {
            posts++;
            return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('timeout'))));
        }
        return ok({ items: [], hasMore: false, nextCursor: null });
    };
    r.render(); await settle(); r.render().setDraft('시간 초과 테스트'); r.render().send(); await settle();
    r.advance(10_000); await settle(); const entry = r.render().pending[0]; assert.equal(entry.status, 'failed');
    r.context.fetch = async () => { throw TypeError('최신 조회 실패'); };
    r.render().retrySend(entry); await settle(); assert.equal(posts, 1); assert.equal(r.render().pending[0].status, 'failed'); r.unmount();
});

test('118 이전 화면·계정의 늦은 전송 결과는 목록에 추가하지 않아요', async () => {
    for (const stop of ['unmount', 'blur', 'account']) {
        const r = chat118Hook(); let resolve;
        r.context.fetch = async (_url, options) => options.method === 'POST' ? await new Promise(done => { resolve = done; }) : ok({ items: [], hasMore: false, nextCursor: null });
        r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
        if (stop === 'unmount') r.unmount();
        if (stop === 'blur') { r.blur(); r.focus(); await settle(); }
        if (stop === 'account') r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '다음' });
        resolve(ok({ message: chat118Message(), aiPending: true })); await settle();
        const view = r.render(); assert.equal(view.messages.length, 0); assert.equal(view.aiPending, 0); r.unmount();
    }
});
const ROOM_QUERY_OTHER = '22222222-2222-4222-8222-222222222222';
const ROOM_QUERY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROOM_QUERY_ID2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const roomQueryStation = (id = 88001) => ({ id, name: `서버 역 ${id}`, isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00a84d' }] });
function roomQuerySummary(overrides = {}) {
    return { id: ROOM_QUERY_ID, name: '서버 모임', status: 'OPEN', myRole: 'OWNER', memberCount: 2, maxMembers: 4, appointmentAt: '2026-11-20T19:00:00+09:00', selectedStation: null, ...overrides };
}
function roomQueryMembers(role = 'OWNER', me = ROOM_QUERY_ME) {
    return [
        { userId: me, nickname: '서버 나', role, joinedAt: '2026-11-10T09:00:00Z', departureStation: roomQueryStation() },
        { userId: ROOM_QUERY_OTHER, nickname: '서버 동료', role: role === 'OWNER' ? 'MEMBER' : 'OWNER', joinedAt: '2026-11-09T09:00:00Z', departureStation: null },
    ];
}
function roomQueryDetail(role = 'OWNER', me = ROOM_QUERY_ME) {
    const summary = roomQuerySummary({ myRole: role });
    delete summary.memberCount; // 실서버 7.4는 목록과 달리 memberCount를 보내지 않아요.
    return { ...summary, ownerId: role === 'OWNER' ? me : ROOM_QUERY_OTHER, confirmedAt: null, members: roomQueryMembers(role, me) };
}
function roomQueryRuntime() {
    const r = createRuntime(serverEnv);
    r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_ME, nickname: '서버 나' });
    r.room = r.load('src/services/room.ts');
    r.roomCache = r.load('src/services/room-cache.ts');
    r.calls = [];
    r.respond = handler => { r.context.fetch = async (url, options) => { r.calls.push({ url, options }); return handler(url, options); }; };
    return r;
}
/* ---------- 중간역 추천 서버 연동 (#99) ---------- */

const RECO_EXTRA = { boardingTrain: { trainNo: '2123', departAt: '2026-11-20T18:40:00+09:00' }, legs: [{ lineId: 2, minutes: 21 }], source: 'TIMETABLE', arriveAt: '2026-11-20T18:58:00+09:00', slackSeconds: 120 };
function recoParticipant(overrides = {}) {
    return {
        userId: ROOM_QUERY_ME, nickname: '서버 나', departureStation: { id: 88001, name: '서버 역 88001' },
        travelMinutes: 21, transferCount: 1, fareWon: 1650, distanceM: 9800, departureAt: '2026-11-20T18:39:00+09:00',
        congestion: { pct: 80, level: 'NORMAL', levelLabel: '보통' },
        segments: [{ lineId: 2, lineName: '2호선', color: '#00a84d', direction: 'INNER', fromStationName: '서버 역 88001', toStationName: '서버 추천역', stationCount: 5 }],
        ...RECO_EXTRA, ...overrides,
    };
}
function recoResult(criterion, stationId, overrides = {}) {
    return {
        resultId: `result-${criterion}`, criterion,
        recommendedStation: { id: stationId, name: `서버 추천역 ${stationId}`, latitude: 37.5, longitude: 127, isSupported: true },
        metrics: { averageMinutes: 20.5, maxDifferenceMinutes: 3, maxMinutes: 22, averageFare: 1650, totalTransfers: 1 },
        participantTimes: [
            recoParticipant(),
            recoParticipant({ userId: ROOM_QUERY_OTHER, nickname: '서버 동료', departureStation: { id: 99002, name: '서버 역 99002' }, congestion: null }),
        ],
        nearbyAlternatives: [{ station: { id: 77009, name: '서버 이웃역' }, lineId: 2, relation: 'PREV', relationLabel: '최적역에서 1정거장', maxMinutes: 24, totalFareWon: 3300 }],
        explanation: '서버가 만든 설명이에요.', explanationSource: 'AI', ...overrides,
    };
}
function recoRun(overrides = {}) {
    return {
        runId: 'server-run-1', createdAt: '2026-11-11T10:00:00+09:00', isStale: false, staleReasons: [], conditionText: null,
        appliedConstraints: { maxMinutes: null, maxTransfers: null, maxFareWon: null, excludeStationIds: [], memberLimits: [] },
        message: null, results: [recoResult('TIME', 77001), recoResult('FARE', 77002), recoResult('DISTANCE', 77001)], ...overrides,
    };
}
const recoStation = id => ({ id, name: `서버 추천역 ${id}`, latitude: 37.5, longitude: 127, isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00a84d', stationCode: String(id) }] });
const recoFail = (code, status, details) => jsonResponse({ success: false, error: { code, message: '서버 문구', ...(details ? { details } : {}) } }, status);
/** 방 상세·역 상세는 기본값으로 답하고, 추천 요청만 handler 로 넘겨요. */
function recoRuntime() {
    const r = roomQueryRuntime();
    r.recoRespond = (handler, detail = roomQueryDetail()) => r.respond(async (url, options) => {
        if (url.includes('/recommendations')) return handler(url, options);
        if (url.includes('/stations/')) return ok(recoStation(Number(url.split('/').at(-1))));
        return ok(detail);
    });
    return r;
}

async function finishRoomMock(r, pending) {
    let finished = false;
    pending.then(() => { finished = true; }, () => { finished = true; });
    for (let i = 0; i < 20 && !finished; i++) { r.advance(1000); await settle(); }
    assert.ok(finished, 'mock 처리가 시간 안에 끝나야 해요.');
    return await pending;
}

test('방 서버 조회 7.3·7.4·7.6 URL·인증·응답·정렬과 mock 플래그 무시', async () => {
    const r = roomQueryRuntime();
    r.load('src/services/api/client.ts').setAccessTokenProvider(() => 'test-access');
    const detail = roomQueryDetail();
    const unscheduled = roomQuerySummary({ id: ROOM_QUERY_ID2, appointmentAt: null });
    r.respond(async url => jsonResponse({ success: true, data: url.endsWith('/members') ? detail.members : url.endsWith(`/${ROOM_QUERY_ID}`) ? detail : [unscheduled, roomQuerySummary()] }));
    const rooms = await r.room.fetchMyRooms('empty');
    assert.deepEqual(plain(rooms.map(room => room.id)), [ROOM_QUERY_ID, ROOM_QUERY_ID2]);
    assert.deepEqual(plain(await r.room.fetchRoomDetail(ROOM_QUERY_ID, 'error')), { ...detail, memberCount: detail.members.length });
    assert.deepEqual(plain(await r.room.fetchRoomMembers(ROOM_QUERY_ID)), detail.members);
    assert.deepEqual(r.calls.map(call => call.url), [
        'https://example.test/api/v1/rooms', `https://example.test/api/v1/rooms/${ROOM_QUERY_ID}`, `https://example.test/api/v1/rooms/${ROOM_QUERY_ID}/members`,
    ]);
    assert.ok(r.calls.every(call => call.options.method === 'GET' && call.options.headers.Authorization === 'Bearer test-access' && call.options.body === undefined));
    assert.equal(r.room.getMyUserId(), ROOM_QUERY_ME);
    assert.equal(r.room.getMockRoom('room-1'), undefined);
    assert.deepEqual(plain(r.room.getMockMembers('room-1')), []);
});

test('방 상세는 실서버의 memberCount 없는 1인 응답을 표시용 인원수로 정리해요', async () => {
    const r = roomQueryRuntime();
    const detail = roomQueryDetail();
    detail.appointmentAt = null;
    detail.members = [{ ...detail.members[0], joinedAt: '2026-11-11T11:04:52.666533Z', departureStation: null }];
    assert.equal(Object.hasOwn(detail, 'memberCount'), false);
    r.respond(async () => jsonResponse({ data: detail, success: true }));
    const response = await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    assert.deepEqual(plain(response), { ...detail, memberCount: 1 });
    assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).memberCount, 1);
    assert.deepEqual(plain(r.room.getMockMembers(ROOM_QUERY_ID)), detail.members);
    assert.equal(r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID).memberCount, 1);
    // 이후 서버가 일치하는 memberCount를 함께 보내도 정상 처리해요.
    r.respond(async () => jsonResponse({ data: { ...detail, memberCount: 1 }, success: true }));
    assert.deepEqual(plain(await r.room.fetchRoomDetail(ROOM_QUERY_ID)), plain(response));
});

test('방 캐시는 상세·멤버·목록을 공유하고 반환값 변경으로 원본이 바뀌지 않아요', async () => {
    const r = roomQueryRuntime(); const detail = roomQueryDetail();
    detail.selectedStation = roomQueryStation(99002); detail.status = 'CONFIRMED'; detail.confirmedAt = '2026-11-11T08:00:00Z';
    let members = detail.members;
    r.respond(async url => jsonResponse({ success: true, data: url.endsWith('/members') ? members : detail }));
    const response = await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    assert.deepEqual(plain(r.room.getMockMembers(ROOM_QUERY_ID)), detail.members);
    assert.deepEqual(plain(r.room.getMockRoom(ROOM_QUERY_ID).selectedStation), detail.selectedStation);
    response.members[0].nickname = '반환값 변경'; response.selectedStation.lines[0].color = 'wrong';
    assert.equal(Object.hasOwn(r.room.getMockRoom(ROOM_QUERY_ID), 'members'), false);
    const cached = r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID);
    assert.equal(cached.members[0].nickname, '서버 나'); assert.equal(cached.selectedStation.lines[0].color, '#00a84d');
    cached.members[0].departureStation.lines[0].color = 'also wrong';
    assert.equal(r.room.getMockMembers(ROOM_QUERY_ID)[0].departureStation.lines[0].color, '#00a84d');
    members = roomQueryMembers('MEMBER'); members[0].departureStation = null;
    await r.room.fetchRoomMembers(ROOM_QUERY_ID);
    assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).myRole, 'MEMBER');
    assert.equal(r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID).ownerId, ROOM_QUERY_OTHER);
    assert.equal(r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID).members[0].departureStation, null);
});

test('멤버만 먼저 조회해도 캐시에 보관하고 가짜 방 목록은 만들지 않아요', async () => {
    const r = roomQueryRuntime();
    r.respond(async () => jsonResponse({ success: true, data: roomQueryMembers() }));
    await r.room.fetchRoomMembers(ROOM_QUERY_ID);
    assert.deepEqual(plain(r.room.getMockMembers(ROOM_QUERY_ID)), roomQueryMembers());
    assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined);
    assert.deepEqual(plain(r.roomCache.readCachedRooms()), []);
});

test('실제 빈 목록과 삭제·권한 상실은 이전 방 캐시를 제거해요', async () => {
    const r = roomQueryRuntime();
    r.respond(async url => jsonResponse({ success: true, data: url.endsWith('/rooms') ? [roomQuerySummary()] : roomQueryDetail() }));
    await r.room.fetchMyRooms(); await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    r.respond(async () => jsonResponse({ success: true, data: [] }));
    assert.deepEqual(plain(await r.room.fetchMyRooms()), []);
    assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined); assert.deepEqual(plain(r.room.getMockMembers(ROOM_QUERY_ID)), []);
    for (const [code, status] of [['ROOM_NOT_FOUND', 404], ['NOT_ROOM_MEMBER', 403]]) {
        r.respond(async () => jsonResponse({ success: true, data: roomQueryDetail() })); await r.room.fetchRoomDetail(ROOM_QUERY_ID);
        r.respond(async () => jsonResponse({ success: false, error: { code } }, status));
        await assert.rejects(r.room.fetchRoomMembers(ROOM_QUERY_ID), { code });
        assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined);
    }
});

test('Refresh Token 복원의 null 사용자 ID는 내 정보 API로 한 번 확인하고 동시 상세 조회를 공유해요', async () => {
    const r = roomQueryRuntime();
    r.load('src/stores/auth-store.ts').signIn({ userId: null, nickname: null });
    let resolveProfile;
    r.respond(async url => {
        if (url.endsWith('/users/me')) return await new Promise(resolve => { resolveProfile = resolve; });
        return jsonResponse({ success: true, data: url.endsWith('/rooms') ? [roomQuerySummary()] : roomQueryDetail() });
    });
    const all = Promise.all([r.room.fetchMyRooms(), r.room.fetchRoomDetail(ROOM_QUERY_ID), r.room.fetchRoomDetail(ROOM_QUERY_ID)]);
    await settle();
    assert.equal(r.calls.length, 1);
    resolveProfile(jsonResponse({ success: true, data: { id: ROOM_QUERY_ME, nickname: '서버 나', createdAt: '2026-11-01T09:00:00Z' } }));
    await all;
    assert.equal(r.calls.filter(call => call.url.endsWith('/users/me')).length, 1);
    assert.equal(r.calls.filter(call => call.url.endsWith(`/${ROOM_QUERY_ID}`)).length, 1);
    assert.equal(r.room.getMyUserId(), ROOM_QUERY_ME);
});

test('방 조회의 잘못된 응답은 UNKNOWN_ERROR이고 기존 캐시를 오염시키지 않아요', async () => {
    const r = roomQueryRuntime(); let current = roomQueryDetail();
    r.respond(async () => jsonResponse({ success: true, data: current }));
    await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const mutations = [];
    const missing = (select, fields) => fields.forEach(field => mutations.push(value => { delete select(value)[field]; }));
    missing(value => value, ['id', 'name', 'status', 'myRole', 'maxMembers', 'appointmentAt', 'selectedStation', 'ownerId', 'confirmedAt', 'members']);
    missing(value => value.members[0], ['userId', 'nickname', 'role', 'joinedAt', 'departureStation']);
    missing(value => value.members[0].departureStation, ['id', 'name', 'isSupported', 'lines']);
    mutations.push(value => { value.id = 'room-1'; }, value => { value.ownerId = ROOM_QUERY_OTHER; },
        value => { value.myRole = 'MEMBER'; }, value => { value.memberCount = '2'; }, value => { value.memberCount = null; },
        value => { value.memberCount = 1; }, value => { value.memberCount = 3; }, value => { value.status = 'OTHER'; },
        value => { value.appointmentAt = 'invalid'; }, value => { value.members[0].departureStation.lines[0].lineId = '2'; },
        value => { value.members[1].userId = value.members[0].userId; }, value => { value.members = []; });
    for (const mutate of mutations) {
        current = roomQueryDetail(); mutate(current);
        await assert.rejects(r.room.fetchRoomDetail(ROOM_QUERY_ID), error => error instanceof r.load('src/types/room.ts').RoomError && error.code === 'UNKNOWN_ERROR');
        assert.equal(r.room.getMockMembers(ROOM_QUERY_ID)[0].nickname, '서버 나');
    }
    const missingCount = roomQuerySummary(); delete missingCount.memberCount;
    for (const bad of [{ items: [] }, [missingCount], [roomQuerySummary({ id: 12 })], [roomQuerySummary({ memberCount: '2' })], [roomQuerySummary(), roomQuerySummary()]]) {
        current = bad;
        await assert.rejects(r.room.fetchMyRooms(), { code: 'UNKNOWN_ERROR' });
    }
});

test('방 조회 오류의 404·403·네트워크·401·그 밖의 코드 매핑', async () => {
    for (const [code, status, expected] of [['ROOM_NOT_FOUND', 404, 'ROOM_NOT_FOUND'], ['NOT_ROOM_MEMBER', 403, 'NOT_ROOM_MEMBER'],
        ['VALIDATION_ERROR', 400, 'VALIDATION_ERROR'], ['ROOM_BUSY', 409, 'ROOM_BUSY'], ['EXTERNAL_API_ERROR', 502, 'UNKNOWN_ERROR'],
        ['TOKEN_EXPIRED', 401, 'TOKEN_EXPIRED'], ['TOKEN_INVALID', 401, 'TOKEN_INVALID'], ['TOKEN_FUTURE', 401, 'TOKEN_FUTURE']]) {
        const r = roomQueryRuntime();
        // 이 검사는 오류 변환만 확인하고, A-1 갱신 연동은 아래 별도 검사에서 확인해요.
        r.load('src/services/api/client.ts').setTokenRefresher(null);
        r.respond(async () => jsonResponse({ success: false, error: { code } }, status));
        await assert.rejects(r.room.fetchRoomDetail(ROOM_QUERY_ID), error => error.code === expected
            && (status !== 401 || error instanceof r.load('src/services/api/errors.ts').ApiError));
        assert.equal(r.calls.length, 1);
    }
    const r = roomQueryRuntime(); r.respond(async () => { throw Error(); });
    await assert.rejects(r.room.fetchMyRooms(), { code: 'NETWORK_ERROR' });
});

test('방 조회 시간 초과도 기존 10초를 유지하고 재시도하지 않아요', async () => {
    const r = roomQueryRuntime();
    r.respond((_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error()))));
    const pending = r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const rejected = assert.rejects(pending, { code: 'NETWORK_ERROR' });
    await settle(); assert.equal([...r.timers.values()][0].ms, 10000);
    r.advance(10000); await rejected;
    assert.equal(r.calls.length, 1); assert.equal(r.timers.size, 0);
});

test('계정 변경·로그아웃 뒤 이전 응답은 방 캐시를 되살리거나 다른 계정 캐시를 지우지 않아요', async () => {
    for (const denied of [false, true]) {
        const r = roomQueryRuntime(); let resolveOld;
        r.respond(() => new Promise(resolve => { resolveOld = resolve; }));
        const old = r.room.fetchRoomDetail(ROOM_QUERY_ID);
        const rejected = assert.rejects(old, { code: 'AUTH_REQUIRED' }); await settle();
        await r.load('src/services/auth.ts').clearLocalSession();
        assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined);
        const nextUser = '33333333-3333-4333-8333-333333333333';
        r.load('src/stores/auth-store.ts').signIn({ userId: nextUser, nickname: '다음 사용자' });
        const latest = roomQueryDetail('OWNER', nextUser); latest.name = '다음 계정 방';
        r.respond(async () => jsonResponse({ success: true, data: latest }));
        await r.room.fetchRoomDetail(ROOM_QUERY_ID);
        resolveOld(denied ? jsonResponse({ success: false, error: { code: 'NOT_ROOM_MEMBER' } }, 403) : jsonResponse({ success: true, data: roomQueryDetail() }));
        await rejected;
        assert.equal(r.room.getMyUserId(), nextUser); assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).name, '다음 계정 방');
    }
});

test('기존 방 mock 목록·상세·멤버·오류·생성·나가기 흐름은 서버 호출 없이 유지해요', async () => {
    const r = createRuntime(); const room = r.load('src/services/room.ts'); let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    const list = await finishRoomMock(r, room.fetchMyRooms()); assert.equal(list.length, 4); assert.equal(list.at(-1).appointmentAt, null);
    assert.deepEqual(plain(await finishRoomMock(r, room.fetchMyRooms('empty'))), []);
    const failed = room.fetchMyRooms('error'); const rejected = assert.rejects(failed, { code: 'NETWORK_ERROR' }); await finishRoomMock(r, rejected);
    const detail = await finishRoomMock(r, room.fetchRoomDetail('room-4'));
    assert.equal(detail.myRole, 'OWNER'); assert.equal(detail.members.length, 2);
    assert.deepEqual(plain(await finishRoomMock(r, room.fetchRoomMembers('room-4'))), plain(detail.members));
    const created = await finishRoomMock(r, room.createRoom({ name: '새 mock 방', appointmentAt: null }));
    assert.equal(room.getMockRoom(created.id).name, '새 mock 방');
    assert.equal((await finishRoomMock(r, room.leaveRoom(created.id))).roomDeleted, true);
    assert.equal(room.getMockRoom(created.id), undefined); assert.equal(calls, 0);
});

test('서버 방 채팅은 REST를 호출하고 mock 대화를 만들지 않아요', async () => {
    const r = roomQueryRuntime();
    r.respond(async url => jsonResponse({ success: true, data: url.includes('/stations/')
            ? { ...roomQueryStation(), latitude: 37.5, longitude: 127, lines: [{ ...roomQueryStation().lines[0], stationCode: 'S1' }] }
            : roomQueryDetail() }));
    await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const message = chat118Message();
    r.respond(async (_url, options) => ok(options.method === 'POST' ? { message, aiPending: false } : { items: [message], nextCursor: null, hasMore: false }));
    const chat = r.load('src/services/chat.ts');
    const sent = await chat.sendChatMessage(ROOM_QUERY_ID, { content: message.content });
    assert.equal(sent.message.senderId, ROOM_QUERY_ME); assert.equal(sent.message.nickname, '서버 나');
    const listed = await chat.fetchChatMessages(ROOM_QUERY_ID);
    assert.deepEqual(plain(listed.items), [message]);
    assert.deepEqual(r.calls.map(call => call.options.method), ['GET', 'POST', 'GET']);
});

test('서버 방 추천은 mock 계산·mock 역 목록 없이 서버 8.1·8.2 결과의 서버 역 ID를 그대로 써요', async () => {
    const r = recoRuntime(); const detail = roomQueryDetail(); detail.members[1].departureStation = roomQueryStation(99002);
    r.recoRespond(async url => (url.endsWith('/latest') ? ok(null) : ok(recoRun())), detail);
    await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const reco = r.load('src/services/recommendation.ts');
    assert.equal(await reco.fetchLatestRecommendation(ROOM_QUERY_ID), null);
    const run = await reco.createRecommendation(ROOM_QUERY_ID, {});
    assert.deepEqual(plain(run.results.map(item => item.recommendedStation.id)), [77001, 77002, 77001]);
    const mockIds = new Set(r.load('src/mocks/stations.ts').MOCK_STATIONS.map(station => station.id));
    assert.ok(run.results.every(item => !mockIds.has(item.recommendedStation.id)));
    assert.deepEqual(plain(run.results[0].participantTimes.map(member => member.departureStation.id)), [88001, 99002]);
    // 출발역 상세는 부르지 않고, 추천역 노선 배지용 역 상세만 불러요.
    assert.deepEqual(r.calls.filter(call => call.url.includes('/stations/')).map(call => call.url.split('/').at(-1)).sort(), ['77001', '77002']);
});

function roomQueryScreen(screenPath = 'src/app/rooms/index.tsx', params = {}) {
    const r = createScreenRuntime(serverEnv, screenPath, runtime => {
        runtime.external['expo-clipboard'] = { setStringAsync: async () => {} };
    });
    r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_ME, nickname: '서버 나' });
    // Screen fixtures have no socket/token transport; hook tests replace these callbacks explicitly.
    const realtime = r.load('src/services/realtime.ts');
    realtime.subscribeRoomEvents = () => () => {};
    realtime.subscribeRealtimeState = () => () => {};
    realtime.getRealtimeState = () => 'closed';
    r.external['expo-router'].useLocalSearchParams = () => params;
    r.external.react.useCallback = (callback, dependencies) => {
        const ref = r.external.react.useRef(null);
        if (!ref.current || dependencies.some((value, index) => value !== ref.current.dependencies[index])) ref.current = { callback, dependencies };
        return ref.current.callback;
    };
    r.external['expo-router'].useFocusEffect = callback => r.external.react.useEffect(callback, [callback]);
    r.native.ScrollView = 'ScrollView';
    return r;
}

test('서버 방 목록 화면의 로딩·빈 목록·실패·재시도·실제 방 표시', async () => {
    const r = roomQueryScreen(); let outcome = 'empty';
    r.context.fetch = async () => {
        if (outcome === 'error') throw Error();
        return jsonResponse({ success: true, data: outcome === 'empty' ? [] : [roomQuerySummary()] });
    };
    assert.ok(findElement(r.render(), element => element.type === 'ActivityIndicator'));
    await settle(); let view = r.render();
    assert.ok(findElement(view, element => element.props?.children === '참여 중인 약속방이 없어요'));
    outcome = 'error';
    // 새 화면 진입은 별도 runtime으로 확인해요.
    r.unmount();
    const failed = roomQueryScreen(); failed.context.fetch = async () => { throw Error(); };
    failed.render(); await settle(); view = failed.render();
    assert.ok(findElement(view, element => element.props?.children === '약속방 목록을 불러오지 못했어요'));
    const retry = findElement(view, element => element.type === 'Pressable' && findElement(element.props.children, child => child.props?.children === '다시 시도'));
    failed.context.fetch = async () => jsonResponse({ success: true, data: [roomQuerySummary()] });
    retry.props.onPress(); await settle(); view = failed.render();
    assert.ok(findElement(view, element => element.props?.room?.id === ROOM_QUERY_ID));
    failed.unmount();
});

test('서버 방 상세는 서버의 내 카드·방장 권한·출발역을 사용해요', async () => {
    for (const role of ['OWNER', 'MEMBER']) {
        const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID });
        r.context.fetch = async () => jsonResponse({ success: true, data: roomQueryDetail(role) });
        r.render(); await settle(); r.advance(1000); await settle(); const view = r.render();
        assert.ok(findElement(view, element => element.props?.children === (role === 'OWNER' ? '내 역할 · 방장' : '내 역할 · 멤버')));
        assert.ok(findElement(view, element => element.props?.children === '나'));
        assert.ok(findElement(view, element => element.props?.accessibilityLabel === '내 출발역 변경'));
        const header = findElement(view, element => element.props?.topInset !== undefined && element.props?.onBack);
        assert.equal(!!findElement(header.props.right, element => element.props?.accessibilityLabel?.startsWith('초대 코드 ')), role === 'OWNER');
        assert.ok(findElement(view, element => element.props?.myUserId === ROOM_QUERY_ME));
        r.unmount();
    }
});

test('서버 방 상세의 403·404 안내와 인증 오류 중복 안내 없음', async () => {
    for (const [code, status] of [['ROOM_NOT_FOUND', 404], ['NOT_ROOM_MEMBER', 403], ['TOKEN_INVALID', 401]]) {
        const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID });
        r.context.fetch = async () => jsonResponse({ success: false, error: { code } }, status);
        r.render(); await settle(); const view = r.render();
        const error = findElement(view, element => element.props?.error === code);
        assert.equal(!!error, status !== 401);
        r.unmount();
    }
});

test('방 조회도 A-1의 토큰 갱신을 사용하고 갱신 후 서버 방을 정상 캐시해요', async () => {
    const r = roomQueryRuntime();
    await r.load('src/services/token-storage.ts').saveTokens('old-access', 'old-refresh', () => true);
    r.respond(async (url, options) => {
        if (url.endsWith('/auth/refresh')) return jsonResponse({ success: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh', accessTokenExpiresIn: 1800 } });
        if (options.headers.Authorization === 'Bearer old-access') return jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED' } }, 401);
        return jsonResponse({ success: true, data: roomQueryDetail() });
    });
    const detail = await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    assert.equal(detail.id, ROOM_QUERY_ID);
    assert.equal(r.calls.filter(call => call.url.endsWith('/auth/refresh')).length, 1);
    assert.equal(r.calls.filter(call => call.url.endsWith(`/${ROOM_QUERY_ID}`)).length, 2);
    assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).name, '서버 모임');
});

test('멤버 조회 다음 목록 조회도 마지막 멤버 정보와 방장 역할을 유지해요', async () => {
    const r = roomQueryRuntime();
    r.respond(async url => jsonResponse({ success: true, data: url.endsWith('/members') ? roomQueryMembers() : [roomQuerySummary()] }));
    await r.room.fetchRoomMembers(ROOM_QUERY_ID); await r.room.fetchMyRooms();
    assert.deepEqual(plain(r.room.getMockMembers(ROOM_QUERY_ID)), roomQueryMembers());
    assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).myRole, 'OWNER');
});

test('계정 변경 뒤 임시 채팅은 이전 사용자의 상태를 재사용하지 않아요(후보는 서버 검사에서 확인)', async () => {
    const r = roomQueryRuntime(); let me = ROOM_QUERY_ME;
    r.respond(async url => jsonResponse({ success: true, data: url.includes('/stations/')
            ? { ...roomQueryStation(), latitude: 37.5, longitude: 127, lines: [{ ...roomQueryStation().lines[0], stationCode: 'S1' }] }
            : roomQueryDetail('OWNER', me) }));
    await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const chat = r.load('src/services/chat.ts');
    let resolve;
    r.respond(() => new Promise(done => { resolve = done; }));
    const pending = chat.fetchChatMessages(ROOM_QUERY_ID);
    const rejected = assert.rejects(pending, { code: 'AUTH_REQUIRED' });
    await settle();
    await r.load('src/services/auth.ts').clearLocalSession();
    me = '33333333-3333-4333-8333-333333333333';
    r.load('src/stores/auth-store.ts').signIn({ userId: me, nickname: '다음 사용자' });
    resolve(ok({ items: [chat118Message()], nextCursor: null, hasMore: false }));
    await rejected;
    r.respond(async url => ok(url.includes('/messages') ? { items: [], nextCursor: null, hasMore: false } : roomQueryDetail('OWNER', me)));
    await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const messages = await finishRoomMock(r, chat.fetchChatMessages(ROOM_QUERY_ID));
    assert.ok(!messages.items.some(message => message.content === '이전 계정 임시 메시지'));
});

test('목록의 늦은 응답은 화면 이탈 후 목록 UI를 바꾸지 않아요', async () => {
    const r = roomQueryScreen(); let resolve;
    r.context.fetch = () => new Promise(done => { resolve = done; });
    r.render(); await settle(); r.unmount();
    resolve(jsonResponse({ success: true, data: [roomQuerySummary()] })); await settle();
    assert.equal(findElement(r.render(), element => element.props?.room?.id === ROOM_QUERY_ID), null);
});

test('이전 방의 늦은 상세 응답은 새 방 화면을 덮지 않아요', async () => {
    const params = { roomId: ROOM_QUERY_ID };
    const r = roomQueryScreen('src/app/rooms/[roomId].tsx', params); let resolve;
    r.context.fetch = async url => {
        if (url.endsWith(`/${ROOM_QUERY_ID}`)) return await new Promise(done => { resolve = done; });
        return jsonResponse({ success: true, data: { ...roomQueryDetail(), id: ROOM_QUERY_ID2, name: '두 번째 방' } });
    };
    r.render(); await settle(); params.roomId = ROOM_QUERY_ID2;
    r.render(); await settle();
    resolve(jsonResponse({ success: true, data: roomQueryDetail() })); await settle();
    const view = r.render();
    assert.ok(findElement(view, element => element.props?.children === '두 번째 방'));
    assert.equal(findElement(view, element => element.props?.children === '서버 모임'), null);
    r.unmount();
});

const createdRoomData = (overrides = {}) => ({
    id: ROOM_QUERY_ID, roomCode: 'A3K9PZ', name: '서버가 저장한 모임', maxMembers: 4, status: 'OPEN',
    ownerId: ROOM_QUERY_ME, appointmentAt: null, ...overrides,
});
const roomWriteButton = (view, label) => findElement(view, element => element.type === 'Pressable'
    && findElement(element.props.children, child => child.type === 'Text' && child.props?.children === label));

test('방 생성 서버 요청·인증·이름 정리·시각 null과 생성 응답의 세 필드·목록 캐시', async () => {
    const r = roomQueryRuntime();
    r.load('src/services/api/client.ts').setAccessTokenProvider(() => 'test-access');
    r.respond(async () => jsonResponse({ success: true, data: [roomQuerySummary({ id: ROOM_QUERY_ID2 })] }));
    await r.room.fetchMyRooms(); r.calls.length = 0;
    for (const appointmentAt of [null, '2026-11-20T19:00:00+09:00', '2026-11-20T10:00:00.123456Z']) {
        const raw = createdRoomData({ appointmentAt });
        r.respond(async () => jsonResponse({ success: true, data: raw }, 201));
        const created = await r.room.createRoom({ name: '  새 모임  ', appointmentAt, maxMembers: 9 }, true);
        assert.deepEqual(plain(created), { ...raw, myRole: 'OWNER', memberCount: 1, selectedStation: null });
        const call = r.calls.at(-1);
        assert.equal(call.url, 'https://example.test/api/v1/rooms');
        assert.equal(call.options.method, 'POST');
        assert.equal(call.options.headers.Authorization, 'Bearer test-access');
        assert.deepEqual(JSON.parse(call.options.body), { name: '새 모임', appointmentAt });
        assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).name, raw.name);
        assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).memberCount, 1);
        assert.deepEqual(plain(r.room.getMockMembers(ROOM_QUERY_ID)), []); // joinedAt은 발명하지 않아요.
        assert.deepEqual(plain(await r.room.fetchInviteCode(ROOM_QUERY_ID)), { roomCode: raw.roomCode });
    }
    assert.equal(r.calls.filter(call => call.options.method === 'POST').length, 3);
    assert.equal(r.calls.filter(call => call.url.endsWith('/invite-code')).length, 3); // #106부터 실제 7.9로 현재 코드를 확인해요.
    assert.deepEqual(new Set(r.roomCache.readCachedRooms().map(room => room.id)), new Set([ROOM_QUERY_ID2, ROOM_QUERY_ID]));
    assert.equal(Object.hasOwn(r.roomCache.readCachedRooms()[1], 'roomCode'), false);
});

test('방 생성 입력은 코드 포인트 1~30자·문자열·시간대를 검사하고 잘못된 요청은 전송하지 않아요', async () => {
    const r = roomQueryRuntime();
    r.respond(async () => jsonResponse({ success: true, data: createdRoomData() }, 201));
    for (const name of ['', '   ', '😀'.repeat(31), null, 123]) {
        await assert.rejects(r.room.createRoom({ name, appointmentAt: null }), { code: 'VALIDATION_ERROR' });
    }
    for (const appointmentAt of ['2026-11-20T19:00:00', 'not-a-date', 12, '2026-11-20T25:00:00Z']) {
        await assert.rejects(r.room.createRoom({ name: '모임', appointmentAt }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(r.calls.length, 0);
    for (const name of ['😀', '😀'.repeat(30)]) {
        await r.room.createRoom({ name, appointmentAt: null });
        assert.equal(JSON.parse(r.calls.at(-1).options.body).name, name);
    }
    await r.room.createRoom({ name: '시각 생략' });
    assert.equal(JSON.parse(r.calls.at(-1).options.body).appointmentAt, null);
});

test('방 생성 필수 응답 누락·잘못된 타입은 UNKNOWN_ERROR이며 가짜 방·초대 코드를 캐시하지 않아요', async () => {
    const mutations = Object.keys(createdRoomData()).map(key => data => { delete data[key]; });
    mutations.push(data => { data.id = 'room-1'; }, data => { data.ownerId = ROOM_QUERY_OTHER; },
        data => { data.name = ''; }, data => { data.name = 1; }, data => { data.name = 'a'.repeat(31); },
        data => { data.maxMembers = '4'; }, data => { data.maxMembers = 5; }, data => { data.status = 'OTHER'; },
        data => { data.roomCode = 'a3k9pz'; }, data => { data.roomCode = 'A3K9PZ7'; },
        data => { data.appointmentAt = '2026-11-20T19:00:00'; });
    for (const mutate of mutations) {
        const r = roomQueryRuntime(); const data = createdRoomData(); mutate(data);
        r.respond(async () => jsonResponse({ success: true, data }, 201));
        await assert.rejects(r.room.createRoom({ name: '새 방', appointmentAt: null }), { code: 'UNKNOWN_ERROR' });
        assert.equal(r.calls.length, 1); assert.deepEqual(plain(r.roomCache.readCachedRooms()), []);
        assert.equal(r.roomCache.findCachedRoomIdByCode('A3K9PZ'), undefined);
    }
});

test('방 참여는 코드 앞뒤 공백·소문자를 정리하고 실제 상세와 2명 멤버로 캐시를 갱신해요', async () => {
    const r = roomQueryRuntime(); const detail = roomQueryDetail('MEMBER');
    r.respond(async (_url, options) => jsonResponse({ success: true, data: options.method === 'POST' ? { roomId: ROOM_QUERY_ID } : detail }));
    assert.deepEqual(plain(await r.room.joinRoom('  a3k9pz \n')), { roomId: ROOM_QUERY_ID });
    assert.equal(r.calls[0].url, 'https://example.test/api/v1/rooms/join');
    assert.deepEqual(JSON.parse(r.calls[0].options.body), { roomCode: 'A3K9PZ' });
    assert.equal(r.calls[1].url, `https://example.test/api/v1/rooms/${ROOM_QUERY_ID}`);
    assert.equal(r.calls[1].options.method, 'GET');
    assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).myRole, 'MEMBER');
    assert.equal(r.roomCache.readCachedRooms()[0].memberCount, 2);
    assert.deepEqual(plain(r.room.getMockMembers(ROOM_QUERY_ID)), detail.members);
    assert.equal(r.roomCache.readCachedRoomCode(ROOM_QUERY_ID), undefined);
});

test('방 참여의 형식 오류는 요청 전에 거절하고 잘못된 roomId 응답으로 조회하지 않아요', async () => {
    const r = roomQueryRuntime();
    for (const code of ['', 'A3K9P', 'A3K9PZ7', 'a3 k9pz', 'a3k9p!', null, 123456]) {
        await assert.rejects(r.room.joinRoom(code), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(r.calls.length, 0);
    for (const data of [null, {}, { roomId: 'room-1' }, { roomId: 12 }, []]) {
        r.calls.length = 0;
        r.respond(async () => jsonResponse({ success: true, data }));
        await assert.rejects(r.room.joinRoom('a3k9pz'), { code: 'UNKNOWN_ERROR' });
        assert.equal(r.calls.length, 1); assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined);
    }
});

test('생성·참여 오류 404·409·400은 RoomError, TOKEN 계열은 원본 인증 오류로 전달해요', async () => {
    for (const operation of ['create', 'join']) {
        for (const [code, status] of [['ROOM_CODE_INVALID', 404], ['ROOM_FULL', 409], ['ALREADY_JOINED', 409], ['ROOM_BUSY', 409],
            ['VALIDATION_ERROR', 400], ['TOKEN_EXPIRED', 401], ['TOKEN_INVALID', 401], ['TOKEN_FUTURE', 401], ['INTERNAL_ERROR', 500]]) {
            const r = roomQueryRuntime();
            r.load('src/services/api/client.ts').setTokenRefresher(null);
            r.respond(async () => jsonResponse({ success: false, error: { code, details: {} } }, status));
            const pending = operation === 'create' ? r.room.createRoom({ name: '모임', appointmentAt: null }) : r.room.joinRoom('A3K9PZ');
            await assert.rejects(pending, error => error.code === (status === 500 ? 'UNKNOWN_ERROR' : code)
                && (status !== 401 || error instanceof r.load('src/services/api/errors.ts').ApiError));
            assert.equal(r.calls.length, 1); assert.deepEqual(plain(r.roomCache.readCachedRooms()), []);
        }
    }
});

test('참여 POST가 성공한 뒤 상세 조회만 실패하면 성공 roomId를 유지하고 POST를 재전송하지 않아요', async () => {
    for (const outcome of ['network', 'ROOM_NOT_FOUND', 'NOT_ROOM_MEMBER', 'invalid']) {
        const r = roomQueryRuntime();
        r.respond(async (_url, options) => {
            if (options.method === 'POST') return jsonResponse({ success: true, data: { roomId: ROOM_QUERY_ID } });
            if (outcome === 'network') throw Error();
            return outcome === 'invalid' ? jsonResponse({ success: true, data: {} })
                : jsonResponse({ success: false, error: { code: outcome } }, outcome === 'ROOM_NOT_FOUND' ? 404 : 403);
        });
        assert.deepEqual(plain(await r.room.joinRoom('a3k9pz')), { roomId: ROOM_QUERY_ID });
        assert.equal(r.calls.filter(call => call.options.method === 'POST').length, 1);
        assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined);
    }
});

test('이미 참여한 코드는 오류를 유지하며 확인된 방 ID만 제공하고 모르는 코드는 ID를 만들지 않아요', async () => {
    for (const known of [false, true]) {
        const r = roomQueryRuntime();
        if (known) {
            r.respond(async () => jsonResponse({ success: true, data: createdRoomData() }, 201));
            await r.room.createRoom({ name: '모임', appointmentAt: null });
        }
        r.respond(async () => jsonResponse({ success: false, error: { code: 'ALREADY_JOINED', details: {} } }, 409));
        await assert.rejects(r.room.joinRoom('a3k9pz'), error => error.code === 'ALREADY_JOINED' && error.roomId === (known ? ROOM_QUERY_ID : undefined));
    }
});

test('생성·참여의 네트워크·10초 초과는 NETWORK_ERROR이며 별도 재시도하지 않아요', async () => {
    for (const operation of ['create', 'join']) {
        for (const timeout of [false, true]) {
            const r = roomQueryRuntime();
            r.respond((_url, options) => timeout
                ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error())))
                : Promise.reject(Error()));
            const pending = operation === 'create' ? r.room.createRoom({ name: '모임', appointmentAt: null }) : r.room.joinRoom('A3K9PZ');
            const rejected = assert.rejects(pending, { code: 'NETWORK_ERROR' });
            await settle();
            if (timeout) { assert.equal([...r.timers.values()][0].ms, 10000); r.advance(10000); }
            await rejected; assert.equal(r.calls.length, 1); assert.equal(r.timers.size, 0);
        }
    }
});

test('계정이 바뀐 뒤 늦은 생성·참여 성공 또는 실패로 이전 방·코드를 재사용하지 않아요', async () => {
    for (const operation of ['create', 'join']) {
        for (const fail of [false, true]) {
            const r = roomQueryRuntime(); let resolve;
            r.respond(() => new Promise(done => { resolve = done; }));
            const pending = operation === 'create' ? r.room.createRoom({ name: '모임', appointmentAt: null }) : r.room.joinRoom('A3K9PZ');
            const rejected = assert.rejects(pending, { code: 'AUTH_REQUIRED' });
            await settle(); await r.load('src/services/auth.ts').clearLocalSession();
            r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '다음 계정' });
            resolve(fail ? jsonResponse({ success: false, error: { code: 'ROOM_BUSY' } }, 409)
                : jsonResponse({ success: true, data: operation === 'create' ? createdRoomData() : { roomId: ROOM_QUERY_ID } }));
            await rejected;
            assert.deepEqual(plain(r.roomCache.readCachedRooms()), []);
            assert.equal(r.roomCache.findCachedRoomIdByCode('A3K9PZ'), undefined);
        }
    }
});

test('생성 코드 캐시는 상세·목록 갱신에 유지되고 권한·목록·계정 변경 시 재사용하지 않아요', async () => {
    const r = roomQueryRuntime();
    r.respond(async () => jsonResponse({ success: true, data: createdRoomData() }, 201));
    await r.room.createRoom({ name: '모임', appointmentAt: null });
    r.respond(async url => jsonResponse({ success: true, data: url.endsWith('/rooms') ? [roomQuerySummary()] : url.endsWith('/invite-code') ? { roomCode: 'A3K9PZ' } : roomQueryDetail() }));
    await r.room.fetchRoomDetail(ROOM_QUERY_ID); await r.room.fetchMyRooms();
    assert.deepEqual(plain(await r.room.fetchInviteCode(ROOM_QUERY_ID)), { roomCode: 'A3K9PZ' });
    r.respond(async () => jsonResponse({ success: true, data: roomQueryDetail('MEMBER') }));
    await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    assert.equal(r.roomCache.readCachedRoomCode(ROOM_QUERY_ID), undefined);
    r.respond(async () => jsonResponse({ success: false, error: { code: 'NOT_ROOM_OWNER' } }, 403));
    await assert.rejects(r.room.fetchInviteCode(ROOM_QUERY_ID), { code: 'NOT_ROOM_OWNER' });
    r.respond(async () => jsonResponse({ success: true, data: [] })); await r.room.fetchMyRooms();
    assert.equal(r.roomCache.findCachedRoomIdByCode('A3K9PZ'), undefined);
    r.respond(async () => jsonResponse({ success: true, data: roomQueryDetail() })); await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const calls = r.calls.length;
    r.respond(async () => jsonResponse({ success: true, data: { roomCode: 'NEW123' } }));
    assert.deepEqual(plain(await r.room.fetchInviteCode(ROOM_QUERY_ID)), { roomCode: 'NEW123' });
    assert.equal(r.calls.length, calls + 1); // 캐시가 없어도 실제 7.9 응답으로 복구해요.
});

test('mock 생성·참여·이미 참여·정원 초과·처리 중 재시도는 서버 없이 유지해요', async () => {
    const r = createRuntime(); const service = r.load('src/services/room.ts'); let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    const created = await finishRoomMock(r, service.createRoom({ name: '  mock 모임  ', appointmentAt: null }));
    assert.equal(created.name, 'mock 모임'); assert.equal(created.myRole, 'OWNER'); assert.equal(created.memberCount, 1);
    assert.equal((await finishRoomMock(r, service.fetchInviteCode(created.id))).roomCode, created.roomCode);
    for (const code of ['a3k9pz ', 'cfm7q2']) {
        const joined = await finishRoomMock(r, service.joinRoom(code));
        assert.equal(service.getMockRoom(joined.roomId).myRole, 'MEMBER');
    }
    for (const [code, error] of [['A3K9PZ', 'ALREADY_JOINED'], ['FULL44', 'ROOM_FULL'], ['BUSY99', 'ROOM_BUSY'], ['XXXXXX', 'ROOM_CODE_INVALID']]) {
        const rejected = assert.rejects(service.joinRoom(code), { code: error }); await finishRoomMock(r, rejected);
    }
    await finishRoomMock(r, service.joinRoom('BUSY99')); assert.equal(calls, 0);
});

test('서버 생성 화면은 연타를 한 번만 보내고 생성 응답의 이름·초대 코드를 복사해요', async () => {
    const r = roomQueryScreen('src/app/rooms/new.tsx'); let resolve; const copied = [];
    r.external['expo-clipboard'].setStringAsync = async code => { copied.push(code); };
    const calls = [];
    r.context.fetch = (url, options) => { calls.push({ url, options }); return new Promise(done => { resolve = done; }); };
    let view = r.render(); findElement(view, element => element.type === 'TextInput').props.onChangeText('  입력한 모임  ');
    view = r.render(); const submit = roomWriteButton(view, '약속방 만들기');
    const first = submit.props.onPress(); const second = submit.props.onPress();
    await settle(); assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), { name: '입력한 모임', appointmentAt: null });
    view = r.render(); assert.ok(findElement(view, element => element.type === 'ActivityIndicator'));
    assert.equal(findElement(view, element => element.type === 'TextInput').props.editable, false);
    resolve(jsonResponse({ success: true, data: createdRoomData() }, 201)); await Promise.all([first, second]);
    const completed = r.render(); const content = r.renderComponent(completed);
    assert.ok(findElement(content, element => element.props?.children === '서버가 저장한 모임'));
    assert.ok(findElement(content, element => element.props?.children === 'A3K9PZ'));
    await findElement(content, element => element.props?.accessibilityLabel?.startsWith('초대 코드 A')).props.onPress();
    assert.deepEqual(copied, ['A3K9PZ']); r.unmount();
});

test('서버 생성 화면은 실패해도 입력을 유지해 재시도하고 TOKEN 오류는 중복 안내하지 않아요', async () => {
    for (const code of ['ROOM_BUSY', 'TOKEN_INVALID']) {
        const r = roomQueryScreen('src/app/rooms/new.tsx'); let calls = 0;
        r.context.fetch = async () => { calls++; return jsonResponse({ success: false, error: { code } }, code === 'TOKEN_INVALID' ? 401 : 409); };
        let view = r.render(); findElement(view, element => element.type === 'TextInput').props.onChangeText('유지할 이름');
        view = r.render(); await roomWriteButton(view, '약속방 만들기').props.onPress(); view = r.render();
        assert.equal(findElement(view, element => element.type === 'TextInput').props.value, '유지할 이름');
        const notice = findElement(view, element => element.type === 'Text' && typeof element.props?.children === 'string' && element.props.children.includes('잠시 후 다시 시도'));
        assert.equal(!!notice, code === 'ROOM_BUSY');
        if (code === 'ROOM_BUSY') {
            r.context.fetch = async () => { calls++; return jsonResponse({ success: true, data: createdRoomData() }, 201); };
            await roomWriteButton(view, '약속방 만들기').props.onPress(); assert.equal(calls, 2);
            assert.equal(r.render().props.room.roomCode, 'A3K9PZ');
        }
        r.unmount();
    }
});

test('서버 참여 화면은 공백 포함 붙여넣기와 연타를 처리하고 검증된 UUID의 상세로 이동해요', async () => {
    const r = roomQueryScreen('src/app/rooms/join.tsx'); const routes = []; const calls = []; let resolve;
    r.external['expo-router'].router.replace = route => routes.push(route);
    r.context.fetch = async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'POST') return await new Promise(done => { resolve = done; });
        return jsonResponse({ success: true, data: roomQueryDetail('MEMBER') });
    };
    let view = r.render(); const input = findElement(view, element => element.type === 'TextInput');
    assert.equal(input.props.maxLength, undefined); input.props.onChangeText(' a3k9pz ');
    view = r.render(); const button = roomWriteButton(view, '입장하기');
    assert.equal(findElement(view, element => element.type === 'TextInput').props.value, 'A3K9PZ');
    const first = button.props.onPress(); const second = button.props.onPress(); await settle();
    assert.equal(calls.length, 1);
    resolve(jsonResponse({ success: true, data: { roomId: ROOM_QUERY_ID } })); await Promise.all([first, second]);
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
    assert.equal(routes.length, 1); assert.equal(routes[0].pathname, '/rooms/[roomId]'); assert.equal(routes[0].params.roomId, ROOM_QUERY_ID);
    r.unmount();
});

test('참여 화면은 잘못된 문자·길이를 잘라 유효 코드로 만들지 않고 전송을 막아요', async () => {
    const r = roomQueryScreen('src/app/rooms/join.tsx'); let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    for (const code of ['A3K9PZ7', 'A3 K9PZ', 'A3K9P!']) {
        let view = r.render(); findElement(view, element => element.type === 'TextInput').props.onChangeText(code);
        view = r.render(); const button = roomWriteButton(view, '입장하기');
        assert.equal(button.props.disabled, true); await button.props.onPress();
    }
    assert.equal(calls, 0); r.unmount();
});

test('참여 화면은 404·409 안내를 유지하고 이미 참여한 방 이동은 사용자 선택 후에만 해요', async () => {
    for (const code of ['ROOM_CODE_INVALID', 'ROOM_FULL', 'ROOM_BUSY', 'ALREADY_JOINED', 'TOKEN_INVALID']) {
        const r = roomQueryScreen('src/app/rooms/join.tsx'); const routes = [];
        r.external['expo-router'].router.replace = route => routes.push(route);
        r.context.fetch = async () => jsonResponse({ success: false, error: { code, details: {} } }, code === 'ROOM_CODE_INVALID' ? 404 : code === 'TOKEN_INVALID' ? 401 : 409);
        let view = r.render(); findElement(view, element => element.type === 'TextInput').props.onChangeText('a3k9pz');
        view = r.render(); await roomWriteButton(view, '입장하기').props.onPress(); view = r.render();
        if (code !== 'TOKEN_INVALID') assert.equal(routes.length, 0);
        assert.equal(!!findElement(view, element => element.type === 'View' && element.props?.accessibilityLiveRegion === 'polite'), code !== 'TOKEN_INVALID');
        if (code === 'ALREADY_JOINED') {
            const showList = roomWriteButton(view, '참여 중인 방 목록 보기'); assert.ok(showList);
            showList.props.onPress(); assert.deepEqual(routes, ['/rooms']);
        }
        if (code === 'ROOM_BUSY') assert.ok(roomWriteButton(view, '다시 시도'));
        r.unmount();
    }
});

test('생성·참여 화면을 떠난 뒤 늦은 성공으로 완료 화면을 표시하거나 상세로 이동하지 않아요', async () => {
    for (const operation of ['create', 'join']) {
        const r = roomQueryScreen(operation === 'create' ? 'src/app/rooms/new.tsx' : 'src/app/rooms/join.tsx');
        let resolve; const routes = [];
        r.external['expo-router'].router.replace = route => routes.push(route);
        r.context.fetch = async (_url, options) => options.method === 'POST'
            ? await new Promise(done => { resolve = done; }) : jsonResponse({ success: true, data: roomQueryDetail('MEMBER') });
        let view = r.render(); findElement(view, element => element.type === 'TextInput').props.onChangeText(operation === 'create' ? '모임' : 'A3K9PZ');
        view = r.render(); const pending = roomWriteButton(view, operation === 'create' ? '약속방 만들기' : '입장하기').props.onPress();
        await settle(); r.unmount();
        resolve(jsonResponse({ success: true, data: operation === 'create' ? createdRoomData() : { roomId: ROOM_QUERY_ID } }, operation === 'create' ? 201 : 200));
        await pending; assert.equal(routes.length, 0); assert.equal(r.render().props.room, undefined);
    }
});


test('이미 참여한 방 ID가 확인된 경우에도 안내 후 버튼을 눌러야 상세로 이동해요', async () => {
    const r = roomQueryScreen('src/app/rooms/join.tsx'); const routes = [];
    r.external['expo-router'].router.replace = route => routes.push(route);
    r.context.fetch = async () => jsonResponse({ success: true, data: createdRoomData() }, 201);
    await r.load('src/services/room.ts').createRoom({ name: '모임', appointmentAt: null });
    r.context.fetch = async () => jsonResponse({ success: false, error: { code: 'ALREADY_JOINED', details: {} } }, 409);
    let view = r.render(); findElement(view, element => element.type === 'TextInput').props.onChangeText('a3k9pz');
    view = r.render(); await roomWriteButton(view, '입장하기').props.onPress(); view = r.render();
    assert.equal(routes.length, 0);
    roomWriteButton(view, '참여 중인 방으로 가기').props.onPress();
    assert.equal(routes.length, 1); assert.equal(routes[0].params.roomId, ROOM_QUERY_ID);
    r.unmount();
});

test('방 생성도 기존 A-1의 만료 토큰 갱신을 거쳐 새 토큰으로 한 번만 재시도해요', async () => {
    const r = roomQueryRuntime();
    await r.load('src/services/token-storage.ts').saveTokens('old-access', 'old-refresh', () => true);
    r.respond(async (url, options) => {
        if (url.endsWith('/auth/refresh')) return jsonResponse({ success: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh', accessTokenExpiresIn: 1800 } });
        if (options.headers.Authorization === 'Bearer old-access') return jsonResponse({ success: false, error: { code: 'TOKEN_EXPIRED' } }, 401);
        return jsonResponse({ success: true, data: createdRoomData() }, 201);
    });
    const created = await r.room.createRoom({ name: '모임', appointmentAt: null });
    assert.equal(created.id, ROOM_QUERY_ID);
    assert.equal(r.calls.filter(call => call.url.endsWith('/auth/refresh')).length, 1);
    assert.equal(r.calls.filter(call => call.url.endsWith('/rooms')).length, 2);
    assert.equal(r.calls.at(-1).options.headers.Authorization, 'Bearer new-access');
    assert.equal(r.roomCache.readCachedRoomCode(ROOM_QUERY_ID), 'A3K9PZ');
});


test('생성 전의 늦은 빈 목록 조회가 방금 생성한 서버 방 캐시를 지우지 않아요', async () => {
    const r = roomQueryRuntime(); let resolveOld;
    r.respond(() => new Promise(resolve => { resolveOld = resolve; }));
    const old = r.room.fetchMyRooms(); await settle();
    r.respond(async () => jsonResponse({ success: true, data: createdRoomData() }, 201));
    await r.room.createRoom({ name: '새 모임', appointmentAt: null });
    resolveOld(jsonResponse({ success: true, data: [] })); await old;
    assert.equal(r.roomCache.readCachedRooms()[0].id, ROOM_QUERY_ID);
    assert.equal(r.roomCache.readCachedRoomCode(ROOM_QUERY_ID), 'A3K9PZ');
});

test('참여 후 상세는 이전 조회를 공유하지 않고 늦은 이전 성공·403으로 새 캐시가 바뀌지 않아요', async () => {
    for (const denied of [false, true]) {
        const r = roomQueryRuntime(); let resolveOld; let gets = 0;
        r.respond(async (_url, options) => {
            if (options.method === 'POST') return jsonResponse({ success: true, data: { roomId: ROOM_QUERY_ID } });
            gets++;
            if (gets === 1) return await new Promise(resolve => { resolveOld = resolve; });
            return jsonResponse({ success: true, data: roomQueryDetail('MEMBER') });
        });
        const old = r.room.fetchRoomDetail(ROOM_QUERY_ID); await settle();
        const observedOld = denied ? assert.rejects(old, { code: 'NOT_ROOM_MEMBER' }) : old;
        await r.room.joinRoom('a3k9pz');
        assert.equal(gets, 2);
        resolveOld(denied ? jsonResponse({ success: false, error: { code: 'NOT_ROOM_MEMBER' } }, 403)
            : jsonResponse({ success: true, data: roomQueryDetail('OWNER') }));
        await observedOld;
        assert.equal(r.roomCache.readCachedRooms()[0].myRole, 'MEMBER');
        assert.equal(r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID).ownerId, ROOM_QUERY_OTHER);
        assert.equal(r.roomCache.findCachedRoomIdByCode('A3K9PZ'), ROOM_QUERY_ID);
    }
});

test('추천 8.1·8.2·8.3 요청 URL·body·인증 헤더, mock 인자 무시', async () => {
    const r = recoRuntime();
    r.load('src/services/api/client.ts').setAccessTokenProvider(() => 'test-access');
    r.recoRespond(async () => ok(recoRun()));
    const reco = r.load('src/services/recommendation.ts');
    const roomId = 'room/1 a';
    const base = 'https://example.test/api/v1/rooms/room%2F1%20a/recommendations';
    await reco.createRecommendation(roomId, {});
    await reco.createRecommendation(roomId, { conditionText: '   ', filter: { maxMinutes: undefined, excludeStationIds: [], memberLimits: [] } });
    await reco.createRecommendation(roomId, { conditionText: ' 환승 적게 ', filter: { maxMinutes: 30, maxTransfers: undefined, excludeStationIds: [101], memberLimits: [] } }, 'error');
    await reco.fetchLatestRecommendation(roomId, 'error');
    await reco.fetchRecommendation(roomId, 'run/2');
    const calls = r.calls.filter(call => call.url.includes('/recommendations'));
    assert.deepEqual(calls.map(call => [call.options.method, call.url]), [
        ['POST', base], ['POST', base], ['POST', base], ['GET', `${base}/latest`], ['GET', `${base}/run%2F2`],
    ]);
    assert.deepEqual(calls.slice(0, 3).map(call => JSON.parse(call.options.body)), [
        {}, {}, { conditionText: '환승 적게', filter: { maxMinutes: 30, excludeStationIds: [101] } },
    ]);
    assert.equal(calls[3].options.body, undefined);
    assert.ok(r.calls.every(call => call.options.headers.Authorization === 'Bearer test-access'));
});

test('추천 8.1만 제한 시간 30초, 시간 초과는 결과 저장 가능 안내가 담긴 NETWORK_ERROR, 조회는 기본 10초', async () => {
    const r = recoRuntime();
    const reco = r.load('src/services/recommendation.ts');
    const { RecommendationError } = r.load('src/types/recommendation.ts');
    assert.equal(reco.RECOMMENDATION_TIMEOUT_MS, 30000);
    r.recoRespond((_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('중단')))));
    const created = reco.createRecommendation(ROOM_QUERY_ID, {});
    const createRejected = assert.rejects(created, error => error instanceof RecommendationError && error.code === 'NETWORK_ERROR'
        && error.message === '추천 결과를 받지 못했어요. 결과가 저장됐을 수 있어요. 최근 결과를 확인해 보세요.');
    await settle();
    assert.equal([...r.timers.values()][0].ms, 30000);
    r.advance(29999); await settle(); assert.equal(r.timers.size, 1);
    r.advance(1); await createRejected;
    const latest = reco.fetchLatestRecommendation(ROOM_QUERY_ID);
    const latestRejected = assert.rejects(latest, error => error instanceof RecommendationError && error.code === 'NETWORK_ERROR'
        && !error.message.includes('저장됐을'));
    await settle();
    assert.equal([...r.timers.values()][0].ms, 10000);
    r.advance(10000); await latestRejected;
    assert.equal(r.calls.filter(call => call.url.includes('/recommendations')).length, 2, '재시도하지 않아요');
});

test('추천 정상 응답 정리: 서버 역 ID·lines 없음→역 상세로 채움·congestion null·새 필드 통과·조건 null 정리', async () => {
    const r = recoRuntime();
    const data = recoRun({ conditionText: '30분 이내', message: '조건을 적용했어요.',
        appliedConstraints: { maxMinutes: 30, maxTransfers: null, maxFareWon: 2000, excludeStationIds: [], memberLimits: [{ userId: ROOM_QUERY_OTHER, maxMinutes: 20 }] } });
    r.recoRespond(async () => ok(data));
    const run = plain(await r.load('src/services/recommendation.ts').createRecommendation(ROOM_QUERY_ID, {}));
    assert.equal(run.runId, 'server-run-1'); assert.equal(run.isStale, false); assert.deepEqual(run.staleReasons, []);
    assert.equal(run.conditionText, '30분 이내'); assert.equal(run.message, '조건을 적용했어요.');
    assert.deepEqual(run.appliedConstraints, { maxMinutes: 30, maxFareWon: 2000, memberLimits: [{ userId: ROOM_QUERY_OTHER, maxMinutes: 20 }] });
    assert.deepEqual(run.results.map(item => [item.criterion, item.recommendedStation.id]), [['TIME', 77001], ['FARE', 77002], ['DISTANCE', 77001]]);
    assert.deepEqual(run.results[0].recommendedStation.lines, [{ lineId: 2, lineName: '2호선', color: '#00a84d' }]);
    // 같은 역은 한 번만 불러요.
    assert.deepEqual(r.calls.filter(call => call.url.includes('/stations/')).map(call => call.url.split('/').at(-1)).sort(), ['77001', '77002']);
    const [mine, other] = run.results[0].participantTimes;
    assert.deepEqual(mine.congestion, { level: 'NORMAL', levelLabel: '보통', pct: 80 });
    assert.equal(other.congestion, null);
    for (const key of Object.keys(RECO_EXTRA)) assert.deepEqual(mine[key], RECO_EXTRA[key], key);
    assert.deepEqual(run.results[0].nearbyAlternatives.map(alt => alt.station.id), [77009]);
    assert.equal(run.results[0].explanationSource, 'AI');

    // 조건이 모두 null·빈 배열이거나 appliedConstraints 가 null 이면 "조건 없음"({})이에요.
    for (const appliedConstraints of [recoRun().appliedConstraints, null]) {
        r.recoRespond(async () => ok(recoRun({ appliedConstraints })));
        assert.deepEqual(plain((await r.load('src/services/recommendation.ts').fetchLatestRecommendation(ROOM_QUERY_ID)).appliedConstraints), {});
    }
});

test('추천 화면이 안 쓰는 값은 없거나 달라도 통과해요', async () => {
    const r = recoRuntime();
    const data = recoRun({ staleReasons: undefined });
    const result = data.results[0];
    delete result.recommendedStation.latitude; delete result.recommendedStation.longitude; delete result.recommendedStation.isSupported;
    delete result.metrics.totalTransfers; delete result.nearbyAlternatives; result.explanationSource = 'OTHER';
    delete result.participantTimes[0].congestion.pct; delete result.participantTimes[0].segments[0].direction;
    delete result.participantTimes[1].segments;
    for (const key of Object.keys(RECO_EXTRA)) delete result.participantTimes[1][key];
    r.recoRespond(async () => ok(data));
    const run = plain(await r.load('src/services/recommendation.ts').fetchLatestRecommendation(ROOM_QUERY_ID));
    assert.equal(run.staleReasons, null);
    assert.deepEqual(run.results[0].nearbyAlternatives, []);
    assert.deepEqual(run.results[0].participantTimes[1].segments, []);
    assert.equal(run.results[0].explanationSource, 'TEMPLATE');
    assert.deepEqual(run.results[0].participantTimes[0].congestion, { level: 'NORMAL', levelLabel: '보통' });
});

test('추천역 노선 조회는 최대 3곳 병렬·실패하면 배지만 숨기고 결과 유지, 인증 오류는 그대로 던져요', async () => {
    const r = recoRuntime();
    const reco = r.load('src/services/recommendation.ts');
    const pending = [];
    r.respond(async url => {
        if (url.includes('/recommendations')) return ok(recoRun({ results: [recoResult('TIME', 77001), recoResult('FARE', 77002), recoResult('DISTANCE', 77003)] }));
        return new Promise(resolve => pending.push({ url, resolve }));
    });
    const running = reco.createRecommendation(ROOM_QUERY_ID, {});
    await settle(); await settle();
    assert.equal(pending.length, 3, '세 역을 동시에 불러요');
    pending.find(item => item.url.endsWith('/77001')).resolve(ok(recoStation(77001)));
    pending.find(item => item.url.endsWith('/77002')).resolve(jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR' } }, 500));
    pending.find(item => item.url.endsWith('/77003')).resolve(ok({ id: 77003 }));
    const run = plain(await running);
    assert.equal(run.results.length, 3);
    assert.deepEqual(run.results.map(item => !!item.recommendedStation.lines), [true, false, false]);

    r.respond(async url => url.includes('/stations/') ? fail('TOKEN_INVALID') : ok(recoRun()));
    await assert.rejects(reco.fetchLatestRecommendation(ROOM_QUERY_ID), error => error instanceof r.load('src/services/api/errors.ts').ApiError && error.code === 'TOKEN_INVALID');
});

test('추천 8.2 data:null 은 null, 8.3 isStale·staleReasons null 은 그대로, 빈 결과+message 는 정상', async () => {
    const r = recoRuntime();
    const reco = r.load('src/services/recommendation.ts');
    r.recoRespond(async () => ok(null));
    assert.equal(await reco.fetchLatestRecommendation(ROOM_QUERY_ID), null);
    assert.deepEqual(plain(reco.listRecommendationRuns(ROOM_QUERY_ID)), []);
    assert.equal(r.calls.filter(call => call.url.includes('/stations/')).length, 0);

    r.recoRespond(async () => ok(recoRun({ runId: 'old-run', isStale: null, staleReasons: null })));
    const old = plain(await reco.fetchRecommendation(ROOM_QUERY_ID, 'old-run'));
    assert.strictEqual(old.isStale, null); assert.strictEqual(old.staleReasons, null);

    r.recoRespond(async () => ok(recoRun({ isStale: true, staleReasons: ['APPOINTMENT_CHANGED', 'MEMBERS_CHANGED'] })));
    const stale = plain(await reco.fetchLatestRecommendation(ROOM_QUERY_ID));
    assert.equal(stale.isStale, true); assert.deepEqual(stale.staleReasons, ['APPOINTMENT_CHANGED', 'MEMBERS_CHANGED']);

    // 8.2 의 null 은 8.3 에서는 정상이 아니에요(형식 오류).
    r.recoRespond(async () => ok(null));
    await assert.rejects(reco.fetchRecommendation(ROOM_QUERY_ID, 'run-x'), { code: 'UNKNOWN_ERROR' });

    const before = r.calls.filter(call => call.url.includes('/stations/')).length;
    r.recoRespond(async () => ok(recoRun({ results: [], message: '조건에 맞는 중간역이 없어요.' })));
    const empty = plain(await reco.createRecommendation(ROOM_QUERY_ID, { filter: { maxMinutes: 5 } }));
    assert.deepEqual(empty.results, []); assert.equal(empty.message, '조건에 맞는 중간역이 없어요.');
    assert.equal(r.calls.filter(call => call.url.includes('/stations/')).length, before);
});

test('추천 서버 오류 코드 매핑: 새 코드 안내·DEPARTURE_MISSING 멤버·모르는 코드 UNKNOWN_ERROR·인증 오류는 그대로', async () => {
    const r = recoRuntime();
    const reco = r.load('src/services/recommendation.ts');
    const { RecommendationError } = r.load('src/types/recommendation.ts');
    const { ApiError } = r.load('src/services/api/errors.ts');
    const expectCreate = async (response, code, message, missing) => {
        r.recoRespond(async () => response);
        await assert.rejects(reco.createRecommendation(ROOM_QUERY_ID, {}), error => {
            assert.ok(error instanceof RecommendationError, `${code}: RecommendationError`);
            assert.equal(error.code, code);
            if (message) assert.equal(error.message, message);
            assert.deepEqual(error.missingUserIds === undefined ? undefined : plain(error.missingUserIds), missing);
            return true;
        });
    };
    await expectCreate(recoFail('APPOINTMENT_PASSED', 422), 'APPOINTMENT_PASSED', '약속 시각이 이미 지나서 추천할 수 없어요. 약속 시각을 바꿔 주세요.');
    await expectCreate(recoFail('NO_SERVICE_TIME', 422), 'NO_SERVICE_TIME', '약속 시각 전에 도착하는 열차가 없어요. 약속 시각을 조정해 주세요.');
    await expectCreate(recoFail('RECOMMENDATION_IN_PROGRESS', 409), 'RECOMMENDATION_IN_PROGRESS', '다른 멤버가 추천을 계산하고 있어요. 잠시 후 다시 시도해 주세요.');
    await expectCreate(recoFail('VALIDATION_ERROR', 400), 'VALIDATION_ERROR');
    await expectCreate(recoFail('TOO_FEW_MEMBERS', 422), 'TOO_FEW_MEMBERS');
    await expectCreate(recoFail('STATION_UNSUPPORTED', 422), 'STATION_UNSUPPORTED');
    await expectCreate(recoFail('DEPARTURE_MISSING', 422, { missingUserIds: [ROOM_QUERY_OTHER] }), 'DEPARTURE_MISSING', undefined, [ROOM_QUERY_OTHER]);
    await expectCreate(recoFail('DEPARTURE_MISSING', 422, { missingUserIds: [1] }), 'DEPARTURE_MISSING', undefined, undefined);
    await expectCreate(recoFail('DEPARTURE_MISSING', 422), 'DEPARTURE_MISSING', undefined, undefined);
    await expectCreate(recoFail('NOT_ROOM_MEMBER', 403), 'NOT_ROOM_MEMBER');
    await expectCreate(recoFail('ROOM_NOT_FOUND', 404), 'ROOM_NOT_FOUND');
    await expectCreate(recoFail('SOMETHING_NEW', 500), 'UNKNOWN_ERROR', '추천 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    r.recoRespond(async () => recoFail('RUN_NOT_FOUND', 404));
    await assert.rejects(reco.fetchRecommendation(ROOM_QUERY_ID, 'other-room-run'), error => error instanceof RecommendationError && error.code === 'RUN_NOT_FOUND');
    r.recoRespond(async () => { throw new TypeError('연결 실패'); });
    await assert.rejects(reco.fetchLatestRecommendation(ROOM_QUERY_ID), error => error instanceof RecommendationError && error.code === 'NETWORK_ERROR');
    // 인증 오류는 A-1 처리에 맡겨요(마지막에 확인: 공통 처리가 로그인 상태를 지워요).
    r.recoRespond(async () => fail('TOKEN_INVALID'));
    await assert.rejects(reco.createRecommendation(ROOM_QUERY_ID, {}), error => error instanceof ApiError && !(error instanceof RecommendationError) && error.code === 'TOKEN_INVALID');
});

test('추천 응답의 화면 사용 값 누락·형식 오류는 UNKNOWN_ERROR', async () => {
    const mutations = [
        data => { delete data.runId; }, data => { data.createdAt = '시각 아님'; }, data => { data.isStale = 'false'; },
        data => { delete data.isStale; }, data => { data.staleReasons = 'MEMBERS_CHANGED'; }, data => { data.results = {}; },
        data => { data.conditionText = 3; }, data => { data.message = {}; }, data => { data.appliedConstraints = 'x'; },
        data => { delete data.results[0].resultId; }, data => { data.results[0].criterion = 'OTHER'; },
        data => { data.results[0].recommendedStation.id = '77001'; }, data => { delete data.results[0].recommendedStation.name; },
        data => { delete data.results[0].metrics.maxMinutes; }, data => { data.results[0].metrics.averageFare = '1650'; },
        data => { delete data.results[0].explanation; }, data => { data.results[0].participantTimes = null; },
        data => { delete data.results[0].participantTimes[0].travelMinutes; }, data => { data.results[0].participantTimes[0].departureAt = 'x'; },
        data => { data.results[0].participantTimes[0].departureStation = null; },
        data => { data.results[0].participantTimes[0].congestion = { level: 1, levelLabel: '보통' }; },
        data => { data.results[0].participantTimes[0].segments = 'x'; }, data => { delete data.results[0].participantTimes[0].segments[0].color; },
        data => { data.results[0].nearbyAlternatives = 'x'; }, data => { delete data.results[0].nearbyAlternatives[0].maxMinutes; },
    ];
    const r = recoRuntime();
    const reco = r.load('src/services/recommendation.ts');
    const { RecommendationError } = r.load('src/types/recommendation.ts');
    let current;
    r.recoRespond(async () => ok(current));
    for (let i = 0; i < mutations.length; i++) {
        current = recoRun(); mutations[i](current);
        await assert.rejects(reco.fetchLatestRecommendation(ROOM_QUERY_ID), error => error instanceof RecommendationError && error.code === 'UNKNOWN_ERROR', `변형 ${i}`);
    }
    current = 'html';
    await assert.rejects(reco.createRecommendation(ROOM_QUERY_ID, {}), { code: 'UNKNOWN_ERROR' });
});

test('추천 이전 실행 목록은 이 세션의 8.1 성공·8.2 결과만 중복 없이 최근 순, 계정이 바뀌면 비워요', async () => {
    const r = recoRuntime();
    const reco = r.load('src/services/recommendation.ts');
    let next = recoRun({ runId: 'run-a', createdAt: '2026-11-11T10:00:00+09:00' });
    r.recoRespond(async () => ok(next));
    await reco.fetchLatestRecommendation(ROOM_QUERY_ID);
    assert.deepEqual(plain(reco.listRecommendationRuns(ROOM_QUERY_ID)).map(item => item.runId), ['run-a']);
    next = recoRun({ runId: 'run-b', createdAt: '2026-11-11T10:05:00+09:00' });
    await reco.createRecommendation(ROOM_QUERY_ID, {});
    await reco.fetchLatestRecommendation(ROOM_QUERY_ID);
    // 8.3 은 목록에 더하지 않아요.
    next = recoRun({ runId: 'run-z', createdAt: '2026-11-11T09:00:00+09:00', isStale: null, staleReasons: null });
    await reco.fetchRecommendation(ROOM_QUERY_ID, 'run-z');
    assert.deepEqual(plain(reco.listRecommendationRuns(ROOM_QUERY_ID)), [
        { runId: 'run-b', createdAt: '2026-11-11T10:05:00+09:00' }, { runId: 'run-a', createdAt: '2026-11-11T10:00:00+09:00' },
    ]);
    assert.deepEqual(plain(reco.listRecommendationRuns(ROOM_QUERY_ID2)), []);
    await r.load('src/services/auth.ts').clearLocalSession();
    r.load('src/stores/auth-store.ts').signIn({ userId: '33333333-3333-4333-8333-333333333333', nickname: '다음 사용자' });
    r.load('src/services/room-cache.ts').getRoomCacheScope();
    assert.deepEqual(plain(reco.listRecommendationRuns(ROOM_QUERY_ID)), []);
});

test('계정이 바뀐 뒤 도착한 이전 추천 응답은 버리고(AUTH_REQUIRED) 목록에도 남기지 않아요', async () => {
    for (const action of ['create', 'latest']) {
        const r = recoRuntime();
        const reco = r.load('src/services/recommendation.ts');
        let resolveOld;
        r.recoRespond(() => new Promise(resolve => { resolveOld = resolve; }));
        const old = action === 'create' ? reco.createRecommendation(ROOM_QUERY_ID, {}) : reco.fetchLatestRecommendation(ROOM_QUERY_ID);
        const rejected = assert.rejects(old, { code: 'AUTH_REQUIRED' });
        await settle();
        await r.load('src/services/auth.ts').clearLocalSession();
        r.load('src/stores/auth-store.ts').signIn({ userId: '33333333-3333-4333-8333-333333333333', nickname: '다음 사용자' });
        resolveOld(ok(recoRun({ runId: 'previous-account-run' })));
        await rejected;
        assert.deepEqual(plain(reco.listRecommendationRuns(ROOM_QUERY_ID)), [], action);
    }
});

test('mock 추천은 기존 동작(실패 한 번·성공·mock 역·출발역 미설정·이전 목록)을 유지하고 서버를 부르지 않아요', async () => {
    const r = createRuntime();
    let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    const reco = r.load('src/services/recommendation.ts');
    const mockIds = new Set(r.load('src/mocks/stations.ts').MOCK_STATIONS.map(station => station.id));
    assert.equal(await finishRoomMock(r, reco.fetchLatestRecommendation('room-2')), null);
    const failed = reco.createRecommendation('room-2', {}, 'error');
    await finishRoomMock(r, assert.rejects(failed, { code: 'NETWORK_ERROR' }));
    const run = await finishRoomMock(r, reco.createRecommendation('room-2', { conditionText: '30분 이내' }));
    assert.deepEqual(plain(run.results.map(item => item.criterion)), ['TIME', 'FARE', 'DISTANCE']);
    assert.ok(run.results.every(item => mockIds.has(item.recommendedStation.id) && item.recommendedStation.lines.length > 0));
    assert.equal(run.isStale, false); assert.deepEqual(plain(run.appliedConstraints), { maxMinutes: 30 });
    assert.ok(run.results[0].participantTimes.every(p => p.congestion && typeof p.congestion.levelLabel === 'string'));
    assert.equal((await finishRoomMock(r, reco.fetchLatestRecommendation('room-2'))).runId, run.runId);
    assert.equal(reco.listRecommendationRuns('room-2').length, 1);
    const missing = reco.createRecommendation('room-4', {});
    await finishRoomMock(r, assert.rejects(missing, error => error.code === 'DEPARTURE_MISSING' && error.missingUserIds.length === 1));
    assert.equal(calls, 0);
});

/** 추천 화면만 구동해요. 실제 React·브라우저 렌더링을 대신하지 않아요. */
function recoScreen(params = { roomId: ROOM_QUERY_ID }) {
    const r = roomQueryScreen('src/app/rooms/[roomId]/recommendations.tsx', params);
    r.calls = [];
    r.recoRespond = handler => {
        const detail = roomQueryDetail(); detail.members[1].departureStation = roomQueryStation(99002);
        r.context.fetch = async (url, options) => {
            r.calls.push({ url, options });
            if (url.includes('/recommendations')) return handler(url, options);
            if (url.includes('/station-proposals')) return ok({ selectedStation: null, maxProposals: 9, items: [] });
            if (url.includes('/stations/')) return ok(recoStation(Number(url.split('/').at(-1))));
            return ok(detail);
        };
    };
    return r;
}
async function pumpScreen(r) { for (let i = 0; i < 6; i++) { r.render(); await settle(); r.advance(1000); await settle(); } return r.render(); }
const textOf = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'object' ? textOf(node.props?.children) : String(node);
const findText = (view, text) => findElement(view, element => element.type === 'Text' && textOf(element) === text);
const findTextIncluding = (view, text) => findElement(view, element => element.type === 'Text' && textOf(element).includes(text));

test('120/121 room recommendation route navigation carries roomId', async () => {
    const r = recoScreen(); const pushes = [];
    r.external['expo-router'].router.push = value => pushes.push(value);
    r.recoRespond(async () => ok(recoRun()));
    const view = await pumpScreen(r);
    const button = findElement(view, e => e.type === 'Pressable' && findTextIncluding(e.props.children, '경로 자세히'));
    assert.ok(button); button.props.onPress();
    assert.equal(pushes[0].pathname, '/route-search');
    assert.equal(pushes[0].params.roomId, ROOM_QUERY_ID); r.unmount();
});

test('추천 화면(서버): 빈 기록은 입력 보기, 계산 버튼 연타는 8.1 한 번, 결과의 혼잡도 null 은 점·라벨·문구만 숨겨요', async () => {
    const r = recoScreen();
    let resolveCreate;
    let created = null; // 실서버처럼 8.1 이 끝나면 8.2 도 그 실행을 돌려줘요(화면은 실행 뒤 8.2 를 다시 불러요).
    r.recoRespond((url, options) => options.method === 'POST'
        ? new Promise(resolve => { resolveCreate = response => { created = recoRun(); resolve(response); }; })
        : ok(created));
    let view = await pumpScreen(r);
    const button = findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '중간역 계산하기'));
    assert.ok(button, '입력 보기의 계산 버튼');
    button.props.onPress(); button.props.onPress(); await settle();
    assert.equal(r.calls.filter(call => call.options.method === 'POST').length, 1);
    resolveCreate(ok(recoRun()));
    view = await pumpScreen(r);
    assert.equal(r.calls.filter(call => call.options.method === 'POST').length, 1);
    assert.ok(findText(view, '서버 추천역 77001역'), '서버 역 ID의 추천역 이름');
    assert.equal(findText(view, '이전 추천 기록'), null, '다른 실행이 없으면 목록을 숨겨요');
    const rows = [];
    findElement(view, element => { if (typeof element.type === 'function' && element.type.name === 'ParticipantRow') rows.push(element); return false; });
    assert.equal(rows.length, 2);
    const opened = rows.map(row => row.type({ ...row.props, opened: true }));
    assert.ok(findText(opened[0], '보통'));
    assert.ok(findTextIncluding(opened[0], '기준 혼잡도'));
    assert.equal(findText(opened[1], '보통'), null);
    assert.equal(findTextIncluding(opened[1], '혼잡도'), null);
    assert.ok(findTextIncluding(opened[1], '다익스트라 추정치예요'));
    r.unmount();
});

test('추천 빈 결과는 서버 안내를 한 번 표시하고, 안내가 없을 때만 조건 완화를 안내해요', async () => {
    const fallback = '시간·환승·요금 조건을 조금 완화해서 다시 추천받아 보세요.';
    for (const message of [
        '첫차 시각이 가까워 약속 시각까지 도착할 수 있는 역이 없습니다. 약속 시간을 늦춰 주세요.',
        '조건에 맞는 중간역이 없습니다. 조건을 완화해 보세요.',
        null,
        '',
    ]) {
        const r = recoScreen();
        r.recoRespond(async () => ok(recoRun({ results: [], message })));
        let view = await pumpScreen(r);
        assert.ok(findText(view, '조건에 맞는 중간역이 없어요'));
        const notices = [];
        findElement(view, element => {
            if (element.type === 'Text' && textOf(element) === (message || fallback)) notices.push(element);
            return false;
        });
        assert.equal(notices.length, 1, '빈 결과의 안내를 중복 없이 표시해요');
        if (message) assert.equal(findText(view, fallback), null);
        assert.equal(findText(view, '서버 추천역 77001역'), null);
        const change = findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '조건 바꾸기'));
        assert.ok(change);
        change.props.onPress();
        view = await pumpScreen(r);
        assert.ok(findText(view, '중간역 계산하기') || findText(view, '다시 추천받기'));
        r.unmount();
    }
});

test('추천 화면(서버): 조건 상자는 빈 결과에도 유지하고 결과가 있으면 안내를 상자 안에 표시해요', async () => {
    for (const empty of [true, false]) {
        const r = recoScreen();
        const message = '서버 안내 문구';
        r.recoRespond(async () => ok(recoRun({
            ...(empty ? { results: [] } : {}), message, conditionText: '30분 이내',
            appliedConstraints: { maxMinutes: 30 },
        })));
        const view = await pumpScreen(r);
        const box = findElement(view, element => element.type === 'View' &&
            [element.props?.children].flat().some(child => child?.type === 'Text' && textOf(child) === '"30분 이내"'));
        assert.ok(box);
        assert.equal(!!findText(box, message), !empty);
        assert.ok(findText(view, message));
        r.unmount();
    }
});

test('추천 화면(서버): 새 오류 3종·DEPARTURE_MISSING 안내, 시간 초과 안내, 인증 오류는 화면 안내 없음', async () => {
    const cases = [
        [recoFail('APPOINTMENT_PASSED', 422), '약속 시각이 이미 지나서 추천할 수 없어요. 약속 시각을 바꿔 주세요.'],
        [recoFail('NO_SERVICE_TIME', 422), '약속 시각 전에 도착하는 열차가 없어요. 약속 시각을 조정해 주세요.'],
        [recoFail('RECOMMENDATION_IN_PROGRESS', 409), '다른 멤버가 추천을 계산하고 있어요. 잠시 후 다시 시도해 주세요.'],
        [recoFail('DEPARTURE_MISSING', 422, { missingUserIds: [ROOM_QUERY_OTHER] }), '출발역을 설정하지 않은 멤버가 있어요. (서버 동료)'],
        ['network', '추천 결과를 받지 못했어요. 결과가 저장됐을 수 있어요. 최근 결과를 확인해 보세요.'],
        [fail('TOKEN_INVALID'), null],
    ];
    for (const [response, message] of cases) {
        const r = recoScreen();
        r.recoRespond(async (url, options) => {
            if (options.method !== 'POST') return ok(null);
            if (response === 'network') throw new TypeError('연결 실패');
            return response;
        });
        let view = await pumpScreen(r);
        findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '중간역 계산하기')).props.onPress();
        view = await pumpScreen(r);
        if (message) assert.ok(findText(view, message), message);
        else {
            assert.equal(findTextIncluding(view, '추천을 실행하지 못했어요'), null);
            assert.equal(findElement(view, element => element.props?.name === 'warning-outline'), null, '인증 오류는 중복 안내하지 않아요');
        }
        r.unmount();
    }
});

test('추천 화면(서버): isStale true 만 다시 추천받기 안내, null 은 판정하지 않고, 이전 기록은 2건 이상일 때 보여요', async () => {
    let r = recoScreen();
    r.recoRespond(async () => ok(recoRun({ isStale: true, staleReasons: ['MEMBERS_CHANGED'] })));
    let view = await pumpScreen(r);
    assert.ok(findText(view, '참여자나 출발역이 바뀌었어요'));
    assert.ok(findText(view, '다시 추천받기'));
    r.unmount();

    r = recoScreen({ roomId: ROOM_QUERY_ID, runId: 'old-run' });
    r.recoRespond(async () => ok(recoRun({ runId: 'old-run', isStale: null, staleReasons: null })));
    view = await pumpScreen(r);
    assert.equal(findText(view, '다시 추천받기'), null);
    assert.ok(findTextIncluding(view, '최신 여부는 최근 결과에서만 확인할 수 있어요'));
    assert.equal(findTextIncluding(view, '최신 결과예요'), null);
    r.unmount();

    // 조건이 모두 null 이면 "null" 글자 없이 "적용된 제약 없음"이에요. 최근 실행 하나뿐이면 이전 기록을 숨기고, 새로 실행하면 보여요.
    r = recoScreen();
    let latest = recoRun({ conditionText: '조건' });
    r.recoRespond(async (url, options) => {
        if (options.method === 'POST') latest = recoRun({ runId: 'new-run', createdAt: '2026-11-11T11:00:00+09:00', conditionText: '조건' });
        return ok(latest);
    });
    view = await pumpScreen(r);
    assert.ok(findText(view, '적용된 제약 없음'));
    assert.equal(findTextIncluding(view, 'null'), null);
    assert.equal(findText(view, '이전 추천 기록'), null);
    // 결과 보기의 "조건 바꾸기" → 입력 보기의 "다시 추천받기"로 8.1 을 다시 불러요.
    findElement(view, element => element.props?.accessibilityLabel === '조건 바꾸기').props.onPress();
    view = r.render();
    findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '다시 추천받기')).props.onPress();
    view = await pumpScreen(r);
    assert.ok(findText(view, '이전 추천 기록'));
    assert.equal(r.calls.filter(call => call.options.method === 'POST').length, 1);
    r.unmount();
});

/* ---------- 홈 "다가오는 약속" 서버 연동 (#102) ---------- */

const HOME_DAY = 86_400_000;
const homeRoom = (id, offsetMs, overrides = {}) => roomQuerySummary({
    id, name: `방 ${id.slice(0, 4)}`, appointmentAt: offsetMs === null ? null : new Date(Date.now() + offsetMs).toISOString(), ...overrides,
});

test('다가오는 약속 고르기: 지난 방·시각 없는 방·읽을 수 없는 시각 제외, 가장 가까운 방, 전부 지났으면 null', () => {
    const { pickUpcomingRoom, toHomeMeeting, meetingRoomParams } = createRuntime().load('src/utils/upcoming-meeting.ts');
    const { formatAppointmentParam } = createRuntime().load('src/constants/home-mock.ts');
    const now = new Date('2026-11-12T12:00:00+09:00');
    const at = iso => roomQuerySummary({ id: iso, appointmentAt: iso });
    const past = at('2026-11-12T11:59:00+09:00');
    const soon = at('2026-11-12T12:30:00+09:00');
    const later = at('2026-11-20T19:00:00+09:00');
    const exact = at('2026-11-12T12:00:00+09:00');
    const none = roomQuerySummary({ id: 'none', appointmentAt: null });
    const broken = roomQuerySummary({ id: 'broken', appointmentAt: '시각 아님' });
    assert.equal(pickUpcomingRoom([later, past, none, soon, broken], now).id, soon.id);
    assert.equal(pickUpcomingRoom([later, soon], now).id, soon.id, '목록 순서와 상관없이 가장 가까운 방');
    assert.equal(pickUpcomingRoom([past, exact, later], now).id, exact.id, '지금 시각과 같으면 아직 지나지 않은 약속');
    assert.equal(pickUpcomingRoom([past, none, broken], now), null);
    assert.equal(pickUpcomingRoom([], now), null);
    const twin = { ...soon, id: 'twin' };
    assert.equal(pickUpcomingRoom([soon, twin], now).id, soon.id, '같은 시각이면 목록 순서');
    const card = toHomeMeeting({ ...later, name: '서버 모임', memberCount: 3, maxMembers: 4, selectedStation: roomQueryStation(88001) });
    assert.deepEqual(plain({ ...card, appointmentAt: card.appointmentAt.toISOString() }), {
        roomId: later.id, title: '서버 모임', appointmentAt: new Date(later.appointmentAt).toISOString(), stationName: '서버 역 88001', memberCount: 3, maxMembers: 4,
    });
    assert.equal(toHomeMeeting(later).stationName, null);
    assert.deepEqual(plain(meetingRoomParams(card)), { roomId: later.id, roomName: '서버 모임', appointmentAt: formatAppointmentParam(new Date(later.appointmentAt)), maxMembers: '4' });
});

/** 홈 화면만 구동해요. 실제 React·브라우저 렌더링을 대신하지 않아요. */
function homeRuntime(env = serverEnv) {
    const r = createScreenRuntime(env, 'src/app/home.tsx');
    r.native.ScrollView = 'ScrollView';
    r.native.Alert = { alert() {} };
    r.native.useWindowDimensions = () => ({ width: 390, height: 844 });
    r.external.react.useCallback = (callback, dependencies) => {
        const ref = r.external.react.useRef(null);
        if (!ref.current || dependencies.some((value, index) => value !== ref.current.dependencies[index])) ref.current = { callback, dependencies };
        return ref.current.callback;
    };
    let focusCallback;
    let blur;
    r.external['expo-router'].useFocusEffect = callback => { focusCallback = callback; r.external.react.useEffect(callback, [callback]); };
    /** 다른 화면에 갔다가 홈으로 돌아온 것처럼 포커스 효과를 다시 실행해요. */
    r.refocus = () => { blur?.(); blur = focusCallback(); };
    r.pushes = [];
    r.external['expo-router'].router.push = target => { r.pushes.push(target); };
    if (env === serverEnv) r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_ME, nickname: '서버 나' });
    r.calls = [];
    r.respond = handler => { r.context.fetch = async (url, options) => { r.calls.push({ url, options }); return handler(url, options); }; };
    r.view = () => r.render();
    return r;
}
const homeMeetingCard = view => findElement(view, element => element.props?.accessibilityLabel?.startsWith('다가오는 약속 '));

test('서버 홈: 7.3 방 목록으로 가장 가까운 약속 카드(서버 값)를 보여주고 누르면 openRoom 과 같은 params 예요', async () => {
    const r = homeRuntime();
    const format = r.load('src/constants/home-mock.ts');
    const near = homeRoom('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2 * HOME_DAY, { name: '가까운 서버 모임', memberCount: 3, maxMembers: 4, selectedStation: roomQueryStation(88001) });
    const far = homeRoom('bbbb0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 9 * HOME_DAY, { name: '먼 서버 모임' });
    const past = homeRoom('cccc0000-cccc-4ccc-8ccc-cccccccccccc', -HOME_DAY, { name: '지난 서버 모임' });
    const none = homeRoom('dddd0000-dddd-4ddd-8ddd-dddddddddddd', null, { name: '시각 없는 모임' });
    r.respond(async () => ok([far, past, none, near]));
    let view = r.view();
    assert.ok(findText(view, '약속을 불러오고 있어요'), '처음에는 카드 자리에 불러오는 중');
    assert.equal(findText(view, '주말 저녁 모임'), null, '가짜 값 없음');
    await settle(); view = r.view();
    assert.deepEqual(r.calls.map(call => [call.options.method, call.url]), [['GET', 'https://example.test/api/v1/rooms']]);
    const card = homeMeetingCard(view);
    assert.equal(card.props.accessibilityLabel, '다가오는 약속 가까운 서버 모임');
    const when = new Date(near.appointmentAt);
    assert.ok(findText(card, format.formatDday(when)));
    assert.ok(findText(card, format.formatMonthDay(when)));
    assert.ok(findText(card, `${format.formatTime(when)} · 서버 역 88001역 · 3/4명`));
    card.props.onPress();
    assert.deepEqual(plain(r.pushes), [{ pathname: '/rooms/[roomId]', params: {
            roomId: near.id, roomName: '가까운 서버 모임', appointmentAt: format.formatAppointmentParam(when), maxMembers: '4',
        } }]);

    // 약속역이 없으면 기존 문구 "약속역 미정"이에요.
    r.respond(async () => ok([{ ...near, selectedStation: null }]));
    r.refocus(); await settle(); view = r.view();
    assert.ok(findText(homeMeetingCard(view), `${format.formatTime(when)} · 약속역 미정 · 3/4명`));
    r.unmount();
});

test('서버 홈: 방 0개·전부 지났거나 시각 없음은 "예정된 약속이 없어요"', async () => {
    for (const rooms of [[], [homeRoom('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa', -HOME_DAY), homeRoom('bbbb0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null)]]) {
        const r = homeRuntime();
        r.respond(async () => ok(rooms));
        r.view(); await settle(); const view = r.view();
        assert.ok(findText(view, '예정된 약속이 없어요'), `${rooms.length}개`);
        assert.equal(homeMeetingCard(view), null);
        findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '예정된 약속이 없어요')).props.onPress();
        assert.deepEqual(plain(r.pushes), ['/rooms']);
        r.unmount();
    }
});

/* ---------- 약속역 후보 제안·목록·삭제·투표 서버 연동 (#101) ---------- */

function proposalItem(overrides = {}) {
    return {
        id: 'proposal-1', station: { id: 88001, name: '서버 역 88001' }, proposedBy: { userId: ROOM_QUERY_OTHER, nickname: '서버 동료' },
        resultId: null, isSelected: false, voteCount: 1, votedByMe: false, createdAt: '2026-11-12T10:00:00+09:00', ...overrides,
    };
}
const proposalList = (items = [proposalItem()], overrides = {}) => ({ selectedStation: null, maxProposals: 9, items, ...overrides });
const proposalCreated = (overrides = {}) => ({ id: 'proposal-new', station: { id: 99002, name: '서버 역 99002' }, proposedBy: { userId: ROOM_QUERY_ME, nickname: '서버 나' }, resultId: null, createdAt: '2026-11-12T11:00:00+09:00', ...overrides });
function proposalRuntime() {
    const r = roomQueryRuntime();
    r.load('src/services/api/client.ts').setAccessTokenProvider(() => 'test-access');
    return r;
}

test('후보 7.14·7.15·7.16·7.17 요청 URL·method·body·인증 헤더, mock 인자 무시', async () => {
    const r = proposalRuntime();
    r.respond(async (url, options) => {
        if (options.method === 'POST') return jsonResponse({ success: true, data: proposalCreated() }, 201);
        if (options.method === 'PUT') return ok({ proposalId: 'p/1', voteCount: 2, votedByMe: true });
        if (options.method === 'DELETE') return ok(null);
        return ok(proposalList());
    });
    const roomId = 'room/1 a';
    const base = 'https://example.test/api/v1/rooms/room%2F1%20a/station-proposals';
    await r.room.fetchProposals(roomId, 'error');
    await r.room.createProposal(roomId, 99002, undefined, 'busy');
    await r.room.createProposal(roomId, 99002, 'result-TIME', 'error');
    await r.room.voteProposal(roomId, 'p/1', 'error');
    assert.equal(await r.room.deleteProposal(roomId, 'p/1'), undefined);
    assert.deepEqual(r.calls.map(call => [call.options.method, call.url]), [
        ['GET', base], ['POST', base], ['POST', base], ['PUT', `${base}/p%2F1/vote`], ['DELETE', `${base}/p%2F1`],
    ]);
    assert.deepEqual(JSON.parse(r.calls[1].options.body), { stationId: 99002 });
    assert.deepEqual(JSON.parse(r.calls[2].options.body), { stationId: 99002, resultId: 'result-TIME' });
    for (const index of [0, 3, 4]) assert.equal(r.calls[index].options.body, undefined);
    assert.ok(r.calls.every(call => call.options.headers.Authorization === 'Bearer test-access'));
    // 서버 모드에서는 제안 전에 역 상세(5.3)로 미리 확인하지 않아요.
    assert.ok(!r.calls.some(call => call.url.includes('/stations/')));
    // 본문이 없는 성공(204 처럼)도 삭제 성공이에요.
    r.respond(async () => ({ ok: true, status: 200, text: async () => '' }));
    assert.equal(await r.room.deleteProposal(roomId, 'p/2'), undefined);
});

test('후보 목록 파서: selectedStation null·{id,name}만 온 역·빈 닉네임·서버 순서 유지', async () => {
    const r = proposalRuntime();
    const data = proposalList([
        proposalItem({ id: 'p-3', createdAt: '2026-11-12T12:00:00+09:00', proposedBy: { userId: 'withdrawn-1', nickname: '' }, resultId: 'result-FARE', isSelected: true, voteCount: 0, extra: 1 }),
        proposalItem({ id: 'p-2', proposedBy: { userId: 'withdrawn-2', nickname: null }, votedByMe: true }),
        proposalItem({ id: 'p-1', proposedBy: { userId: 'withdrawn-3' }, station: { id: 77001, name: '노선 있는 역', isSupported: false, lines: [{ lineId: 2, lineName: '2호선', color: '#00a84d', stationCode: 'x' }, { lineId: 'bad' }] } }),
        proposalItem({ id: 'p-0', proposedBy: null }),
    ]);
    r.respond(async () => ok(data));
    const list = plain(await r.room.fetchProposals(ROOM_QUERY_ID));
    assert.equal(list.selectedStation, null);
    assert.equal(list.maxProposals, 9);
    assert.deepEqual(list.items.map(item => item.id), ['p-3', 'p-2', 'p-1', 'p-0']);
    assert.deepEqual(list.items[0].station, { id: 88001, name: '서버 역 88001', isSupported: true, lines: [] });
    assert.deepEqual(list.items[2].station, { id: 77001, name: '노선 있는 역', isSupported: false, lines: [{ lineId: 2, lineName: '2호선', color: '#00a84d' }] });
    assert.deepEqual(list.items.map(item => item.proposedBy.nickname), ['알 수 없음', '알 수 없음', '알 수 없음', '알 수 없음']);
    assert.deepEqual(list.items.map(item => item.proposedBy.userId), ['withdrawn-1', 'withdrawn-2', 'withdrawn-3', '']);
    assert.deepEqual(list.items.map(item => [item.resultId, item.isSelected, item.voteCount, item.votedByMe]), [
        ['result-FARE', true, 0, false], [null, false, 1, true], [null, false, 1, false], [null, false, 1, false],
    ]);
    assert.equal(Object.hasOwn(list.items[0], 'extra'), false);

    r.respond(async () => ok({ selectedStation: { id: 88001, name: '확정 역' }, items: [proposalItem({ isSelected: true })] }));
    const selected = plain(await r.room.fetchProposals(ROOM_QUERY_ID));
    assert.deepEqual(selected.selectedStation, { id: 88001, name: '확정 역', isSupported: true, lines: [] });
    assert.equal(selected.maxProposals, 9, 'maxProposals 가 없으면 서버 기본값 9');
    r.respond(async () => ok(proposalList([])));
    assert.deepEqual(plain((await r.room.fetchProposals(ROOM_QUERY_ID)).items), []);
});

test('후보 7.14 응답은 isSelected·voteCount·votedByMe 를 false·0·false 로 채우고, 7.17 응답은 그대로, 7.16 data:null 은 정상', async () => {
    const r = proposalRuntime();
    r.respond(async () => jsonResponse({ success: true, data: proposalCreated({ resultId: 'result-TIME', proposedBy: { userId: ROOM_QUERY_ME, nickname: ' ' } }) }, 201));
    assert.deepEqual(plain(await r.room.createProposal(ROOM_QUERY_ID, 99002, 'result-TIME')), {
        id: 'proposal-new', station: { id: 99002, name: '서버 역 99002', isSupported: true, lines: [] },
        proposedBy: { userId: ROOM_QUERY_ME, nickname: '알 수 없음' }, resultId: 'result-TIME',
        isSelected: false, voteCount: 0, votedByMe: false, createdAt: '2026-11-12T11:00:00+09:00',
    });
    r.respond(async () => ok({ proposalId: 'proposal-1', voteCount: 3, votedByMe: true }));
    assert.deepEqual(plain(await r.room.voteProposal(ROOM_QUERY_ID, 'proposal-1')), { proposalId: 'proposal-1', voteCount: 3, votedByMe: true });
    // 같은 후보에 다시 투표해도(멱등) 서버 값 그대로예요.
    assert.deepEqual(plain(await r.room.voteProposal(ROOM_QUERY_ID, 'proposal-1')), { proposalId: 'proposal-1', voteCount: 3, votedByMe: true });
    r.respond(async () => ok(null));
    assert.equal(await r.room.deleteProposal(ROOM_QUERY_ID, 'proposal-1'), undefined);
});

test('후보 서버 오류 코드 매핑과 안내 문구, 모르는 코드 UNKNOWN_ERROR, 인증 오류는 그대로', async () => {
    const r = proposalRuntime();
    const { RoomError } = r.load('src/types/room.ts');
    const { ApiError } = r.load('src/services/api/errors.ts');
    const cases = [
        ['create', 'ALREADY_PROPOSED', 409, '이미 후보에 있는 역이에요. 목록에서 투표해 주세요.'],
        ['create', 'PROPOSAL_LIMIT_EXCEEDED', 422, '약속역 후보는 방당 9개까지예요. 다른 후보를 지운 뒤 제안해 주세요.'],
        ['create', 'STATION_UNSUPPORTED', 422, '아직 지원하지 않는 역이라 후보로 올릴 수 없어요.'],
        ['create', 'STATION_NOT_FOUND', 404, '역을 찾을 수 없어요.'],
        ['create', 'RESULT_NOT_FOUND', 404, '추천 결과를 찾을 수 없어요. 추천을 다시 받은 뒤 제안해 주세요.'],
        ['create', 'ROOM_BUSY', 409, '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.'],
        ['delete', 'NOT_PROPOSAL_OWNER', 403, '후보를 제안한 사람이나 방장만 지울 수 있어요.'],
        ['delete', 'PROPOSAL_NOT_FOUND', 404, '이미 삭제된 후보예요.'],
        ['vote', 'ALREADY_VOTED', 409, '이미 다른 후보에 투표했어요. 투표는 바꾸거나 취소할 수 없어요.'],
        ['vote', 'PROPOSAL_NOT_FOUND', 404, '이미 삭제된 후보예요.'],
        ['vote', 'ROOM_BUSY', 409, '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.'],
        ['list', 'SOMETHING_NEW', 500, '약속역 후보 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'UNKNOWN_ERROR'],
        ['list', 'VALIDATION_ERROR', 400, '약속역 후보 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', 'UNKNOWN_ERROR'],
    ];
    const run = action => action === 'list' ? r.room.fetchProposals(ROOM_QUERY_ID)
        : action === 'create' ? r.room.createProposal(ROOM_QUERY_ID, 99002)
            : action === 'vote' ? r.room.voteProposal(ROOM_QUERY_ID, 'proposal-1') : r.room.deleteProposal(ROOM_QUERY_ID, 'proposal-1');
    for (const [action, code, status, message, expected = code] of cases) {
        r.respond(async () => jsonResponse({ success: false, error: { code, message: '서버 원문' } }, status));
        await assert.rejects(run(action), error => error instanceof RoomError && error.code === expected && error.message === message, `${action} ${code}`);
    }
    for (const [action, message] of [
        ['list', '네트워크 상태를 확인하고 다시 시도해 주세요.'], ['create', '후보를 제안하지 못했어요. 다시 시도해 주세요.'],
        ['vote', '투표하지 못했어요. 다시 시도해 주세요.'], ['delete', '후보를 삭제하지 못했어요. 다시 시도해 주세요.'],
    ]) {
        r.respond(async () => { throw new TypeError('연결 실패'); });
        await assert.rejects(run(action), error => error instanceof RoomError && error.code === 'NETWORK_ERROR' && error.message === message, action);
    }
    // 잘못된 역 ID 는 요청 없이 STATION_NOT_FOUND 예요.
    const before = r.calls.length;
    await assert.rejects(r.room.createProposal(ROOM_QUERY_ID, NaN), { code: 'STATION_NOT_FOUND' });
    assert.equal(r.calls.length, before);
    // 인증 오류는 A-1 처리에 맡겨요(공통 처리가 로그인을 지우므로 마지막에 확인해요).
    r.respond(async () => fail('TOKEN_INVALID'));
    await assert.rejects(r.room.voteProposal(ROOM_QUERY_ID, 'proposal-1'), error => error instanceof ApiError && error.code === 'TOKEN_INVALID');
});

test('후보 응답의 화면 사용 값 누락·형식 오류는 UNKNOWN_ERROR', async () => {
    const r = proposalRuntime();
    let current;
    r.respond(async () => ok(current));
    const listCases = [
        null, [], proposalList({}), { selectedStation: null, maxProposals: 9 }, proposalList([], { maxProposals: '9' }),
        proposalList([], { selectedStation: { id: '1', name: 'x' } }), proposalList([proposalItem(), proposalItem()]),
        ...['id', 'station', 'isSelected', 'voteCount', 'votedByMe', 'createdAt'].map(key => { const item = proposalItem(); delete item[key]; return proposalList([item]); }),
        proposalList([proposalItem({ station: { id: 88001 } })]), proposalList([proposalItem({ voteCount: '1' })]),
        proposalList([proposalItem({ votedByMe: 'false' })]), proposalList([proposalItem({ createdAt: '시각 아님' })]),
    ];
    for (let i = 0; i < listCases.length; i++) {
        current = listCases[i];
        await assert.rejects(r.room.fetchProposals(ROOM_QUERY_ID), { code: 'UNKNOWN_ERROR' }, `목록 변형 ${i}`);
    }
    for (const created of [null, { station: { id: 1, name: 'x' } }, proposalCreated({ station: null }), proposalCreated({ createdAt: undefined })]) {
        current = created;
        await assert.rejects(r.room.createProposal(ROOM_QUERY_ID, 99002), { code: 'UNKNOWN_ERROR' });
    }
    for (const vote of [null, { proposalId: 'p', voteCount: '1', votedByMe: true }, { proposalId: 'p', voteCount: 1 }]) {
        current = vote;
        await assert.rejects(r.room.voteProposal(ROOM_QUERY_ID, 'p'), { code: 'UNKNOWN_ERROR' });
    }
});

test('후보 NOT_ROOM_MEMBER·ROOM_NOT_FOUND 는 그 방 캐시를 비우고 같은 코드로 알려요', async () => {
    for (const [action, code, status] of [['list', 'NOT_ROOM_MEMBER', 403], ['vote', 'ROOM_NOT_FOUND', 404], ['create', 'NOT_ROOM_MEMBER', 403], ['delete', 'ROOM_NOT_FOUND', 404]]) {
        const r = proposalRuntime();
        r.respond(async () => ok(roomQueryDetail()));
        await r.room.fetchRoomDetail(ROOM_QUERY_ID);
        assert.ok(r.room.getMockRoom(ROOM_QUERY_ID));
        r.respond(async () => jsonResponse({ success: false, error: { code } }, status));
        const pending = action === 'list' ? r.room.fetchProposals(ROOM_QUERY_ID) : action === 'vote' ? r.room.voteProposal(ROOM_QUERY_ID, 'p')
            : action === 'create' ? r.room.createProposal(ROOM_QUERY_ID, 99002) : r.room.deleteProposal(ROOM_QUERY_ID, 'p');
        await assert.rejects(pending, error => error instanceof r.load('src/types/room.ts').RoomError && error.code === code);
        assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined, `${action} ${code}`);
    }
});

test('계정이 바뀐 뒤 도착한 이전 후보 응답(성공·403)은 버리고 새 계정의 방 캐시를 지우지 않아요', async () => {
    for (const late of ['success', 'denied']) {
        const r = proposalRuntime();
        let resolveOld;
        r.respond(() => new Promise(resolve => { resolveOld = resolve; }));
        const old = r.room.fetchProposals(ROOM_QUERY_ID);
        const rejected = assert.rejects(old, { code: 'AUTH_REQUIRED' });
        await settle();
        await r.load('src/services/auth.ts').clearLocalSession();
        const nextUser = '33333333-3333-4333-8333-333333333333';
        r.load('src/stores/auth-store.ts').signIn({ userId: nextUser, nickname: '다음 사용자' });
        r.respond(async () => ok(roomQueryDetail('OWNER', nextUser)));
        await r.room.fetchRoomDetail(ROOM_QUERY_ID);
        resolveOld(late === 'success' ? ok(proposalList()) : jsonResponse({ success: false, error: { code: 'NOT_ROOM_MEMBER' } }, 403));
        await rejected;
        assert.ok(r.room.getMockRoom(ROOM_QUERY_ID), late);
    }
});

test('mock 후보 제안·목록·투표·삭제는 기존 동작(중복·상한·바쁨·남의 후보 삭제 불가)을 유지하고 서버를 부르지 않아요', async () => {
    const r = createRuntime(); const room = r.load('src/services/room.ts'); let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    const list = await finishRoomMock(r, room.fetchProposals('room-2'));
    assert.deepEqual(plain(list.items.map(item => item.station.id)), [116, 115, 114]);
    assert.ok(list.items.every(item => item.station.lines.length > 0));
    await finishRoomMock(r, assert.rejects(room.fetchProposals('room-2', 'error'), { code: 'NETWORK_ERROR' }));
    await finishRoomMock(r, assert.rejects(room.createProposal('room-2', 115), { code: 'ALREADY_PROPOSED', message: '성수역은 이미 후보에 있어요.' }));
    await finishRoomMock(r, assert.rejects(room.createProposal('room-2', 101, undefined, 'busy'), { code: 'ROOM_BUSY' }));
    const created = await finishRoomMock(r, room.createProposal('room-2', 101, 'mock-result'));
    assert.equal(created.resultId, 'mock-result'); assert.equal(created.voteCount, 0);
    const proposals = (await finishRoomMock(r, room.fetchProposals('room-2'))).items;
    const others = proposals.filter(item => item.proposedBy.userId !== room.getMyUserId());
    assert.equal((await finishRoomMock(r, room.voteProposal('room-2', others[0].id))).votedByMe, true);
    await finishRoomMock(r, assert.rejects(room.voteProposal('room-2', others[1].id), { code: 'ALREADY_VOTED' }));
    await finishRoomMock(r, assert.rejects(room.deleteProposal('room-2', others[0].id), { code: 'NOT_PROPOSAL_OWNER' }));
    room.mockFillProposals('room-2');
    await finishRoomMock(r, assert.rejects(room.createProposal('room-2', 125), { code: 'PROPOSAL_LIMIT_EXCEEDED' }));
    assert.equal(calls, 0);
});

/** 후보 패널만 구동해요(서버 모드). 실제 React·브라우저 렌더링을 대신하지 않아요. */
function proposalPanelRuntime({ isOwner, list, respond }) {
    const r = createScreenRuntime(serverEnv, 'src/components/rooms/proposal-panel.tsx');
    r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_ME, nickname: '서버 나' });
    r.calls = [];
    r.context.fetch = async (url, options) => { r.calls.push({ url, options }); return respond(url, options); };
    let reloads = 0;
    const props = () => ({
        roomId: ROOM_QUERY_ID, roomName: '서버 모임', isOwner, myUserId: ROOM_QUERY_ME, memberCount: 2,
        state: { status: 'ready', list }, onReload: async () => { reloads++; }, onConfirm() {}, confirmBusy: false, onOpenRecommendations() {},
    });
    r.view = () => r.renderComponent({ type: r.screen.default, props: props() });
    r.reloads = () => reloads;
    return r;
}

test('후보 패널(서버): 방장은 남의 후보도 삭제 버튼, 멤버는 내 후보만, 삭제는 7.16 뒤 목록 재조회, 닉네임 없음 표시', async () => {
    const list = { selectedStation: null, maxProposals: 9, items: [
            { ...proposalItem({ id: 'mine', proposedBy: { userId: ROOM_QUERY_ME, nickname: '서버 나' }, station: { id: 1, name: '내 역' } }), station: { id: 1, name: '내 역', isSupported: true, lines: [] } },
            { ...proposalItem({ id: 'other', station: { id: 2, name: '남의 역' } }), station: { id: 2, name: '남의 역', isSupported: true, lines: [] } },
            { ...proposalItem({ id: 'gone', proposedBy: { userId: 'withdrawn', nickname: '알 수 없음' }, station: { id: 3, name: '탈퇴자 역' } }), station: { id: 3, name: '탈퇴자 역', isSupported: true, lines: [] } },
        ] };
    for (const isOwner of [true, false]) {
        const r = proposalPanelRuntime({ isOwner, list, respond: async () => ok(null) });
        let view = r.view();
        const deleteOf = name => findElement(view, element => element.props?.accessibilityLabel === `${name} 후보 삭제`);
        assert.ok(deleteOf('내 역'), '내 후보는 항상 삭제 가능');
        assert.equal(!!deleteOf('남의 역'), isOwner);
        assert.equal(!!deleteOf('탈퇴자 역'), isOwner);
        assert.ok(findText(view, '알 수 없음 제안'));
        assert.ok(findText(view, '서버 동료님 제안'));
        if (isOwner) assert.ok(findTextIncluding(view, '참고용'), '방장 안내의 참고용 문구 유지');
        else {
            // 멤버는 투표 확인 시트에서 참고용 안내를 봐요.
            findElement(view, element => element.type === 'Pressable' && element.props?.accessibilityLabel?.startsWith('남의 역 1표')).props.onPress();
            assert.ok(findTextIncluding(r.view(), '투표 결과는 참고용이고'), '투표 시트의 참고용 문구 유지');
        }
        assert.equal(findElement(view, element => element.props?.style?.backgroundColor && element.type === 'View' && element.props?.children?.type === 'Text' && /호선|^\d$/.test(textOf(element))), null, '노선 배지 없음');
        if (isOwner) {
            deleteOf('남의 역').props.onPress(); view = r.view();
            findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '삭제')).props.onPress();
            await settle(); await settle(); view = r.view();
            assert.deepEqual(r.calls.map(call => [call.options.method, call.url.split('/station-proposals')[1]]), [['DELETE', '/other']]);
            assert.equal(r.reloads(), 1);
            assert.ok(findText(view, '남의 역 후보를 삭제했어요.'));
        }
        r.unmount();
    }
});

test('서버 홈: 서버 오류는 안내와 다시 시도, 다른 기능 버튼은 그대로, 인증 오류는 안내 없음', async () => {
    const r = homeRuntime();
    r.respond(async () => jsonResponse({ success: false, error: { code: 'INTERNAL_ERROR' } }, 500));
    r.view(); await settle(); let view = r.view();
    assert.ok(findText(view, '약속을 불러오지 못했어요'));
    assert.ok(findElement(view, element => element.type === 'Pressable' && element.props.accessibilityLabel === '경로 탐색'));
    for (const title of ['AI 표지판 방향 확인', '약속방']) {
        const feature = findElement(view, element => typeof element.type === 'function' && element.props?.title === title);
        assert.ok(feature, title);
        feature.props.onPress();
    }
    findElement(view, element => element.props?.accessibilityLabel === '경로 탐색').props.onPress();
    assert.deepEqual(plain(r.pushes), ['/ai-direction', '/rooms', '/route-search']);
    r.respond(async () => ok([homeRoom('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa', HOME_DAY, { name: '다시 불러온 모임' })]));
    findElement(view, element => element.props?.accessibilityLabel === '다가오는 약속 다시 불러오기').props.onPress();
    view = r.view();
    assert.ok(findText(view, '약속을 불러오고 있어요'), '다시 시도 중에는 불러오는 중');
    await settle(); view = r.view();
    assert.equal(homeMeetingCard(view).props.accessibilityLabel, '다가오는 약속 다시 불러온 모임');
    r.unmount();

    for (const response of [fail('TOKEN_INVALID'), fail('TOKEN_EXPIRED')]) {
        const auth = homeRuntime();
        auth.respond(async () => response);
        auth.view(); await settle(); await settle(); const authView = auth.view();
        assert.equal(findText(authView, '약속을 불러오지 못했어요'), null, '인증 오류는 화면 안내 없음');
        auth.unmount();
    }
});

test('서버 홈: 다시 들어와도 보여주던 카드를 로딩으로 되돌리지 않고, 떠난 뒤 온 응답은 무시해요', async () => {
    const r = homeRuntime();
    r.respond(async () => ok([homeRoom('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa', HOME_DAY, { name: '처음 모임' })]));
    r.view(); await settle();
    let resolveNext;
    r.respond(() => new Promise(resolve => { resolveNext = resolve; }));
    r.refocus(); let view = r.view(); await settle();
    assert.equal(r.calls.length, 2, '들어올 때마다 다시 조회');
    assert.equal(homeMeetingCard(view).props.accessibilityLabel, '다가오는 약속 처음 모임', '다시 조회 중에도 이전 카드 유지');
    assert.equal(findText(view, '약속을 불러오고 있어요'), null);
    resolveNext(ok([homeRoom('bbbb0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb', HOME_DAY / 2, { name: '새 모임' })]));
    await settle(); view = r.view();
    assert.equal(homeMeetingCard(view).props.accessibilityLabel, '다가오는 약속 새 모임');

    // 화면을 떠난 뒤 온 응답은 반영하지 않아요.
    r.respond(() => new Promise(resolve => { resolveNext = resolve; }));
    r.refocus(); await settle();
    assert.equal(r.calls.length, 3);
    r.unmount();
    resolveNext(ok([homeRoom('cccc0000-cccc-4ccc-8ccc-cccccccccccc', HOME_DAY / 4, { name: '떠난 뒤 응답' })]));
    await settle(); view = r.view();
    assert.equal(homeMeetingCard(view).props.accessibilityLabel, '다가오는 약속 새 모임');
});

test('서버 홈: 계정이 바뀌면 다시 불러오기 전에도 이전 계정의 방을 보여주지 않아요', async () => {
    const r = homeRuntime();
    r.respond(async () => ok([homeRoom('aaaa0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa', HOME_DAY, { name: '이전 계정 모임' })]));
    r.view(); await settle();
    assert.ok(homeMeetingCard(r.view()));
    await r.load('src/services/auth.ts').clearLocalSession();
    const nextUser = '33333333-3333-4333-8333-333333333333';
    r.load('src/stores/auth-store.ts').signIn({ userId: nextUser, nickname: '다음 사용자' });
    let view = r.view();
    assert.equal(findText(view, '이전 계정 모임'), null);
    assert.equal(homeMeetingCard(view), null);
    assert.ok(findText(view, '약속을 불러오고 있어요'));
    r.respond(async () => ok([roomQuerySummary({ id: 'eeee0000-eeee-4eee-8eee-eeeeeeeeeeee', name: '다음 계정 모임', appointmentAt: new Date(Date.now() + HOME_DAY).toISOString() })]));
    r.refocus(); await settle(); view = r.view();
    assert.equal(homeMeetingCard(view).props.accessibilityLabel, '다가오는 약속 다음 계정 모임');

    // 이전 계정 때 보낸 요청이 늦게 와도 새 계정 화면에 섞이지 않아요.
    let resolveOld;
    r.respond(() => new Promise(resolve => { resolveOld = resolve; }));
    r.refocus();
    await r.load('src/services/auth.ts').clearLocalSession();
    r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_ME, nickname: '서버 나' });
    resolveOld(ok([homeRoom('ffff0000-ffff-4fff-8fff-ffffffffffff', HOME_DAY, { name: '늦은 이전 응답' })]));
    await settle(); view = r.view();
    assert.equal(findText(view, '늦은 이전 응답'), null);
    assert.equal(homeMeetingCard(view), null);
    r.unmount();
});

test('mock 홈은 HOME_UPCOMING_MEETING 그대로이고 서버를 부르지 않아요', async () => {
    const r = homeRuntime({});
    r.respond(async () => { throw Error('서버를 부르면 안 돼요'); });
    const { HOME_UPCOMING_MEETING, formatAppointmentParam, formatDday, formatMonthDay, formatTime } = r.load('src/constants/home-mock.ts');
    let view = r.view(); await settle(); view = r.view();
    const card = homeMeetingCard(view);
    assert.equal(card.props.accessibilityLabel, `다가오는 약속 ${HOME_UPCOMING_MEETING.title}`);
    assert.ok(findText(card, formatDday(HOME_UPCOMING_MEETING.appointmentAt)));
    assert.ok(findText(card, formatMonthDay(HOME_UPCOMING_MEETING.appointmentAt)));
    assert.ok(findText(card, `${formatTime(HOME_UPCOMING_MEETING.appointmentAt)} · 시청역 · 3/4명`));
    assert.equal(findText(view, '약속을 불러오고 있어요'), null);
    card.props.onPress();
    assert.deepEqual(plain(r.pushes), [{ pathname: '/rooms/[roomId]', params: {
            roomId: 'preview', roomName: '주말 저녁 모임', appointmentAt: formatAppointmentParam(HOME_UPCOMING_MEETING.appointmentAt), maxMembers: '4',
        } }]);
    r.refocus(); await settle();
    assert.equal(r.calls.length, 0);
    r.unmount();
});

test('후보 패널(서버): 9개 초과·중복 제안·남의 후보 삭제·이미 투표 오류 문구를 보여주고 목록을 다시 맞춰요', async () => {
    const list = { selectedStation: null, maxProposals: 9, items: [
            { ...proposalItem({ id: 'other' }), station: { id: 2, name: '남의 역', isSupported: true, lines: [] } },
        ] };
    const cases = [
        ['propose', 'PROPOSAL_LIMIT_EXCEEDED', 422, '약속역 후보는 방당 9개까지예요. 다른 후보를 지운 뒤 제안해 주세요.'],
        ['propose', 'ALREADY_PROPOSED', 409, '이미 후보에 있는 역이에요. 목록에서 투표해 주세요.'],
        ['delete', 'NOT_PROPOSAL_OWNER', 403, '후보를 제안한 사람이나 방장만 지울 수 있어요.'],
        ['vote', 'ALREADY_VOTED', 409, '이미 다른 후보에 투표했어요. 투표는 바꾸거나 취소할 수 없어요.'],
        ['vote', 'TOKEN_INVALID', 401, null],
    ];
    for (const [action, code, status, message] of cases) {
        // 방장이 아닌데 목록이 오래되어 서버가 거절하는 경우를 보려고 삭제는 방장 화면으로 눌러요.
        const r = proposalPanelRuntime({ isOwner: action === 'delete', list, respond: async () => jsonResponse({ success: false, error: { code } }, status) });
        r.load('src/app/station-search.tsx').openStationPicker = (_options, onPick) => { void onPick({ id: 99002, name: '서버 역 99002', isSupported: true, lines: [] }); };
        let view = r.view();
        if (action === 'propose') {
            findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '역 검색해서 제안')).props.onPress();
        } else {
            const target = action === 'delete'
                ? findElement(view, element => element.props?.accessibilityLabel === '남의 역 후보 삭제')
                : findElement(view, element => element.type === 'Pressable' && element.props?.accessibilityLabel?.startsWith('남의 역 1표'));
            target.props.onPress(); view = r.view();
            findElement(view, element => element.type === 'Pressable' && findText(element.props.children, action === 'vote' ? '투표하기' : '삭제')).props.onPress();
        }
        await settle(); await settle(); view = r.view();
        if (message) {
            assert.ok(findText(view, message), code);
            assert.equal(r.reloads(), 1, `${code} 뒤 서버 목록 재조회`);
        } else {
            assert.equal(findTextIncluding(view, '투표하지 못했어요'), null, '인증 오류는 중복 안내하지 않아요');
            assert.equal(r.reloads(), 0);
        }
        r.unmount();
    }
});

test('추천 화면에서 올린 후보가 방 상세 후보 패널의 서버 목록에도 같은 내용으로 보여요', async () => {
    // 작은 가짜 서버: 7.14 로 받은 제안을 7.15 목록에 최신순으로 돌려줘요.
    const server = [proposalItem({ id: 'seed', createdAt: '2026-11-12T09:00:00+09:00' })];
    const detail = roomQueryDetail(); detail.members[1].departureStation = roomQueryStation(99002);
    const respond = async (url, options) => {
        if (url.includes('/station-proposals')) {
            if (options.method === 'POST') {
                const body = JSON.parse(options.body);
                const created = proposalCreated({ id: `p-${body.stationId}`, station: { id: body.stationId, name: `서버 추천역 ${body.stationId}` }, resultId: body.resultId ?? null });
                server.unshift({ ...created, isSelected: false, voteCount: 0, votedByMe: false });
                return jsonResponse({ success: true, data: created }, 201);
            }
            return ok(proposalList([...server]));
        }
        if (url.includes('/recommendations')) return ok(recoRun());
        if (url.includes('/stations/')) return ok(recoStation(Number(url.split('/').at(-1))));
        return ok(detail);
    };
    const reco = recoScreen();
    reco.context.fetch = async (url, options) => { reco.calls.push({ url, options }); return respond(url, options); };
    let view = await pumpScreen(reco);
    findElement(view, element => element.type === 'Pressable' && findText(element.props.children, '이 역으로 약속방에 공유')).props.onPress();
    view = await pumpScreen(reco);
    const post = reco.calls.find(call => call.options.method === 'POST' && call.url.includes('/station-proposals'));
    assert.deepEqual(JSON.parse(post.options.body), { stationId: 77001, resultId: 'result-TIME' });
    assert.ok(findText(view, '이미 약속역 후보에 있어요'), '공유 뒤 7.15 로 다시 맞춘 목록 기준');
    reco.unmount();

    const room = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID, tab: 'vote' });
    room.context.fetch = async (url, options) => respond(url, options);
    room.render(); await settle(); room.advance(1000); await settle(); view = room.render();
    const panel = findElement(view, element => element.props?.state?.status === 'ready' && element.props?.roomId === ROOM_QUERY_ID);
    assert.ok(panel, '방 상세 후보 패널');
    assert.deepEqual(plain(panel.props.state.list.items.map(item => [item.id, item.station.id, item.resultId])), [['p-77001', 77001, 'result-TIME'], ['seed', 88001, null]]);
    room.unmount();
});

test('방 상세: 후보 목록이 NOT_ROOM_MEMBER 면 방 캐시를 비우고 기존 접근 불가 화면, 인증 오류는 패널 안내 없음', async () => {
    for (const [code, status] of [['NOT_ROOM_MEMBER', 403], ['ROOM_NOT_FOUND', 404], ['TOKEN_INVALID', 401]]) {
        const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID, tab: 'vote' });
        r.context.fetch = async url => url.includes('/station-proposals')
            ? jsonResponse({ success: false, error: { code } }, status) : ok(roomQueryDetail());
        r.render(); await settle(); r.advance(1000); await settle(); const view = r.render();
        if (status === 401) {
            assert.equal(findElement(view, element => element.props?.error), null);
            assert.equal(findElement(view, element => element.props?.state?.status === 'error'), null, '패널 오류 안내 없음');
        } else {
            assert.ok(findElement(view, element => element.props?.error === code), code);
            assert.equal(r.load('src/services/room.ts').getMockRoom(ROOM_QUERY_ID), undefined, '방 캐시 비움');
        }
        r.unmount();
    }
});

const settings106Url = `https://example.test/api/v1/rooms/${ROOM_QUERY_ID}`;
function settings106Seed(r, role = 'OWNER') {
    r.roomCache.cacheRoomDetail({ ...roomQueryDetail(role), memberCount: 2 }, r.roomCache.getRoomCacheScope());
}

test('106 초대 코드는 캐시 없이 서버 GET·인증으로 조회하고 새 방장도 현재 서버 권한으로 확인해요', async () => {
    const r = roomQueryRuntime();
    r.load('src/services/api/client.ts').setAccessTokenProvider(() => 'test-access');
    r.respond(async () => jsonResponse({ success: true, data: { roomCode: 'NEW123' } }));
    assert.deepEqual(plain(await r.room.fetchInviteCode(ROOM_QUERY_ID, 'error')), { roomCode: 'NEW123' });
    assert.equal(r.calls[0].url, `${settings106Url}/invite-code`);
    assert.equal(r.calls[0].options.method, 'GET');
    assert.equal(r.calls[0].options.headers.Authorization, 'Bearer test-access');
    settings106Seed(r, 'MEMBER'); // 캐시 역할이 과거 값이어도 서버가 최종 판단해요.
    assert.deepEqual(plain(await r.room.fetchInviteCode(ROOM_QUERY_ID)), { roomCode: 'NEW123' });
    assert.equal(r.calls.length, 2);
    assert.deepEqual(plain(await r.room.fetchInviteCode('room/1 a')), { roomCode: 'NEW123' });
    assert.ok(r.calls.at(-1).url.endsWith('/rooms/room%2F1%20a/invite-code'));
});

test('106 초대 코드 형식 오류는 UNKNOWN_ERROR이며 권한 상실은 이전 코드를 제거해요', async () => {
    const r = roomQueryRuntime(); settings106Seed(r);
    for (const data of [{}, null, [], { roomCode: 123456 }, { roomCode: 'abc123' }, { roomCode: 'ABC1234' }]) {
        r.respond(async () => jsonResponse({ success: true, data }));
        await assert.rejects(r.room.fetchInviteCode(ROOM_QUERY_ID), { code: 'UNKNOWN_ERROR' });
    }
    r.roomCache.cacheRoomInviteCode(ROOM_QUERY_ID, 'OLD123', r.roomCache.getRoomCacheScope());
    r.respond(async () => jsonResponse({ success: false, error: { code: 'NOT_ROOM_OWNER' } }, 403));
    await assert.rejects(r.room.fetchInviteCode(ROOM_QUERY_ID), { code: 'NOT_ROOM_OWNER' });
    assert.equal(r.roomCache.readCachedRoomCode(ROOM_QUERY_ID), undefined);
});

test('106 출발역 PATCH는 서버 ID 하나만 보내고 null 응답 뒤 실제 멤버를 재조회하며 객체를 반환하지 않아요', async () => {
    const r = roomQueryRuntime(); settings106Seed(r);
    const members = roomQueryMembers(); members[0].departureStation = roomQueryStation(99001);
    r.respond(async (_url, options) => jsonResponse({ success: true, data: options.method === 'PATCH' ? null : members }));
    assert.equal(await r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId: 99001, userId: 'ignored' }, 'error'), undefined);
    assert.deepEqual(r.calls.map(call => [call.url, call.options.method]), [[`${settings106Url}/members/me`, 'PATCH'], [`${settings106Url}/members`, 'GET']]);
    assert.deepEqual(JSON.parse(r.calls[0].options.body), { departureStationId: 99001 });
    assert.equal(r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID).members[0].departureStation.id, 99001);
    assert.equal(r.room.getMockMembers(ROOM_QUERY_ID)[0].departureStation.id, 99001);
});

test('106 출발역의 null·생략·문자열·소수·안전하지 않은 정수는 PATCH 전에 거절해요', async () => {
    const r = roomQueryRuntime();
    for (const departureStationId of [null, undefined, '99001', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(r.calls.length, 0);
});

test('106 방 수정은 선택 필드·빈 body·시각 null·UTC를 보내고 재조회한 상세·목록을 반영해요', async () => {
    const r = roomQueryRuntime(); let detail = roomQueryDetail();
    detail.status = 'CONFIRMED'; detail.selectedStation = roomQueryStation(); detail.confirmedAt = '2026-11-01T00:00:00Z';
    const initialStation = plain(detail.selectedStation);
    const cases = [[{}, {}], [{ name: '  바뀐 이름  ', maxMembers: 9 }, { name: '바뀐 이름' }],
        [{ appointmentAt: null }, { appointmentAt: null }],
        [{ appointmentAt: '2035-02-10T19:30:00+09:00' }, { appointmentAt: '2035-02-10T10:30:00.000Z' }]];
    for (const [input, expected] of cases) {
        r.calls.length = 0;
        r.respond(async (_url, options) => {
            if (options.method === 'PATCH') { detail = { ...detail, ...JSON.parse(options.body) }; return jsonResponse({ success: true, data: null }); }
            return jsonResponse({ success: true, data: detail });
        });
        assert.equal(await r.room.updateRoom(ROOM_QUERY_ID, input, 'busy'), undefined);
        assert.deepEqual(JSON.parse(r.calls[0].options.body), expected);
        assert.deepEqual(r.calls.map(call => [call.url, call.options.method]), [[settings106Url, 'PATCH'], [settings106Url, 'GET']]);
        const cached = r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID);
        assert.equal(cached.name, detail.name); assert.equal(cached.appointmentAt, detail.appointmentAt);
        assert.deepEqual(plain(cached.selectedStation), initialStation);
        assert.equal(cached.confirmedAt, '2026-11-01T00:00:00Z');
        assert.equal(r.roomCache.readCachedRooms()[0].name, detail.name);
        assert.equal(r.calls.some(call => /recommendations|proposals|vote|selected-station/.test(call.url)), false);
    }
});

test('106 잘못된 이름·시각·과거 시각은 요청 전에 거절하고 이름만 수정할 때 과거 약속은 보내지 않아요', async () => {
    const r = roomQueryRuntime();
    for (const input of [{ name: null }, { name: 12 }, { name: '' }, { name: ' ' }, { name: '😀'.repeat(31) },
        { appointmentAt: '2035-02-10T19:30:00' }, { appointmentAt: '2035-02-30T19:30:00Z' }, { appointmentAt: 123 }, { appointmentAt: '2000-01-01T00:00:00Z' }]) {
        await assert.rejects(r.room.updateRoom(ROOM_QUERY_ID, input), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(r.calls.length, 0);
    r.respond(async (_url, options) => jsonResponse({ success: true, data: options.method === 'PATCH' ? null : { ...roomQueryDetail(), appointmentAt: '2000-01-01T00:00:00Z' } }));
    await r.room.updateRoom(ROOM_QUERY_ID, { name: '😀'.repeat(30) });
    assert.deepEqual(JSON.parse(r.calls[0].options.body), { name: '😀'.repeat(30) });
});

test('106 두 PATCH의 null 아닌 성공 응답은 UNKNOWN_ERROR이고 가짜 결과를 만들지 않아요', async () => {
    for (const update of ['room', 'departure']) {
        for (const data of [{}, [], { id: ROOM_QUERY_ID }, 'ok']) {
            const r = roomQueryRuntime(); r.respond(async () => jsonResponse({ success: true, data }));
            await assert.rejects(update === 'room' ? r.room.updateRoom(ROOM_QUERY_ID, {}) : r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId: 99001 }), { code: 'UNKNOWN_ERROR' });
            assert.equal(r.calls.length, 1); assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined);
        }
    }
});

test('106 세 API의 403·404·409·422·400과 TOKEN 오류를 구분하고 비멤버·없는 방 캐시를 비워요', async () => {
    for (const operation of ['invite', 'room', 'departure']) {
        for (const [code, status] of [['NOT_ROOM_OWNER', 403], ['NOT_ROOM_MEMBER', 403], ['ROOM_NOT_FOUND', 404], ['STATION_NOT_FOUND', 404],
            ['ROOM_BUSY', 409], ['STATION_UNSUPPORTED', 422], ['VALIDATION_ERROR', 400], ['TOKEN_INVALID', 401], ['TOKEN_FUTURE', 401]]) {
            const r = roomQueryRuntime(); settings106Seed(r);
            r.load('src/services/api/client.ts').setTokenRefresher(null);
            r.respond(async () => jsonResponse({ success: false, error: { code } }, status));
            const pending = operation === 'invite' ? r.room.fetchInviteCode(ROOM_QUERY_ID)
                : operation === 'room' ? r.room.updateRoom(ROOM_QUERY_ID, {}) : r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId: 99001 });
            await assert.rejects(pending, error => error.code === code && (status !== 401 || error instanceof r.load('src/services/api/errors.ts').ApiError));
            assert.equal(r.calls.length, 1);
            if (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') assert.equal(r.room.getMockRoom(ROOM_QUERY_ID), undefined);
        }
    }
});

test('106 네트워크·10초 초과는 NETWORK_ERROR이고 저장·조회 자동 재시도는 추가하지 않아요', async () => {
    for (const operation of ['invite', 'room', 'departure']) {
        for (const timeout of [false, true]) {
            const r = roomQueryRuntime();
            r.respond((_url, options) => timeout ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error()))) : Promise.reject(Error()));
            const pending = operation === 'invite' ? r.room.fetchInviteCode(ROOM_QUERY_ID)
                : operation === 'room' ? r.room.updateRoom(ROOM_QUERY_ID, {}) : r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId: 99001 });
            const rejected = assert.rejects(pending, { code: 'NETWORK_ERROR' }); await settle();
            if (timeout) { assert.equal([...r.timers.values()][0].ms, 10000); r.advance(10000); }
            await rejected; assert.equal(r.calls.length, 1);
        }
    }
});

test('106 PATCH 성공 뒤 재조회 실패는 저장 완료를 알리고 요청값으로 캐시를 덮지 않아요', async () => {
    for (const operation of ['room', 'departure']) {
        const r = roomQueryRuntime(); settings106Seed(r);
        r.respond(async (_url, options) => { if (options.method === 'PATCH') return jsonResponse({ success: true, data: null }); throw Error(); });
        const pending = operation === 'room' ? r.room.updateRoom(ROOM_QUERY_ID, { name: '새 이름' }) : r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId: 99001 });
        await assert.rejects(pending, error => error.code === 'NETWORK_ERROR' && error.message.includes('변경은 저장했지만'));
        assert.equal(r.calls.filter(call => call.options.method === 'PATCH').length, 1);
        assert.equal(r.room.getMockRoom(ROOM_QUERY_ID).name, '서버 모임');
    }
});

test('106 계정 변경 후 늦은 초대 조회·PATCH 성공·오류가 새 계정 캐시를 바꾸지 않아요', async () => {
    for (const operation of ['invite', 'room', 'departure']) {
        for (const fail of [false, true]) {
            const r = roomQueryRuntime(); let resolve;
            r.respond(() => new Promise(done => { resolve = done; }));
            const pending = operation === 'invite' ? r.room.fetchInviteCode(ROOM_QUERY_ID)
                : operation === 'room' ? r.room.updateRoom(ROOM_QUERY_ID, {}) : r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId: 99001 });
            const rejected = assert.rejects(pending, { code: 'AUTH_REQUIRED' }); await settle();
            await r.load('src/services/auth.ts').clearLocalSession();
            r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '새 계정' });
            resolve(fail ? jsonResponse({ success: false, error: { code: 'ROOM_BUSY' } }, 409)
                : jsonResponse({ success: true, data: operation === 'invite' ? { roomCode: 'OLD123' } : null }));
            await rejected; assert.deepEqual(plain(r.roomCache.readCachedRooms()), []);
            assert.equal(r.roomCache.findCachedRoomIdByCode('OLD123'), undefined);
        }
    }
});

test('106 PATCH 이전의 늦은 멤버 조회가 갱신된 출발역을 덮지 않아요', async () => {
    const r = roomQueryRuntime(); let resolveOld; let reads = 0;
    r.respond(async (_url, options) => {
        if (options.method === 'PATCH') return jsonResponse({ success: true, data: null });
        reads++;
        if (reads === 1) return await new Promise(done => { resolveOld = done; });
        const members = roomQueryMembers(); members[0].departureStation = roomQueryStation(99001);
        return jsonResponse({ success: true, data: members });
    });
    const old = r.room.fetchRoomMembers(ROOM_QUERY_ID); await settle();
    await r.room.updateMyDeparture(ROOM_QUERY_ID, { departureStationId: 99001 });
    resolveOld(jsonResponse({ success: true, data: roomQueryMembers() })); await old;
    assert.equal(reads, 2); assert.equal(r.room.getMockMembers(ROOM_QUERY_ID)[0].departureStation.id, 99001);
});

test('106 세 함수의 mock 반환·권한·실패 후 재시도는 서버 호출 없이 유지해요', async () => {
    const r = createRuntime(); const room = r.load('src/services/room.ts'); let calls = 0;
    r.context.fetch = async () => { calls++; throw Error(); };
    assert.equal((await finishRoomMock(r, room.fetchInviteCode('room-4'))).roomCode, 'B8N3TD');
    const updated = await finishRoomMock(r, room.updateMyDeparture('room-4', { departureStationId: 105 }));
    assert.equal(updated.departureStation.id, 105);
    assert.equal((await finishRoomMock(r, room.updateRoom('room-4', { name: '  mock 변경  ', appointmentAt: null }))).name, 'mock 변경');
    const rejected = assert.rejects(room.updateRoom('room-4', { name: '재시도' }, 'busy'), { code: 'ROOM_BUSY' }); await finishRoomMock(r, rejected);
    assert.equal((await finishRoomMock(r, room.updateRoom('room-4', { name: '재시도' }))).name, '재시도');
    const forbidden = assert.rejects(room.fetchInviteCode('room-2'), { code: 'NOT_ROOM_OWNER' }); await finishRoomMock(r, forbidden);
    assert.equal(calls, 0);
});

test('106 수정 화면은 이름만 바꾸면 시각의 초를 보존하고 연타를 한 번만 보내요', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID });
    let detail = { ...roomQueryDetail(), appointmentAt: '2035-02-10T10:30:45.123Z' }; let resolve; const calls = [];
    r.context.fetch = async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'PATCH') return await new Promise(done => { resolve = done; });
        return jsonResponse({ success: true, data: detail });
    };
    r.render(); await settle(); let view = r.render();
    assert.equal(roomWriteButton(view, '저장').props.disabled, true);
    findElement(view, element => element.props?.accessibilityLabel === '약속 이름').props.onChangeText(' 새 이름 ');
    view = r.render(); const save = roomWriteButton(view, '저장');
    const first = save.props.onPress(); const second = save.props.onPress(); await settle();
    const patches = calls.filter(call => call.options.method === 'PATCH');
    assert.equal(patches.length, 1); assert.deepEqual(JSON.parse(patches[0].options.body), { name: '새 이름' });
    detail = { ...detail, name: '새 이름' }; resolve(jsonResponse({ success: true, data: null })); await Promise.all([first, second]);
    assert.equal(r.load('src/services/room-cache.ts').readCachedRoomDetail(ROOM_QUERY_ID).appointmentAt, detail.appointmentAt);
    r.unmount();
});

test('106 수정 화면의 시각 해제는 null만 보내고 이름은 유지해요', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID }); const calls = []; let detail = roomQueryDetail();
    r.context.fetch = async (_url, options) => {
        if (options.method === 'PATCH') { calls.push(JSON.parse(options.body)); detail = { ...detail, appointmentAt: null }; return jsonResponse({ success: true, data: null }); }
        return jsonResponse({ success: true, data: detail });
    };
    r.render(); await settle(); let view = r.render();
    findElement(view, element => element.props?.accessibilityLabel === '약속 시각 해제').props.onPress(); view = r.render();
    await roomWriteButton(view, '저장').props.onPress();
    assert.deepEqual(calls, [{ appointmentAt: null }]); r.unmount();
});

test('106 수정 중 권한 상실·비멤버·처리 중·인증 오류는 구분하고 입력을 유지해요', async () => {
    for (const code of ['NOT_ROOM_OWNER', 'NOT_ROOM_MEMBER', 'ROOM_BUSY', 'TOKEN_INVALID']) {
        const r = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID }); const routes = [];
        r.external['expo-router'].router.replace = route => routes.push(route);
        r.context.fetch = async (_url, options) => options.method === 'PATCH'
            ? jsonResponse({ success: false, error: { code } }, code === 'TOKEN_INVALID' ? 401 : code === 'ROOM_BUSY' ? 409 : 403)
            : jsonResponse({ success: true, data: roomQueryDetail() });
        r.render(); await settle(); let view = r.render();
        findElement(view, element => element.props?.accessibilityLabel === '약속 이름').props.onChangeText('입력 유지'); view = r.render();
        await roomWriteButton(view, '저장').props.onPress(); view = r.render();
        if (code === 'NOT_ROOM_OWNER') assert.ok(findElement(view, element => element.props?.children === '방장만 수정할 수 있어요'));
        if (code === 'NOT_ROOM_MEMBER') { assert.ok(routes.includes('/rooms')); assert.equal(r.load('src/services/room-cache.ts').readCachedRoom(ROOM_QUERY_ID), undefined); }
        if (code === 'ROOM_BUSY') { assert.equal(findElement(view, element => element.props?.accessibilityLabel === '약속 이름').props.value, '입력 유지'); assert.ok(roomWriteButton(view, '다시 시도')); }
        if (code === 'TOKEN_INVALID') assert.equal(findElement(view, element => element.props?.children === '변경 내용을 저장하지 못했어요. 다시 시도해 주세요.'), null);
        r.unmount();
    }
});

test('106 수정 화면 이탈 뒤 저장 응답과 예약 이동은 이전 화면을 바꾸지 않아요', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID }); let resolve; const routes = [];
    r.external['expo-router'].router.replace = route => routes.push(route);
    r.context.fetch = async (_url, options) => options.method === 'PATCH' ? await new Promise(done => { resolve = done; }) : jsonResponse({ success: true, data: roomQueryDetail() });
    r.render(); await settle(); let view = r.render(); findElement(view, element => element.props?.accessibilityLabel === '약속 이름').props.onChangeText('새 이름');
    view = r.render(); const pending = roomWriteButton(view, '저장').props.onPress(); await settle(); r.unmount();
    resolve(jsonResponse({ success: true, data: null })); await pending; r.advance(1000);
    assert.equal(routes.length, 0);
});

test('106 초대 시트의 로딩·서버 코드·권한 변경 안내·닫힌 뒤 응답 무시', async () => {
    const r = roomQueryScreen('src/components/rooms/invite-code-sheet.tsx'); const component = r.screen.default; let resolve; const denied = [];
    const props = { visible: true, roomId: ROOM_QUERY_ID, roomName: '서버 모임', bottomInset: 0, onClose() {}, onAccessError: code => denied.push(code) };
    r.screen.default = () => component(props);
    r.context.fetch = () => new Promise(done => { resolve = done; });
    let view = r.render(); assert.ok(findElement(view, element => element.type === 'ActivityIndicator')); await settle();
    props.visible = false; r.render(); resolve(jsonResponse({ success: true, data: { roomCode: 'OLD123' } })); await settle();
    assert.equal(findElement(r.render(), element => element.props?.accessibilityLabel?.startsWith('초대 코드 O')), null);
    props.visible = true; r.context.fetch = async () => jsonResponse({ success: false, error: { code: 'NOT_ROOM_OWNER' } }, 403);
    r.render(); await settle(); view = r.render();
    assert.ok(findElement(view, element => element.props?.children === '지금은 방장이 아니에요')); assert.deepEqual(denied, ['NOT_ROOM_OWNER']);
    r.unmount();
});

test('106 상세에서 출발역 저장 연타는 PATCH 한 번이고 재조회한 역이 표시돼요', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID }); let selected; let resolve; let detail = roomQueryDetail(); const calls = [];
    r.load('src/app/station-search.tsx').openStationPicker = (_options, callback) => { selected = callback; };
    r.context.fetch = async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'PATCH') return await new Promise(done => { resolve = done; });
        return jsonResponse({ success: true, data: url.endsWith('/members') ? detail.members : url.endsWith('/invite-code') ? { roomCode: 'NEW123' } : detail });
    };
    r.render(); await settle(); let view = r.render();
    findElement(view, element => element.props?.accessibilityLabel === '내 출발역 변경').props.onPress();
    const station = { ...plain(r.load('src/mocks/stations.ts').MOCK_STATIONS[0]), id: 99001, name: '서버 변경역' };
    const first = selected(station); const second = selected(station); await settle();
    assert.equal(calls.filter(call => call.options.method === 'PATCH').length, 1);
    detail = roomQueryDetail(); detail.members[0].departureStation = { ...roomQueryStation(99001), name: station.name };
    resolve(jsonResponse({ success: true, data: null })); await Promise.all([first, second]); view = r.render();
    assert.equal(r.load('src/services/room-cache.ts').readCachedMembers(ROOM_QUERY_ID)[0].departureStation.id, 99001);
    assert.ok(findElement(view, element => element.type === 'Text' && [element.props?.children].flat().some(child => typeof child === 'string' && child.includes('서버 변경역'))));
    r.unmount();
});


test('106 수정 화면의 과거 날짜는 전송 전에 막고 선택한 미래 시각은 UTC로 보내요', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID }); const patches = [];
    r.context.fetch = async (_url, options) => {
        if (options.method === 'PATCH') { patches.push(JSON.parse(options.body)); return jsonResponse({ success: true, data: null }); }
        return jsonResponse({ success: true, data: roomQueryDetail() });
    };
    r.render(); await settle(); let view = r.render();
    const pick = (date, time) => {
        findElement(view, element => element.type?.name === 'CalendarModal').props.onConfirm(date);
        findElement(view, element => element.type?.name === 'TimeWheelModal').props.onConfirm(time);
        view = r.render();
    };
    pick('2000-01-01', '19:30'); await roomWriteButton(view, '저장').props.onPress(); view = r.render();
    assert.equal(patches.length, 0); assert.ok(findElement(view, element => element.props?.children === '지금 이후의 약속 시각을 선택해 주세요.'));
    pick('2035-02-10', '19:30'); await roomWriteButton(view, '저장').props.onPress();
    assert.deepEqual(patches, [{ appointmentAt: new Date(2035, 1, 10, 19, 30).toISOString() }]); r.unmount();
});

test('106 추천 입력 화면도 출발역 저장 연타를 막고 서버 멤버를 재조회해요', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId]/recommendations.tsx', { roomId: ROOM_QUERY_ID }); let selected; let resolve; let detail = roomQueryDetail(); const calls = [];
    r.load('src/app/station-search.tsx').openStationPicker = (_options, callback) => { selected = callback; };
    r.context.fetch = async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'PATCH') return await new Promise(done => { resolve = done; });
        if (url.includes('/station-proposals')) return jsonResponse({ success: true, data: { selectedStation: null, maxProposals: 9, items: [] } });
        return jsonResponse({ success: true, data: url.endsWith('/recommendations/latest') ? null : url.endsWith('/members') ? detail.members : detail });
    };
    let view = await pumpScreen(r);
    findElement(view, element => element.props?.accessibilityLabel === '내 출발역 설정').props.onPress();
    const station = { ...plain(r.load('src/mocks/stations.ts').MOCK_STATIONS[0]), id: 99001, name: '서버 변경역' };
    const first = selected(station); const second = selected(station); await settle();
    assert.equal(calls.filter(call => call.options.method === 'PATCH').length, 1);
    detail = roomQueryDetail(); detail.members[0].departureStation = { ...roomQueryStation(99001), name: station.name };
    resolve(jsonResponse({ success: true, data: null })); await finishRoomMock(r, Promise.all([first, second]));
    assert.equal(r.load('src/services/room-cache.ts').readCachedMembers(ROOM_QUERY_ID)[0].departureStation.id, 99001); r.unmount();
});


test('106 약속 시각 미정·해제 후 View에 빈 문자열 텍스트를 직접 렌더링하지 않아요', async () => {
    for (const appointmentAt of [null, '2035-02-10T10:30:00Z']) {
        const r = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID });
        r.context.fetch = async () => jsonResponse({ success: true, data: { ...roomQueryDetail(), appointmentAt } });
        r.render(); await settle(); let view = r.render();
        if (appointmentAt) {
            findElement(view, element => element.props?.accessibilityLabel === '약속 시각 해제').props.onPress();
            view = r.render();
        }
        const textInView = findElement(view, element => element.type === 'View'
            && [element.props?.children].flat(Infinity).some(child => typeof child === 'string'));
        assert.ok(!textInView, '시각이 없을 때 View의 직접 자식에 빈 문자열을 남기면 웹 Unexpected text node 경고가 나요.');
        assert.equal(findElement(view, element => element.props?.accessibilityLabel === '약속 시각 해제'), null);
        r.unmount();
    }
});

/* ---------- 방 나가기·최종 약속역 서버 연동 (#107) ---------- */
function room107Seed(r, role = 'OWNER') {
    const detail = { ...roomQueryDetail(role), memberCount: 2 };
    r.roomCache.cacheRoomDetail(detail, r.roomCache.getRoomCacheScope());
    r.roomCache.cacheRoomInviteCode(ROOM_QUERY_ID, 'OLD123', r.roomCache.getRoomCacheScope());
    return detail;
}
const room107Failure = (code, status = 403) => jsonResponse({ success: false, error: { code } }, status);

test('107 나가기 DELETE는 본문 없이 인증을 보내고 서버의 세 결과를 그대로 사용하며 방 캐시를 비워요', async () => {
    for (const result of [
        { roomDeleted: false, newOwnerId: null },
        { roomDeleted: false, newOwnerId: ROOM_QUERY_OTHER },
        { roomDeleted: true, newOwnerId: null },
    ]) {
        const r = roomQueryRuntime(); room107Seed(r);
        r.load('src/services/api/client.ts').setAccessTokenProvider(() => 'test-access');
        r.respond(async () => ok(result));
        assert.deepEqual(plain(await r.room.leaveRoom(ROOM_QUERY_ID, 'leave-busy')), result);
        assert.equal(r.calls.length, 1);
        const call = r.calls[0];
        assert.equal(call.url, `https://example.test/api/v1/rooms/${ROOM_QUERY_ID}/members/me`);
        assert.equal(call.options.method, 'DELETE');
        assert.equal(call.options.body, undefined);
        assert.equal(call.options.headers.Authorization, 'Bearer test-access');
        assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID), undefined);
        assert.equal(r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID), undefined);
        assert.deepEqual(plain(r.roomCache.readCachedMembers(ROOM_QUERY_ID)), []);
        assert.equal(r.roomCache.findCachedRoomIdByCode('OLD123'), undefined);
        assert.equal(r.roomCache.readCachedRooms().length, 0);
    }
});

test('107 나가기 응답의 누락·잘못된 타입·자기 승계·삭제와 승계 동시 응답은 UNKNOWN_ERROR이고 캐시를 보존해요', async () => {
    for (const raw of [null, [], {}, { roomDeleted: false }, { roomDeleted: 'false', newOwnerId: null },
        { roomDeleted: false, newOwnerId: 1 }, { roomDeleted: false, newOwnerId: 'not-uuid' },
        { roomDeleted: true, newOwnerId: ROOM_QUERY_OTHER }, { roomDeleted: false, newOwnerId: ROOM_QUERY_ME }]) {
        const r = roomQueryRuntime(); room107Seed(r); r.respond(async () => ok(raw));
        await assert.rejects(r.room.leaveRoom(ROOM_QUERY_ID), { code: 'UNKNOWN_ERROR' });
        assert.ok(r.roomCache.readCachedRoom(ROOM_QUERY_ID));
    }
});

test('107 나가기 응답 유실 뒤 403·404 재요청은 이미 나간 방 안내와 캐시 제거로 정리해요', async () => {
    for (const [code, status] of [['NOT_ROOM_MEMBER', 403], ['ROOM_NOT_FOUND', 404]]) {
        const r = roomQueryRuntime(); room107Seed(r);
        r.respond(async () => { throw Error(); });
        await assert.rejects(r.room.leaveRoom(ROOM_QUERY_ID), { code: 'NETWORK_ERROR' });
        assert.ok(r.roomCache.readCachedRoom(ROOM_QUERY_ID), '불확실한 네트워크 실패에서 먼저 지우지 않아요');
        r.respond(async () => room107Failure(code, status));
        await assert.rejects(r.room.leaveRoom(ROOM_QUERY_ID), error => error.code === code && error.message.includes('이미 나간 방'));
        assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID), undefined);
        assert.equal(r.calls.length, 2);
    }
});

test('107 나가기 처리 중·검증·서버·인증 오류는 구분하고 실패한 요청을 자동 재시도하지 않아요', async () => {
    for (const [code, status, expected] of [['ROOM_BUSY', 409, 'ROOM_BUSY'], ['VALIDATION_ERROR', 400, 'VALIDATION_ERROR'],
        ['INTERNAL_ERROR', 500, 'UNKNOWN_ERROR'], ['TOKEN_INVALID', 401, 'TOKEN_INVALID'], ['TOKEN_CUSTOM', 401, 'TOKEN_CUSTOM']]) {
        const r = roomQueryRuntime(); room107Seed(r); r.respond(async () => room107Failure(code, status));
        await assert.rejects(r.room.leaveRoom(ROOM_QUERY_ID), { code: expected });
        assert.equal(r.calls.length, 1);
        if (status !== 401) assert.ok(r.roomCache.readCachedRoom(ROOM_QUERY_ID)); // 401은 A-1이 로그아웃하며 캐시를 비울 수 있어요.
    }
});

test('107 약속역 PUT·DELETE는 서버 ID만 보내고 null 성공 뒤 상세의 역·상태·확정 시각으로 캐시를 갱신해요', async () => {
    const r = roomQueryRuntime(); const detail = room107Seed(r);
    let timestamp = 0;
    r.respond(async (_url, options) => {
        if (options.method !== 'GET') {
            const selected = options.method === 'PUT' ? roomQueryStation(JSON.parse(options.body).stationId) : null;
            Object.assign(detail, { selectedStation: selected, status: selected ? 'CONFIRMED' : 'OPEN', confirmedAt: selected ? `2035-02-10T10:30:0${timestamp++}Z` : null });
            return ok(null);
        }
        return ok(detail);
    });
    for (const id of [99002, 99002, 77001, null, null]) {
        const value = await r.room.setSelectedStation(ROOM_QUERY_ID, id === null ? null : { ...roomQueryStation(id), name: '요청 이름을 서버값 대신 쓰지 않아요' }, 'busy');
        assert.equal(value, undefined);
        const [write, reload] = r.calls.slice(-2);
        assert.equal(write.url, `https://example.test/api/v1/rooms/${ROOM_QUERY_ID}/selected-station`);
        assert.equal(write.options.method, id === null ? 'DELETE' : 'PUT');
        assert.deepEqual(write.options.body === undefined ? undefined : JSON.parse(write.options.body), id === null ? undefined : { stationId: id });
        assert.equal(reload.options.method, 'GET'); assert.equal(reload.url, `https://example.test/api/v1/rooms/${ROOM_QUERY_ID}`);
        const cached = r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID);
        assert.deepEqual(plain(cached.selectedStation), detail.selectedStation);
        assert.equal(cached.confirmedAt, detail.confirmedAt); assert.equal(cached.status, detail.status);
        assert.equal(cached.appointmentAt, detail.appointmentAt); assert.equal(cached.memberCount, 2);
    }
    assert.equal(timestamp, 3, '같은 역 재지정도 서버가 새 confirmedAt을 내려줘요');
});

test('107 약속역 잘못된 ID는 요청 전에 VALIDATION_ERROR이고 mock 역 목록·후보 여부로 서버 ID를 막지 않아요', async () => {
    const r = roomQueryRuntime(); r.respond(async (_url, options) => ok(options.method === 'GET' ? roomQueryDetail() : null));
    for (const id of [undefined, null, '31', 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
        await assert.rejects(r.room.setSelectedStation(ROOM_QUERY_ID, { ...roomQueryStation(), id }), { code: 'VALIDATION_ERROR' });
    }
    assert.equal(r.calls.length, 0);
    await r.room.setSelectedStation(ROOM_QUERY_ID, roomQueryStation(99002));
    assert.equal(JSON.parse(r.calls[0].options.body).stationId, 99002);
});

test('107 약속역 성공 응답은 null만 허용하고 204·객체·누락을 가짜 상세로 보정하지 않아요', async () => {
    for (const clearing of [false, true]) for (const raw of [{}, [], { selectedStation: roomQueryStation() }, undefined]) {
        const r = roomQueryRuntime(); room107Seed(r);
        r.respond(async () => raw === undefined ? { ok: true, status: 204, text: async () => '' } : ok(raw));
        await assert.rejects(r.room.setSelectedStation(ROOM_QUERY_ID, clearing ? null : roomQueryStation()), { code: 'UNKNOWN_ERROR' });
        assert.equal(r.calls.length, 1); assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID).selectedStation, null);
    }
});

test('107 약속역의 권한·없는 방·미지원 역·처리 중·인증 오류와 코드 캐시를 구분해요', async () => {
    for (const clearing of [false, true]) for (const [code, status] of [['NOT_ROOM_OWNER', 403], ['NOT_ROOM_MEMBER', 403], ['ROOM_NOT_FOUND', 404],
        ['STATION_NOT_FOUND', 404], ['STATION_UNSUPPORTED', 422], ['ROOM_BUSY', 409], ['VALIDATION_ERROR', 400], ['TOKEN_INVALID', 401]]) {
        const r = roomQueryRuntime(); room107Seed(r); r.respond(async () => room107Failure(code, status));
        await assert.rejects(r.room.setSelectedStation(ROOM_QUERY_ID, clearing ? null : roomQueryStation()), { code });
        assert.equal(r.calls.length, 1);
        if (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID), undefined);
        else if (status !== 401) assert.ok(r.roomCache.readCachedRoom(ROOM_QUERY_ID));
        if (code === 'NOT_ROOM_OWNER') assert.equal(r.roomCache.readCachedRoomCode(ROOM_QUERY_ID), undefined);
    }
});

test('107 약속역 저장 뒤 재조회 실패는 저장 완료를 안내하고 입력 역으로 캐시를 덮지 않아요', async () => {
    const r = roomQueryRuntime(); room107Seed(r);
    r.respond(async (_url, options) => { if (options.method === 'PUT') return ok(null); throw Error(); });
    await assert.rejects(r.room.setSelectedStation(ROOM_QUERY_ID, roomQueryStation()), error => error.code === 'NETWORK_ERROR' && error.message.includes('변경은 저장했지만'));
    assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID).selectedStation, null);
    assert.deepEqual(r.calls.map(call => call.options.method), ['PUT', 'GET']);
});

test('107 네트워크·요청/본문 10초 초과는 NETWORK_ERROR이고 나가기·지정·해제 재전송은 없어요', async () => {
    for (const operation of ['leave', 'set', 'clear']) for (const phase of ['network', 'request', 'body']) {
        const r = roomQueryRuntime(); room107Seed(r);
        r.respond((_url, options) => {
            if (phase === 'network') throw Error();
            const waiting = () => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error())));
            return phase === 'request' ? waiting() : { ok: true, status: 200, text: waiting };
        });
        const pending = operation === 'leave' ? r.room.leaveRoom(ROOM_QUERY_ID) : r.room.setSelectedStation(ROOM_QUERY_ID, operation === 'clear' ? null : roomQueryStation());
        const rejected = assert.rejects(pending, { code: 'NETWORK_ERROR' }); await settle();
        if (phase !== 'network') { assert.equal([...r.timers.values()][0].ms, 10000); r.advance(10000); }
        await rejected; assert.equal(r.calls.length, 1); assert.ok(r.roomCache.readCachedRoom(ROOM_QUERY_ID));
    }
});

test('107 같은 계정·방의 나가기와 약속역 저장 연타는 한 요청만 보내요', async () => {
    const r = roomQueryRuntime(); let resolve;
    r.respond(() => new Promise(done => { resolve = done; }));
    const leave = r.room.leaveRoom(ROOM_QUERY_ID); await settle();
    await assert.rejects(r.room.leaveRoom(ROOM_QUERY_ID), { code: 'ROOM_BUSY' });
    await assert.rejects(r.room.setSelectedStation(ROOM_QUERY_ID, roomQueryStation()), { code: 'ROOM_BUSY' });
    assert.equal(r.calls.length, 1); resolve(ok({ roomDeleted: false, newOwnerId: null })); await leave;
    r.respond(async (_url, options) => ok(options.method === 'GET' ? roomQueryDetail() : null));
    await r.room.setSelectedStation(ROOM_QUERY_ID, roomQueryStation());
});

test('107 나간 뒤 늦게 끝난 이전 목록·상세·멤버 조회가 제거한 방을 캐시에 되살리지 않아요', async () => {
    for (const operation of ['list', 'detail', 'members']) {
        const r = roomQueryRuntime(); const detail = room107Seed(r); let resolve;
        r.respond(async (_url, options) => options.method === 'GET' ? await new Promise(done => { resolve = done; }) : ok({ roomDeleted: false, newOwnerId: null }));
        const pending = operation === 'list' ? r.room.fetchMyRooms() : operation === 'detail' ? r.room.fetchRoomDetail(ROOM_QUERY_ID) : r.room.fetchRoomMembers(ROOM_QUERY_ID);
        await settle(); await r.room.leaveRoom(ROOM_QUERY_ID);
        resolve(ok(operation === 'list' ? [roomQuerySummary()] : operation === 'detail' ? detail : detail.members)); await pending;
        assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID), undefined); assert.equal(r.roomCache.readCachedMembers(ROOM_QUERY_ID).length, 0);
    }
});

test('107 약속역 변경 이전의 상세 응답은 최신 서버 확정값을 캐시에서 덮지 않아요', async () => {
    const r = roomQueryRuntime(); let resolveOld; let gets = 0; const updated = roomQueryDetail();
    Object.assign(updated, { status: 'CONFIRMED', selectedStation: roomQueryStation(99002), confirmedAt: '2035-02-10T10:30:00Z' });
    r.respond(async (_url, options) => options.method !== 'GET' ? ok(null) : ++gets === 1 ? await new Promise(done => { resolveOld = done; }) : ok(updated));
    const old = r.room.fetchRoomDetail(ROOM_QUERY_ID); await settle();
    await r.room.setSelectedStation(ROOM_QUERY_ID, roomQueryStation(99002)); resolveOld(ok(roomQueryDetail())); await old;
    assert.equal(r.roomCache.readCachedRoomDetail(ROOM_QUERY_ID).selectedStation.id, 99002);
});

test('107 계정 전환 뒤 늦은 나가기·지정·해제 성공/오류가 새 계정 방을 지우거나 덮지 않아요', async () => {
    for (const operation of ['leave', 'set', 'clear']) for (const fail of [false, true]) {
        const r = roomQueryRuntime(); let resolve;
        r.respond(() => new Promise(done => { resolve = done; }));
        const pending = operation === 'leave' ? r.room.leaveRoom(ROOM_QUERY_ID) : r.room.setSelectedStation(ROOM_QUERY_ID, operation === 'clear' ? null : roomQueryStation());
        const rejected = assert.rejects(pending, { code: 'AUTH_REQUIRED' }); await settle();
        r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '새 계정' });
        const fresh = { ...roomQueryDetail('OWNER', ROOM_QUERY_OTHER), memberCount: 2, name: '새 계정 방' };
        r.roomCache.cacheRoomDetail(fresh, r.roomCache.getRoomCacheScope());
        resolve(fail ? room107Failure('ROOM_NOT_FOUND', 404) : ok(operation === 'leave' ? { roomDeleted: true, newOwnerId: null } : null));
        await rejected; assert.equal(r.roomCache.readCachedRoom(ROOM_QUERY_ID).name, '새 계정 방'); assert.equal(r.calls.length, 1);
    }
});

test('107 서버 나가기 미리보기는 서버 사용자 ID를 사용하고 승계 이름을 계산하지 않아요', () => {
    const r = roomQueryRuntime();
    const owner = r.room.previewLeave({ ...roomQueryDetail(), memberCount: 2 });
    assert.equal(owner.willDelete, false); assert.equal(owner.willTransfer, true); assert.equal(owner.nextOwner, null); assert.equal(owner.nextOwnerId, null);
    assert.equal(r.room.previewLeave({ ...roomQueryDetail('MEMBER'), memberCount: 2 }).willTransfer, false);
    assert.equal(r.room.previewLeave({ ...roomQueryDetail(), memberCount: 1, members: [roomQueryMembers()[0]] }).willDelete, true);
});

function room107Hook(detail = { ...roomQueryDetail(), memberCount: 2 }) {
    const r = roomQueryScreen('src/hooks/use-selected-station.ts'); let changes = 0; const routes = [];
    const props = { detail, onChanged: async () => { changes++; } };
    r.screen.default = () => r.screen.useSelectedStation(props);
    r.context.fetch = async (_url, options) => ok(options.method === 'GET' ? detail : null);
    r.external['expo-router'].router.replace = route => routes.push(route);
    return Object.assign(r, { props, routes, changes: () => changes });
}

test('107 약속역 확인창은 연타를 막고 같은 역 재확정 시 확정 시각 갱신을 안내해요', async () => {
    const detail = { ...roomQueryDetail(), memberCount: 2, selectedStation: roomQueryStation() };
    const r = room107Hook(detail); let resolve; let writes = 0;
    r.context.fetch = async (_url, options) => options.method === 'PUT' ? (++writes, await new Promise(done => { resolve = done; })) : ok(detail);
    let hook = r.render(); hook.choose(detail.selectedStation); hook = r.render();
    const first = hook.submit(); const second = hook.submit(); await settle(); assert.equal(writes, 1);
    resolve(ok(null)); await Promise.all([first, second]); hook = r.render();
    assert.match(hook.notice.text, /확정 시각을 갱신했어요/); assert.equal(hook.request, null); assert.equal(r.changes(), 1); r.unmount();
});

test('107 약속역 확인창의 권한·접근 불가·미지원 역·처리 중·인증 오류 안내를 구분해요', async () => {
    for (const [code, status] of [['NOT_ROOM_OWNER', 403], ['NOT_ROOM_MEMBER', 403], ['ROOM_NOT_FOUND', 404], ['ROOM_BUSY', 409], ['STATION_UNSUPPORTED', 422], ['TOKEN_INVALID', 401]]) {
        const r = room107Hook(); r.context.fetch = async () => room107Failure(code, status);
        let hook = r.render(); hook.choose(roomQueryStation()); hook = r.render(); await hook.submit(); hook = r.render();
        if (status === 401) { assert.equal(hook.notice, null); assert.equal(r.changes(), 0); }
        else if (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') assert.deepEqual(r.routes, ['/rooms']);
        else { assert.equal(hook.notice.error, true); if (code === 'ROOM_BUSY') assert.equal(hook.notice.retry, true); if (code === 'STATION_UNSUPPORTED') assert.equal(hook.notice.pick, true); }
        if (code === 'NOT_ROOM_OWNER') assert.equal(r.changes(), 1);
        r.unmount();
    }
});

test('107 약속역 저장 중 화면 이탈·계정 전환 뒤 늦은 응답은 안내·이동·재조회를 하지 않아요', async () => {
    for (const changeAccount of [false, true]) {
        const r = room107Hook(); let resolve;
        r.context.fetch = async (_url, options) => options.method === 'PUT' ? await new Promise(done => { resolve = done; }) : ok(roomQueryDetail());
        let hook = r.render(); hook.choose(roomQueryStation()); hook = r.render(); const pending = hook.submit(); await settle();
        if (changeAccount) r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '새 계정' }); else r.unmount();
        resolve(ok(null)); await pending; assert.equal(r.changes(), 0); assert.deepEqual(r.routes, []);
        if (changeAccount) { assert.equal(r.render().notice, null); r.unmount(); }
    }
});

function room107LeaveSheet(detail = { ...roomQueryDetail(), memberCount: 2 }) {
    const r = roomQueryScreen('src/components/rooms/room-leave-sheet.tsx'); const component = r.screen.default;
    const left = []; const routes = []; const props = { detail, bottomInset: 0, onClose() {}, onLeft: value => left.push(value) };
    r.screen.default = () => component(props);
    r.external['expo-router'].router.replace = route => routes.push(route);
    return Object.assign(r, { left, routes, props });
}
const room107LeaveButton = view => findElement(view, element => element.type?.name === 'Action' && element.props.danger);

test('107 나가기 확인창은 서버 모드 승계 대상 이름을 단정하지 않고 연타 한 번만 전송해요', async () => {
    const r = room107LeaveSheet(); let resolve; let count = 0;
    r.context.fetch = async () => { count++; return await new Promise(done => { resolve = done; }); };
    let view = r.render(); assert.ok(findTextIncluding(view, '다음 입장 순서의 멤버')); assert.equal(findTextIncluding(view, '서버 동료님에게'), null);
    const button = room107LeaveButton(view); button.props.onPress(); button.props.onPress(); await settle(); assert.equal(count, 1);
    resolve(ok({ roomDeleted: false, newOwnerId: ROOM_QUERY_OTHER })); await settle(); await settle();
    assert.deepEqual(plain(r.left), [{ roomDeleted: false, newOwnerId: ROOM_QUERY_OTHER }]); r.unmount();
});

test('107 나가기 확인창은 이미 나간 방을 목록으로 안내하고 ROOM_BUSY 재시도·인증 오류를 구분해요', async () => {
    for (const [code, status] of [['NOT_ROOM_MEMBER', 403], ['ROOM_NOT_FOUND', 404], ['ROOM_BUSY', 409], ['TOKEN_INVALID', 401]]) {
        const r = room107LeaveSheet(); r.context.fetch = async () => room107Failure(code, status);
        let view = r.render(); room107LeaveButton(view).props.onPress(); await settle(); await settle(); view = r.render();
        if (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') {
            const button = findElement(view, element => element.type?.name === 'Action' && element.props.label === '목록으로');
            assert.ok(button); button.props.onPress(); assert.deepEqual(r.routes, ['/rooms']);
        } else if (code === 'ROOM_BUSY') assert.equal(room107LeaveButton(view).props.label, '다시 시도');
        else assert.equal(findTextIncluding(view, '나가기를 완료하지 못했어요'), null);
        assert.equal(r.left.length, 0); r.unmount();
    }
});

test('107 나가기 확인창을 떠난 뒤 성공 응답은 이전 화면에서 목록 이동을 호출하지 않아요', async () => {
    const r = room107LeaveSheet(); let resolve;
    r.context.fetch = () => new Promise(done => { resolve = done; });
    room107LeaveButton(r.render()).props.onPress(); await settle(); r.unmount();
    resolve(ok({ roomDeleted: true, newOwnerId: null })); await settle(); await settle(); assert.deepEqual(r.left, []); assert.deepEqual(r.routes, []);
});

test('107 mock 약속역 확정·해제·나가기·승계 미리보기는 기존 동작이고 서버를 호출하지 않아요', async () => {
    const r = createRuntime(); const room = r.load('src/services/room.ts'); let count = 0;
    r.context.fetch = () => { count++; throw Error(); };
    const station = r.load('src/mocks/stations.ts').MOCK_STATIONS[0];
    await finishRoomMock(r, room.setSelectedStation('room-4', station));
    assert.equal(room.getMockRoom('room-4').selectedStation.id, station.id);
    await finishRoomMock(r, room.setSelectedStation('room-4', null)); assert.equal(room.getMockRoom('room-4').selectedStation, null);
    const detail = await finishRoomMock(r, room.fetchRoomDetail('room-4'));
    assert.equal(room.previewLeave(detail).nextOwner, '유나');
    const result = await finishRoomMock(r, room.leaveRoom('room-4')); assert.equal(result.roomDeleted, false); assert.ok(result.newOwnerId); assert.equal(count, 0);
});

function room107TrackFocus(r) {
    let enter; let exit;
    r.external['expo-router'].useFocusEffect = callback => {
        enter = callback;
        r.external.react.useEffect(() => { exit = callback(); return exit; }, [callback]);
    };
    r.blur = () => exit?.();
    r.focus = () => { exit = enter(); };
    return r;
}

function directionScreen114(params = { stationId: '105', lineId: '2', headsign: '사당 방면' }) {
    const deleted = []; const saves = []; const alerts = []; let permission = true; let size = 1000;
    const r = createScreenRuntime(serverEnv, 'src/app/ai-direction.tsx', runtime => {
        runtime.native.ScrollView = 'ScrollView'; runtime.native.Image = 'Image'; runtime.native.Platform.OS = 'ios';
        runtime.native.Alert = { alert: (...args) => alerts.push(args) }; runtime.native.Linking = { openSettings: async () => {} };
        runtime.external['expo-image-picker'] = {
            requestCameraPermissionsAsync: async () => ({ granted: permission }), requestMediaLibraryPermissionsAsync: async () => ({ granted: permission }),
            launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'file:///cache/source.heic', width: 4000, height: 3000, mimeType: 'image/heic' }] }),
        };
        runtime.external['expo-image-picker'].launchImageLibraryAsync = runtime.external['expo-image-picker'].launchCameraAsync;
        runtime.external['expo-file-system'] = { Paths: { cache: { uri: 'file:///cache/' } }, File: class {
                constructor(uri) { this.uri = uri; } get exists() { return true; } get size() { return size; } delete() { deleted.push(this.uri); }
            } };
        runtime.external['expo-image-manipulator'] = { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: () => ({
                    resize: value => saves.push(value), release() {}, renderAsync: async () => ({ release() {}, saveAsync: async options => {
                            saves.push(options); return { uri: 'file:///cache/output.jpg' };
                        } }),
                }) } };
    });
    r.external['expo-router'].useLocalSearchParams = () => params;
    r.external.react.useCallback = (callback, dependencies) => {
        const ref = r.external.react.useRef(null);
        if (!ref.current || dependencies.some((value, index) => value !== ref.current.dependencies[index])) ref.current = { callback, dependencies };
        return ref.current.callback;
    };
    r.external['expo-router'].useFocusEffect = callback => r.external.react.useEffect(callback, [callback]);
    const component = r.render().type; r.screen.default = component;
    return Object.assign(r, { deleted, saves, alerts, deny: () => { permission = false; }, oversized: () => { size = 6000000; } });
}
function directionButton114(view, label) {
    return findElement(view, e => e.type?.name === 'ServerButton' && e.props.label === label);
}

test('114 화면 경로 누락 차단·권한 거부·JPEG 축소와 5MB 초과 차단', async () => {
    const missing = directionScreen114({}); assert.ok(directionButton114(missing.render(), '경로 검색'));
    assert.equal(directionButton114(missing.render(), '표지판 촬영'), null); missing.unmount();
    const denied = directionScreen114(); directionButton114(denied.render(), '표지판 촬영').props.onPress();
    // Deny before the asynchronous permission continuation.
    denied.unmount();
    const r = directionScreen114(); r.deny(); directionButton114(r.render(), '갤러리 선택').props.onPress();
    await settle(); assert.equal(r.alerts.length, 1); assert.equal(r.saves.length, 0); r.unmount();
    const large = directionScreen114(); large.oversized(); directionButton114(large.render(), '갤러리 선택').props.onPress();
    for (let i = 0; i < 5; i++) await settle();
    assert.equal(large.saves.filter(value => value.format === 'jpeg').length, 3);
    assert.equal(directionButton114(large.render(), 'AI로 확인하기'), null); assert.ok(large.deleted.length); large.unmount();
});

test('114 화면 이중 제출·이탈 및 계정 전환 후 응답 폐기·임시 파일 정리', async () => {
    for (const stale of ['none', 'unmount', 'account']) {
        const r = directionScreen114(); directionButton114(r.render(), '표지판 촬영').props.onPress();
        for (let i = 0; i < 4; i++) await settle();
        assert.deepEqual(plain(r.saves[0]), { width: 2560, height: 1920 }); assert.equal(r.saves[1].compress, 0.85);
        let finish; let calls = 0;
        r.context.fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
        const submit = directionButton114(r.render(), 'AI로 확인하기'); assert.ok(submit);
        submit.props.onPress(); submit.props.onPress(); await settle(); assert.equal(calls, 1);
        assert.equal(directionButton114(r.render(), 'AI로 확인하기').props.disabled, true);
        if (stale === 'unmount') r.unmount();
        if (stale === 'account') await r.load('src/services/auth.ts').clearLocalSession();
        finish(jsonResponse({ success: true, data: directionData114() }));
        for (let i = 0; i < 4; i++) await settle();
        if (stale !== 'unmount') assert.equal(!!findElement(r.render(), e => e.props?.children === '올바른 방향이에요'), stale === 'none');
        assert.ok(r.deleted.includes('file:///cache/output.jpg')); r.unmount();
    }
});

test('107 요청 중 이탈 후 다시 돌아오면 늦은 성공 안내 없이 처리 중 버튼이 해제돼요', async () => {
    for (const screen of ['selected', 'leave']) {
        const r = room107TrackFocus(screen === 'selected' ? room107Hook() : room107LeaveSheet()); let resolve;
        r.context.fetch = async (_url, options) => options.method === 'GET' ? ok(roomQueryDetail()) : await new Promise(done => { resolve = done; });
        let pending;
        if (screen === 'selected') { let hook = r.render(); hook.choose(roomQueryStation()); hook = r.render(); pending = hook.submit(); }
        else room107LeaveButton(r.render()).props.onPress();
        await settle(); r.blur(); r.focus();
        resolve(ok(screen === 'selected' ? null : { roomDeleted: false, newOwnerId: null }));
        if (pending) await pending; else { await settle(); await settle(); }
        const view = r.render();
        if (screen === 'selected') { assert.equal(view.busy, false); assert.equal(r.changes(), 0); assert.equal(view.notice, null); }
        else { assert.equal(room107LeaveButton(view).props.disabled, false); assert.equal(r.left.length, 0); }
        r.unmount();
    }
});

test('107 일반 멤버는 약속역 지정 확인창을 열지 못하고 취소는 서버를 호출하지 않아요', () => {
    const member = room107Hook({ ...roomQueryDetail('MEMBER'), memberCount: 2 }); let calls = 0;
    member.context.fetch = () => { calls++; throw Error(); };
    member.render().choose(roomQueryStation()); assert.equal(member.render().request, null); member.unmount();
    const owner = room107Hook(); owner.context.fetch = () => { calls++; throw Error(); };
    owner.render().choose(roomQueryStation()); assert.ok(owner.render().request);
    owner.render().cancel(); assert.equal(owner.render().request, null); assert.equal(calls, 0); owner.unmount();
});

test('107 방 상세는 서버 나가기 세 결과로 목록 이동 문구를 정하고 상세 기록을 닫아요', async () => {
    for (const result of [{ roomDeleted: false, newOwnerId: null }, { roomDeleted: false, newOwnerId: ROOM_QUERY_OTHER }, { roomDeleted: true, newOwnerId: null }]) {
        const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID }); const routes = []; let dismissed = 0;
        r.external['expo-router'].router.canDismiss = () => true;
        r.external['expo-router'].router.dismissAll = () => { dismissed++; };
        r.external['expo-router'].router.replace = route => routes.push(route);
        r.context.fetch = async url => ok(url.endsWith('/invite-code') ? { roomCode: 'OLD123' } : url.includes('/station-proposals') ? proposalList([]) : roomQueryDetail());
        let view = await pumpScreen(r);
        findElement(findElement(view, element => element.type?.name === 'Header').props.right, element => element.props?.accessibilityLabel === '약속방 나가기').props.onPress(); view = r.render();
        const sheet = findElement(view, element => element.type?.name === 'RoomLeaveSheet'); assert.ok(sheet);
        sheet.props.onLeft(result);
        assert.equal(dismissed, 1); assert.equal(routes[0].pathname, '/rooms');
        assert.equal(routes[0].params.leaveResult, result.roomDeleted ? 'deleted' : result.newOwnerId ? 'transferred' : 'left');
        if (result.newOwnerId) assert.equal(routes[0].params.nextOwnerName, '서버 동료'); r.unmount();
    }
});

test('107 서버가 정한 새 방장과 약속역은 남은 계정의 재조회에서도 같은 값으로 표시돼요', async () => {
    const r = roomQueryRuntime();
    r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '서버 동료' });
    const detail = { ...roomQueryDetail('OWNER', ROOM_QUERY_OTHER), members: [roomQueryMembers('OWNER', ROOM_QUERY_OTHER)[0]],
        selectedStation: roomQueryStation(99002), status: 'CONFIRMED', confirmedAt: '2035-02-10T10:30:00Z' };
    r.respond(async url => ok(url.endsWith('/invite-code') ? { roomCode: 'NEW123' } : detail));
    const actual = await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    assert.equal(actual.ownerId, ROOM_QUERY_OTHER); assert.equal(actual.myRole, 'OWNER'); assert.equal(actual.memberCount, 1);
    assert.equal(actual.selectedStation.id, 99002); assert.equal(actual.confirmedAt, detail.confirmedAt);
    assert.equal((await r.room.fetchInviteCode(ROOM_QUERY_ID)).roomCode, 'NEW123');
});

/* ---------- #125 AI 표지판 방향 확인 화면 ---------- */

/** 화면 트리를 비교 가능한 값으로 바꿔요. 스타일은 실제 적용 값으로 합치고, 상태 없는 부품은 펼쳐요. */
function flattenStyle125(style) {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle125));
    return style && typeof style === 'object' ? { ...style } : {};
}
function serialize125(node) {
    if (node == null || typeof node === 'boolean') return null;
    if (Array.isArray(node)) return node.map(serialize125).flat().filter(value => value !== null);
    if (typeof node !== 'object') return String(node);
    const { children, style, ...rest } = node.props ?? {};
    const props = {};
    for (const [key, value] of Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))) {
        if (value === undefined) continue;
        props[key] = typeof value === 'function' ? '[fn]' : value && typeof value === 'object' && value.$$typeof ? serialize125(value) : JSON.parse(JSON.stringify(value));
    }
    if (style !== undefined) {
        if (typeof style === 'function') { props.style = flattenStyle125(style({ pressed: false })); props.pressedStyle = flattenStyle125(style({ pressed: true })); }
        else props.style = flattenStyle125(style);
    }
    if (typeof node.type === 'function') {
        const name = node.type.name;
        if (name === 'ScanLine') return { t: name, p: props };
        return { t: name, p: props, out: serialize125(node.type(node.props)) };
    }
    return { t: typeof node.type === 'string' ? node.type : String(node.type), p: props, c: serialize125(children) };
}

function directionMockScreen125(params) {
    const r = createScreenRuntime({}, 'src/app/ai-direction.tsx', runtime => {
        runtime.native.ScrollView = 'ScrollView'; runtime.native.Image = 'Image';
        runtime.native.Alert = { alert() { throw Error('mock 화면은 알림을 띄우지 않아요'); } }; runtime.native.Linking = { openSettings: async () => {} };
        const forbidden = () => { throw Error('mock 화면은 실제 사진 기능을 쓰지 않아요'); };
        runtime.external['expo-image-picker'] = { requestCameraPermissionsAsync: forbidden, requestMediaLibraryPermissionsAsync: forbidden, launchCameraAsync: forbidden, launchImageLibraryAsync: forbidden };
        runtime.external['expo-file-system'] = { Paths: { cache: { uri: 'file:///cache/' } }, File: class { constructor() { forbidden(); } } };
        runtime.external['expo-image-manipulator'] = { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: forbidden } };
    });
    r.external['expo-router'].useLocalSearchParams = () => params;
    r.context.fetch = () => { throw Error('mock 화면은 서버를 부르지 않아요'); };
    const component = r.render().type; r.screen.default = component;
    return r;
}

/** mock 화면의 모든 단계(대기·예시 시트·미리보기·분석 중·결과·오류·다시 시도)를 차례로 기록해요. */
async function mockDirectionSnapshots125() {
    const snapshots = {};
    const action = (view, label) => findElement(view, e => e.type?.name === 'ActionButton' && e.props.label === label);
    for (const [paramsName, params] of [['example', {}], ['route', { stationId: '105', stationName: '강남', lineId: '2', lineName: '2호선', direction: 'INNER', headsign: '사당 방면' }]]) {
        const probe = directionMockScreen125(params);
        snapshots[`${paramsName}:waiting`] = serialize125(probe.render());
        action(probe.render(), '표지판 촬영').props.onPress();
        snapshots[`${paramsName}:picker`] = serialize125(probe.render());
        const cards = [];
        (function collect(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(collect);
            if (node.props?.accessibilityLabel?.startsWith?.('예시 사진 ')) cards.push(node.props.accessibilityLabel);
            collect(node.props?.children);
        })(probe.render());
        for (const label of cards) {
            const r = directionMockScreen125(params);
            action(r.render(), '사진 업로드').props.onPress();
            findElement(r.render(), e => e.props?.accessibilityLabel === label).props.onPress();
            snapshots[`${paramsName}:${label}:preview`] = serialize125(r.render());
            action(r.render(), 'AI로 확인하기').props.onPress();
            snapshots[`${paramsName}:${label}:analyzing`] = serialize125(r.render());
            r.advance(1500); await settle();
            snapshots[`${paramsName}:${label}:done`] = serialize125(r.render());
            const retry = action(r.render(), '다시 시도');
            if (retry) {
                retry.props.onPress(); snapshots[`${paramsName}:${label}:retry`] = serialize125(r.render());
                r.advance(1500); await settle(); snapshots[`${paramsName}:${label}:retry-done`] = serialize125(r.render());
            }
        }
    }
    return snapshots;
}

/** 상태 없는 부품을 펼친 트리예요. 버튼(ServerButton)과 애니메이션(ScanLine)은 그대로 둬요. */
function deep125(node) {
    if (Array.isArray(node)) return node.map(deep125);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function' && !['ServerButton', 'ScanLine'].includes(node.type.name)) return deep125(node.type(node.props));
    return { ...node, props: { ...node.props, children: deep125(node.props?.children) } };
}
function findAll125(node, predicate, found = []) {
    if (Array.isArray(node)) { node.forEach(child => findAll125(child, predicate, found)); return found; }
    if (!node || typeof node !== 'object') return found;
    if (predicate(node)) found.push(node);
    findAll125(node.props?.children, predicate, found);
    return found;
}
const texts125 = view => findAll125(deep125(view), e => e.type === 'Text').map(textOf);
const photoUri125 = view => findElement(view, e => e.type === 'Image')?.props.source.uri ?? null;
const alertText125 = view => { const alert = findElement(deep125(view), e => e.props?.accessibilityRole === 'alert'); return alert ? textOf(alert) : null; };
const SERVER_ERROR_TEXT125 = {
    AI_UNAVAILABLE: 'AI가 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요.',
    AI_QUOTA_EXCEEDED: '분석 요청이 많아요. 잠시 후 다시 시도해 주세요.',
    NETWORK_ERROR: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    UNKNOWN_ERROR: '분석 응답을 확인하지 못했어요. 다시 시도해 주세요.',
    IMAGE_INVALID: '다른 사진을 선택해 주세요. JPG·PNG 5MB 이하 사진이 필요해요.',
    STATION_NOT_FOUND: '경로를 다시 선택해 주세요.',
    VALIDATION_ERROR: '경로를 다시 선택해 주세요.',
};
const failure125 = code => code === 'NETWORK_ERROR' ? () => Promise.reject(Error('offline'))
    : code === 'UNKNOWN_ERROR' ? () => Promise.resolve(jsonResponse({ success: true, data: { result: 'FUTURE' } }))
        : () => Promise.resolve(jsonResponse({ success: false, error: { code } },
            { AI_UNAVAILABLE: 503, AI_QUOTA_EXCEEDED: 429, TOKEN_INVALID: 401, STATION_NOT_FOUND: 404 }[code] ?? 400));

/** #114 화면 장치에 화면 포커스 제어, 이동 기록, 서버로 보낸 사진·경로 기록을 더해요. */
async function directionScreen125(params) {
    const r = room107TrackFocus(directionScreen114(params)); r.routes = []; r.sent = []; r.calls = 0;
    r.external['expo-router'].router.replace = route => r.routes.push(route);
    const service = r.load('src/services/direction.ts'); const original = service.checkDirection;
    service.checkDirection = (photo, route) => { r.sent.push({ photo, route: plain(route) }); return original(photo, route); };
    r.respond = handler => { r.context.fetch = (...args) => { r.calls++; return handler(...args); }; };
    r.hold = () => { let finish; r.respond(() => new Promise(resolve => { finish = resolve; })); return value => finish(value); };
    r.pump = async () => { for (let i = 0; i < 6; i++) await settle(); return r.render(); };
    r.button = label => directionButton114(r.render(), label);
    r.press = async label => { const button = r.button(label); assert.ok(button, `버튼이 없어요: ${label}`); button.props.onPress(); return r.pump(); };
    return r;
}
const OUTPUT125 = 'file:///cache/output.jpg';
const deletedCount125 = r => r.deleted.filter(uri => uri === OUTPUT125).length;

test('125 재시도 가능한 오류 4종은 사진을 유지하고 다시 시도는 같은 사진·같은 경로로 한 번만 보내요', async () => {
    for (const code of ['AI_UNAVAILABLE', 'AI_QUOTA_EXCEEDED', 'NETWORK_ERROR', 'UNKNOWN_ERROR']) {
        const r = await directionScreen125(); await r.press('표지판 촬영');
        r.respond(failure125(code)); let view = await r.press('AI로 확인하기');
        assert.equal(alertText125(view), SERVER_ERROR_TEXT125[code], code);
        assert.equal(photoUri125(view), OUTPUT125, `${code}: 사진 유지`); assert.equal(deletedCount125(r), 0, `${code}: 임시 파일 유지`);
        assert.ok(texts125(view).includes('분석하지 못했어요'));
        for (const label of ['다시 시도', '표지판 촬영', '갤러리 선택']) assert.equal(r.button(label).props.disabled, false, `${code}: ${label}`);
        const before = r.calls; const finish = r.hold(); const retry = r.button('다시 시도');
        retry.props.onPress(); retry.props.onPress(); await settle();
        assert.equal(r.calls, before + 1, `${code}: 재시도 이중 제출 차단`); assert.equal(r.sent.length, 2);
        assert.equal(r.sent[1].photo, r.sent[0].photo, `${code}: 같은 사진`); assert.equal(r.sent[1].photo.uri, OUTPUT125);
        assert.deepEqual(r.sent[1].route, r.sent[0].route); assert.deepEqual(r.sent[1].route, { stationId: 105, lineId: 2, headsign: '사당 방면' });
        view = r.render(); assert.equal(r.button('AI로 확인하기').props.disabled, true); assert.equal(r.button('다시 시도'), null);
        assert.ok(texts125(view).includes('AI가 표지판을 읽고 있어요')); assert.ok(findElement(view, e => e.type?.name === 'ScanLine'));
        finish(jsonResponse({ success: true, data: directionData114() })); view = await r.pump();
        assert.ok(texts125(view).includes('올바른 방향이에요')); assert.equal(photoUri125(view), null); assert.equal(deletedCount125(r), 1);
        r.unmount();
    }
});

test('125 재시도 오류 뒤 새 사진을 고르면 유지하던 사진과 임시 파일을 먼저 정리해요', async () => {
    const r = await directionScreen125(); await r.press('표지판 촬영');
    r.respond(failure125('AI_UNAVAILABLE')); await r.press('AI로 확인하기');
    let permissionAsked = 0; const picker = r.external['expo-image-picker']; const ask = picker.requestMediaLibraryPermissionsAsync;
    picker.requestMediaLibraryPermissionsAsync = async () => { permissionAsked++; assert.equal(deletedCount125(r), 1, '권한 요청 전에 정리'); return ask(); };
    const view = await r.press('갤러리 선택');
    assert.equal(permissionAsked, 1); assert.equal(alertText125(view), null); assert.equal(photoUri125(view), OUTPUT125);
    assert.ok(r.button('AI로 확인하기')); assert.equal(r.button('다시 시도'), null); r.unmount();
});

test('125 IMAGE_INVALID는 사진을 지우고 다른 사진을, 경로 오류는 경로 재선택을, 인증 오류는 안내 없이 정리해요', async () => {
    const image = await directionScreen125(); await image.press('표지판 촬영');
    image.respond(failure125('IMAGE_INVALID')); let view = await image.press('AI로 확인하기');
    assert.equal(alertText125(view), SERVER_ERROR_TEXT125.IMAGE_INVALID); assert.equal(photoUri125(view), null); assert.equal(deletedCount125(image), 1);
    assert.equal(image.button('다시 시도'), null); assert.equal(image.button('AI로 확인하기'), null);
    assert.ok(texts125(view).includes('표지판이 잘 보이는 다른 사진을 골라 주세요.'));
    assert.equal(image.button('표지판 촬영').props.disabled, false); assert.equal(image.button('갤러리 선택').props.disabled, false); image.unmount();
    for (const code of ['STATION_NOT_FOUND', 'VALIDATION_ERROR']) {
        const r = await directionScreen125(); await r.press('표지판 촬영');
        r.respond(failure125(code)); view = await r.press('AI로 확인하기');
        assert.equal(alertText125(view), SERVER_ERROR_TEXT125[code]); assert.equal(photoUri125(view), null); assert.equal(deletedCount125(r), 1);
        assert.equal(r.button('다시 시도'), null); assert.equal(r.button('표지판 촬영'), null);
        await r.press('경로 다시 선택'); assert.deepEqual(r.routes, ['/route-search']); r.unmount();
    }
    const auth = await directionScreen125(); let authFailures = 0;
    auth.load('src/services/api/client.ts').setAuthFailureHandler(() => { authFailures++; });
    await auth.press('표지판 촬영'); auth.respond(failure125('TOKEN_INVALID')); view = await auth.press('AI로 확인하기');
    assert.equal(authFailures, 1); assert.equal(alertText125(view), null); assert.equal(photoUri125(view), null); assert.equal(deletedCount125(auth), 1);
    assert.equal(auth.alerts.length, 0); assert.ok(texts125(view).includes('표지판을 찍어 방향을 확인해요')); auth.unmount();
});

test('125 결과 3종은 제목·색·아이콘이 다르고 읽은 값·내 경로 값을 나란히, null은 읽지 못했어요로 보여주며 사진을 정리해요', async () => {
    const looks = {};
    for (const result of ['CORRECT', 'WRONG', 'RETAKE']) {
        const r = await directionScreen125(); await r.press('표지판 촬영');
        const recognized = result === 'RETAKE' ? { stationName: null, lineName: null, headsign: null }
            : { stationName: '강남', lineName: '2호선', headsign: result === 'CORRECT' ? '사당 방면' : '성수 방면' };
        r.respond(async () => jsonResponse({ success: true, data: { ...directionData114(result), recognized, message: `서버 안내 ${result}` } }));
        const view = deep125(await r.press('AI로 확인하기'));
        assert.equal(photoUri125(view), null, `${result}: 사진 정리`); assert.equal(deletedCount125(r), 1);
        const title = findAll125(view, e => e.type === 'Text' && e.props.style?.some?.(s => s?.fontSize === 19)).map(e => ({ text: textOf(e), color: e.props.style[1].color }))[0];
        const icon = findAll125(view, e => e.type === 'Ionicons' && e.props.size === 22)[0].props.name;
        looks[result] = { ...title, icon };
        assert.ok(texts125(view).includes(`서버 안내 ${result}`), `${result}: 서버 message`);
        const cellViews = findAll125(view, e => e.type === 'View' && e.props.style?.width === '50%');
        const cells = cellViews.map(cell => findAll125(cell, e => e.type === 'Text').map(textOf));
        const read = value => value ?? '읽지 못했어요';
        assert.deepEqual(cells, [
            ['읽은 역 이름', recognized.stationName ? '강남역' : read(null)], ['내 경로 역 이름', '강남역'],
            ['읽은 호선', read(recognized.lineName)], ['내 경로 호선', '2호선'],
            ['읽은 방면', read(recognized.headsign)], ['내 경로 방면', '사당 방면'],
        ], result);
        const headsignCell = findAll125(cellViews[4], e => e.type === 'Text')[1];
        const color = Object.assign({}, ...headsignCell.props.style.filter(Boolean)).color;
        assert.equal(color, { CORRECT: '#12a77a', WRONG: '#e5484d', RETAKE: '#6b7488' }[result], `${result}: 방면 비교 색`);
        assert.equal(headsignCell.props.numberOfLines, undefined, '값은 자르지 않아요');
        assert.equal(r.button('표지판 촬영').props.disabled, false); assert.equal(!!r.button('경로 안내로 돌아가기'), true);
        r.unmount();
    }
    assert.deepEqual(looks, {
        CORRECT: { text: '올바른 방향이에요', color: '#12a77a', icon: 'checkmark-circle' },
        WRONG: { text: '경로와 다른 표지판이에요', color: '#e5484d', icon: 'close-circle' },
        RETAKE: { text: '다시 촬영해 주세요', color: '#b7791f', icon: 'camera-reverse-outline' },
    });
});

test('125 유지하던 사진은 화면을 떠나면 정리되고, 요청 중 떠나면 응답 뒤 정리하며 늦은 응답은 나타나지 않아요', async () => {
    const idle = await directionScreen125(); await idle.press('표지판 촬영');
    idle.respond(failure125('NETWORK_ERROR')); await idle.press('AI로 확인하기'); assert.equal(deletedCount125(idle), 0);
    idle.blur(); assert.equal(deletedCount125(idle), 1, '떠나면 유지하던 임시 파일 정리');
    idle.focus(); let view = idle.render(); assert.equal(photoUri125(view), null); assert.equal(alertText125(view), null); idle.unmount();
    for (const late of ['success', 'AI_UNAVAILABLE']) {
        const r = await directionScreen125(); await r.press('표지판 촬영');
        r.respond(failure125('AI_UNAVAILABLE')); await r.press('AI로 확인하기');
        const finish = r.hold(); r.button('다시 시도').props.onPress(); await settle();
        r.blur(); assert.equal(deletedCount125(r), 0, '요청 중에는 지우지 않아요');
        finish(late === 'success' ? jsonResponse({ success: true, data: directionData114() }) : await failure125(late)()); await r.pump();
        assert.equal(deletedCount125(r), 1, `${late}: 요청이 끝난 뒤 정리`);
        r.focus(); view = r.render();
        assert.equal(texts125(view).includes('올바른 방향이에요'), false); assert.equal(alertText125(view), null); assert.equal(photoUri125(view), null);
        assert.equal(r.button('표지판 촬영').props.disabled, false); r.unmount();
    }
    const gone = await directionScreen125(); await gone.press('표지판 촬영');
    gone.respond(failure125('AI_UNAVAILABLE')); await gone.press('AI로 확인하기'); gone.unmount();
    assert.equal(deletedCount125(gone), 1, '언마운트 때 유지하던 임시 파일 정리');
});

test('125 계정이 바뀌면 재시도 응답을 버리고 유지하던 사진으로 다시 보내지 않아요', async () => {
    const r = await directionScreen125(); await r.press('표지판 촬영');
    r.respond(failure125('AI_UNAVAILABLE')); await r.press('AI로 확인하기');
    const finish = r.hold(); r.button('다시 시도').props.onPress(); await settle();
    await r.load('src/services/auth.ts').clearLocalSession();
    finish(jsonResponse({ success: true, data: directionData114() })); let view = await r.pump();
    assert.equal(texts125(view).includes('올바른 방향이에요'), false); assert.equal(alertText125(view), null); assert.equal(photoUri125(view), null);
    assert.equal(deletedCount125(r), 1); assert.equal(r.button('표지판 촬영').props.disabled, false, '처리 중 잠금 해제'); r.unmount();
    const kept = await directionScreen125(); await kept.press('표지판 촬영');
    kept.respond(failure125('NETWORK_ERROR')); await kept.press('AI로 확인하기'); const calls = kept.calls;
    await kept.load('src/services/auth.ts').clearLocalSession();
    view = await kept.press('다시 시도');
    assert.equal(kept.calls, calls, '이전 계정의 사진은 보내지 않아요'); assert.equal(photoUri125(view), null); assert.equal(deletedCount125(kept), 1); kept.unmount();
});

test('125 경로 정보가 없으면 안내와 경로 검색 버튼, 있으면 역·호선·방면 요약을 보여주고 보내는 route는 그대로예요', async () => {
    for (const params of [{}, { stationId: '105', lineId: '2' }, { stationId: '0', lineId: '2', headsign: '사당 방면' }, { stationId: '105', lineId: '2', headsign: '  ' }]) {
        const r = await directionScreen125(params); const view = r.render();
        assert.ok(texts125(view).includes('확인할 경로가 없어요')); assert.ok(texts125(view).includes('방향을 확인할 경로를 먼저 선택해 주세요.'));
        for (const label of ['표지판 촬영', '갤러리 선택', 'AI로 확인하기']) assert.equal(r.button(label), null);
        await r.press('경로 검색'); assert.deepEqual(r.routes, ['/route-search']); r.unmount();
    }
    const full = await directionScreen125({ stationId: '105', stationName: '강남', lineId: '2', lineName: '2호선', headsign: '사당 방면', direction: 'INNER' });
    // 내 경로 칩: '내 경로' 글자, 노선 배지 숫자, 요약 순서예요.
    const chipText = view => { const texts = texts125(view); assert.ok(texts.includes('내 경로')); assert.equal(texts[texts.indexOf('내 경로') + 1], '2'); return texts[texts.indexOf('내 경로') + 2]; };
    assert.equal(chipText(full.render()), '강남역 · 2호선 사당 방면');
    await full.press('표지판 촬영'); full.respond(async () => jsonResponse({ success: true, data: directionData114() })); await full.press('AI로 확인하기');
    assert.deepEqual(full.sent[0].route, { stationId: 105, lineId: 2, headsign: '사당 방면', direction: 'INNER' }); full.unmount();
    const partial = await directionScreen125({ stationId: '105', lineId: '2', headsign: '사당 방면' });
    assert.equal(chipText(partial.render()), '사당 방면'); partial.unmount();
});

/*
 * 이 검사는 #125 에서 서버 모드 화면을 고치는 동안 mock 화면(트리·실제 적용 스타일·동작)이 바뀌지 않았음을
 * 확인하려고 넣었어요. mock 화면이나 공통 부품(ActionButton·StatusTitle·Cell·styles 등)을 일부러 바꿀 때는
 * 아래 명령으로 기준 파일을 갱신하고, 바뀐 단계가 의도한 것인지 확인한 뒤 함께 커밋하세요.
 *   UPDATE_FIXTURES=1 node scripts/verify-api-client.cjs
 * 평소 실행에서는 기준 파일을 쓰지 않고 비교만 해요.
 */
const MOCK_FIXTURE125 = path.join(root, 'scripts/fixtures/ai-direction-mock-125.json');
const MOCK_FIXTURE_UPDATE125 = 'UPDATE_FIXTURES=1 node scripts/verify-api-client.cjs';
test('125 mock 모드 화면은 #125 이전과 같은 트리·스타일·동작이에요', async () => {
    const crypto = require('node:crypto');
    const actual = Object.fromEntries(Object.entries(await mockDirectionSnapshots125())
        .map(([key, value]) => [key, crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')]));
    if (process.env.UPDATE_FIXTURES === '1') {
        fs.writeFileSync(MOCK_FIXTURE125, JSON.stringify({
            note: 'mock 화면 단계별 트리의 sha256. scripts/verify-api-client.cjs 의 serialize125 로 만들고 UPDATE_FIXTURES=1 로 갱신해요.',
            snapshots: actual,
        }, null, 1) + '\n');
        return;
    }
    const expected = JSON.parse(fs.readFileSync(MOCK_FIXTURE125, 'utf8')).snapshots;
    const changed = Object.keys(actual).filter(key => key in expected && actual[key] !== expected[key]);
    const added = Object.keys(actual).filter(key => !(key in expected));
    const removed = Object.keys(expected).filter(key => !(key in actual));
    if (changed.length || added.length || removed.length) {
        assert.fail([
            `mock 화면이 기준(${path.relative(root, MOCK_FIXTURE125)})과 달라졌어요.`,
            ...(changed.length ? [`  달라진 단계 ${changed.length}개: ${changed.join(', ')}`] : []),
            ...(added.length ? [`  새로 생긴 단계: ${added.join(', ')}`] : []),
            ...(removed.length ? [`  없어진 단계: ${removed.join(', ')}`] : []),
            `일부러 바꾼 거라면 기준 파일 다시 만들기: ${MOCK_FIXTURE_UPDATE125}`,
        ].join('\n'));
    }
});

/* ---------- #130 서버 모드 시작 흐름과 마이페이지 권한 표시 ---------- */

const SEEN_KEY130 = 'linkro.onboardingSeen';
/** 기기 저장소(expo-secure-store)와 웹 localStorage 를 가짜로 둬요. */
function storage130(runtime, platform = 'ios') {
    runtime.native.Platform.OS = platform;
    const disk = new Map(); const faults = { read: false, write: false, hang: false }; const calls = [];
    runtime.external['expo-secure-store'] = {
        getItemAsync: async key => { calls.push(['get', key]); if (faults.hang) return new Promise(() => {}); if (faults.read) throw Error(); return disk.get(key) ?? null; },
        setItemAsync: async (key, value) => { calls.push(['set', key, value]); if (faults.hang) return new Promise(() => {}); if (faults.write) throw Error(); disk.set(key, value); },
    };
    const web = new Map();
    runtime.context.localStorage = {
        getItem: key => { calls.push(['web-get', key]); if (faults.read) throw Error(); return web.get(key) ?? null; },
        setItem: (key, value) => { calls.push(['web-set', key, value]); if (faults.write) throw Error(); web.set(key, String(value)); },
    };
    return { disk, web, faults, calls };
}

test('130 시작 갈 곳 규칙: mock 은 항상 온보딩, 세션 있으면 홈, 없으면 본 적 여부로 온보딩·로그인', () => {
    const { startDestination } = createRuntime().load('src/utils/start-flow.ts');
    for (const status of ['unknown', 'restoring', 'signedIn', 'signedOut']) for (const seen of [false, true]) {
        assert.equal(startDestination({ mock: true, status, seen }), '/onboarding-1');
        assert.equal(startDestination({ mock: false, status, seen }), status === 'signedIn' ? '/home' : seen ? '/login' : '/onboarding-1');
    }
});

test('130 저장 모듈: 기기·웹 읽기·쓰기, 실패·멈춤은 예외 없이 본 적 없음·false', async () => {
    for (const platform of ['ios', 'android', 'web']) {
        const r = createRuntime(serverEnv); const s = storage130(r, platform);
        const { readOnboardingSeen, markOnboardingSeen } = r.load('src/services/onboarding-seen.ts');
        assert.equal(await readOnboardingSeen(), false);
        assert.equal(await markOnboardingSeen(), true);
        assert.equal(await readOnboardingSeen(), true);
        const store = platform === 'web' ? s.web : s.disk;
        assert.deepEqual([...store.entries()], [[SEEN_KEY130, '1']]);
        assert.equal((platform === 'web' ? s.disk : s.web).size, 0);
        s.faults.read = true; assert.equal(await readOnboardingSeen(), false);
        s.faults.read = false; s.faults.write = true; store.clear();
        assert.equal(await markOnboardingSeen(), false); assert.equal(await readOnboardingSeen(), false);
        store.set(SEEN_KEY130, 'yes'); s.faults.write = false; assert.equal(await readOnboardingSeen(), false);
        if (platform !== 'web') {
            s.faults.hang = true; const pending = markOnboardingSeen(); await settle();
            r.advance(999); let done = false; void pending.then(() => { done = true; }); await settle(); assert.equal(done, false);
            r.advance(1); assert.equal(await pending, false); assert.equal(r.timers.size, 0);
        }
    }
    // 웹에서 localStorage 가 없거나 접근 자체가 막혀도 예외를 던지지 않아요.
    for (const broken of [undefined, 'throw']) {
        const r = createRuntime(serverEnv); r.native.Platform.OS = 'web';
        if (broken === 'throw') Object.defineProperty(r.context, 'localStorage', { get() { throw Error('SecurityError'); } });
        const { readOnboardingSeen, markOnboardingSeen } = r.load('src/services/onboarding-seen.ts');
        assert.equal(await readOnboardingSeen(), false); assert.equal(await markOnboardingSeen(), false);
    }
    // 기기에서 저장소 모듈을 불러오지 못해도 예외를 던지지 않아요.
    const r = createRuntime(serverEnv); r.native.Platform.OS = 'ios';
    const { readOnboardingSeen, markOnboardingSeen } = r.load('src/services/onboarding-seen.ts');
    assert.equal(await readOnboardingSeen(), false); assert.equal(await markOnboardingSeen(), false);
});

/** 시작 화면(index.tsx). Animated 는 가짜로 두고 이동만 기록해요. */
function splash130(env = serverEnv, platform = 'ios') {
    let storage;
    const r = createScreenRuntime(env, 'src/app/index.tsx', runtime => {
        storage = storage130(runtime, platform);
        runtime.native.Animated = { Value: class { interpolate() { return this; } }, View: 'Animated.View', timing: () => ({}), parallel: () => ({ start() {} }), multiply: () => 0, subtract: () => 0 };
        runtime.native.Easing = { out: value => value, ease: 0 };
    });
    r.storage = storage; r.routes = [];
    r.external['expo-router'].router.replace = route => r.routes.push(route);
    r.store = r.load('src/stores/auth-store.ts');
    return r;
}

test('130 서버 시작 화면: 세션 있음은 홈, 세션 없음은 본 적 여부로 온보딩·로그인, 읽기 실패는 온보딩', async () => {
    for (const [name, prepare, expected] of [
        ['세션 있음', r => { r.store.signIn({ userId: 'u', nickname: 'n' }); r.storage.disk.set(SEEN_KEY130, '1'); }, '/home'],
        ['세션 있음 + 본 적 없음', r => r.store.signIn({ userId: 'u', nickname: 'n' }), '/home'],
        ['세션 없음 + 본 적 없음', r => r.store.signOut(), '/onboarding-1'],
        ['세션 없음 + 본 적 있음', r => { r.store.signOut(); r.storage.disk.set(SEEN_KEY130, '1'); }, '/login'],
        ['세션 없음 + 읽기 실패', r => { r.store.signOut(); r.storage.disk.set(SEEN_KEY130, '1'); r.storage.faults.read = true; }, '/onboarding-1'],
    ]) {
        const r = splash130(); prepare(r);
        r.render(); await settle();
        r.advance(1499); await settle(); assert.deepEqual(r.routes, [], name);
        r.advance(1); await settle(); assert.deepEqual(r.routes, [expected], name);
        r.advance(5000); await settle(); assert.deepEqual(r.routes, [expected], name);
        assert.ok(r.storage.calls.every(call => call[0] === 'get'), name);
        r.unmount();
    }
});

test('130 서버 시작 화면: 늦은 읽기는 도착하면 이동, 멈춘 읽기는 1초 더 기다린 뒤 온보딩, 떠난 뒤에는 이동 안 함', async () => {
    // 늦은 읽기: 1.5초 뒤 도착하면 그때 이동해요.
    let r = splash130(); r.store.signOut(); let resolve;
    r.external['expo-secure-store'].getItemAsync = () => new Promise(done => { resolve = done; });
    r.render(); await settle(); r.advance(1500); await settle(); assert.deepEqual(r.routes, []);
    r.advance(400); resolve('1'); await settle(); assert.deepEqual(r.routes, ['/login']);
    r.advance(5000); await settle(); assert.deepEqual(r.routes, ['/login']); r.unmount();
    // 멈춘 읽기: 2.5초에 본 적 없는 것으로 보고 온보딩, 그 뒤 도착한 값은 무시해요.
    r = splash130(); r.store.signOut();
    r.external['expo-secure-store'].getItemAsync = () => new Promise(done => { resolve = done; });
    r.render(); await settle(); r.advance(2499); await settle(); assert.deepEqual(r.routes, []);
    r.advance(1); await settle(); assert.deepEqual(r.routes, ['/onboarding-1']);
    resolve('1'); await settle(); assert.deepEqual(r.routes, ['/onboarding-1']); r.unmount();
    // 세션이 있으면 읽기를 기다리지 않아요.
    r = splash130(); r.store.signIn({ userId: 'u', nickname: 'n' }); r.storage.faults.hang = true;
    r.render(); await settle(); r.advance(1500); await settle(); assert.deepEqual(r.routes, ['/home']); r.unmount();
    // 화면을 떠난 뒤에는 이동하지 않아요(애니메이션 중, 추가 대기 중 모두).
    for (const leaveAt of [1000, 2000]) {
        r = splash130(); r.store.signOut();
        r.external['expo-secure-store'].getItemAsync = () => new Promise(done => { resolve = done; });
        r.render(); await settle(); r.advance(leaveAt); await settle(); r.unmount();
        resolve('1'); r.advance(5000); await settle(); assert.deepEqual(r.routes, []); assert.equal(r.timers.size, 0);
    }
});

test('130 mock 시작 화면은 이전과 같이 1.5초 뒤 항상 온보딩이고 표시를 읽지도 쓰지도 않아요', async () => {
    for (const platform of ['ios', 'web']) for (const signedIn of [false, true]) {
        const r = splash130({}, platform); r.storage.disk.set(SEEN_KEY130, '1'); r.storage.web.set(SEEN_KEY130, '1');
        if (signedIn) r.store.signIn({ userId: 'u', nickname: 'n' });
        r.render(); await settle(); r.advance(1499); assert.deepEqual(r.routes, []);
        r.advance(1); assert.deepEqual(r.routes, ['/onboarding-1']);
        assert.deepEqual(r.storage.calls, []); assert.equal(r.timers.size, 0); r.unmount();
    }
});

test('130 공개 경로: 로그인 전에도 /·/permission·온보딩·로그인은 열리고 나머지는 /login 으로', () => {
    const publicPaths = ['/', '/permission', '/login', '/onboarding-1', '/onboarding-3'];
    const privatePaths = ['/home', '/my', '/route-guide', '/rooms', '/permission/extra', '/permissions', '/login2', '/ai-direction'];
    for (const status of ['signedOut', 'signedIn']) for (const pathname of [...publicPaths, ...privatePaths]) {
        const r = createRuntime(serverEnv, { useEffect() {}, useState: () => ['', () => {}], useSyncExternalStore: (_, get) => get() });
        r.external['expo-router'].usePathname = () => pathname;
        r.external['expo-router'].Redirect = 'Redirect';
        const module = r.load('src/components/auth-gate.tsx');
        const store = r.load('src/stores/auth-store.ts');
        if (status === 'signedOut') store.signOut(); else store.signIn({ userId: 'u', nickname: 'n' });
        const view = module.default({ children: '화면' });
        const open = status === 'signedIn' || publicPaths.includes(pathname);
        assert.equal(module.isPublicRoute(pathname), publicPaths.includes(pathname), pathname);
        if (open) assert.deepEqual(plain(view.props.children.filter(Boolean)), ['화면'], pathname);
        else { assert.equal(view.type, 'Redirect', pathname); assert.equal(view.props.href, '/login'); }
        // 복원 중에는 공개 경로여도 지금처럼 가려요.
        store.startRestoring();
        assert.ok(findElement(module.default({ children: '화면' }), element => element.type === 'ActivityIndicator'), pathname);
    }
});

/** 권한 안내 화면 */
function permission130(env = serverEnv) {
    let storage;
    const r = createScreenRuntime(env, 'src/app/permission.tsx', runtime => { storage = storage130(runtime, 'ios'); });
    r.storage = storage; r.order = [];
    r.external['expo-router'].router.replace = route => r.order.push(['route', route]);
    const origin = storage.calls.push.bind(storage.calls);
    storage.calls.push = (...items) => { items.forEach(item => r.order.push(item)); return origin(...items); };
    r.external['expo-image-picker'].requestCameraPermissionsAsync = async () => { r.order.push(['camera']); return { granted: false }; };
    r.external['expo-location'].requestForegroundPermissionsAsync = async () => { r.order.push(['location']); throw Error(); };
    r.button = text => findElement(r.render(), el => el.type === 'Pressable' && findText(el, text));
    return r;
}

test('130 권한 안내: 서버 모드는 계속·나중에 둘 다 본 적 있음 저장 뒤 로그인, 저장 실패·멈춤에도 로그인', async () => {
    for (const later of [false, true]) {
        let r = permission130();
        const pending = r.button(later ? '나중에 할게요' : '시작하기').props.onPress();
        r.button('시작하기').props.onPress(); r.button('나중에 할게요').props.onPress(); // 이중 탭은 무시
        await pending; await settle();
        assert.deepEqual(r.order, [...(later ? [] : [['camera'], ['location']]), ['set', SEEN_KEY130, '1'], ['route', '/login']]);
        assert.deepEqual([...r.storage.disk.entries()], [[SEEN_KEY130, '1']]); r.unmount();

        r = permission130(); r.storage.faults.write = true;
        await r.button(later ? '나중에 할게요' : '시작하기').props.onPress(); await settle();
        assert.deepEqual(r.order.at(-1), ['route', '/login']); assert.equal(r.storage.disk.size, 0); r.unmount();

        r = permission130(); r.storage.faults.hang = true;
        const hung = r.button(later ? '나중에 할게요' : '시작하기').props.onPress(); await settle();
        assert.equal(r.order.some(item => item[0] === 'route'), false);
        r.advance(1000); await hung; await settle(); assert.deepEqual(r.order.at(-1), ['route', '/login']); r.unmount();
    }
});

test('130 권한 안내: mock 모드는 저장하지 않고 이전처럼 로그인으로', async () => {
    for (const later of [false, true]) {
        const r = permission130({});
        const result = r.button(later ? '나중에 할게요' : '시작하기').props.onPress();
        if (later) assert.deepEqual(r.order, [['route', '/login']]); // 나중에는 이전처럼 바로 이동해요.
        await result; await settle();
        assert.deepEqual(r.order, [...(later ? [] : [['camera'], ['location']]), ['route', '/login']]);
        assert.equal(r.storage.calls.length, 0); r.unmount();
    }
});

test('130 권한 응답 → 표시 상태와 글자·동작·접근성 문구', () => {
    const { toPermissionState, PERMISSION_DISPLAY, permissionAccessibilityLabel, APP_PERMISSIONS } = createRuntime().load('src/utils/app-permission.ts');
    const cases = [
        [{ status: 'granted', granted: true, canAskAgain: true }, 'granted'], [{ status: 'denied', granted: false, canAskAgain: false }, 'denied'],
        [{ status: 'denied', granted: false, canAskAgain: true }, 'denied'], [{ status: 'undetermined', granted: false, canAskAgain: true }, 'undetermined'],
        [{ granted: true }, 'granted'], [{ granted: false }, 'unknown'], [{ status: 'future' }, 'unknown'], [null, 'unknown'], [undefined, 'unknown'], ['granted', 'unknown'],
    ];
    for (const [response, expected] of cases) assert.equal(toPermissionState(response), expected, JSON.stringify(response));
    assert.deepEqual(plain(PERMISSION_DISPLAY), {
        granted: { text: '허용', hint: '', action: 'settings', spoken: '허용, 설정 열기' },
        denied: { text: '허용 안 함', hint: '설정에서 바꿀 수 있어요', action: 'settings', spoken: '허용 안 함, 설정에서 바꿀 수 있어요. 설정 열기' },
        undetermined: { text: '아직 묻지 않음', hint: '눌러서 허용할 수 있어요', action: 'request', spoken: '아직 묻지 않음, 눌러서 권한 요청' },
        unknown: { text: '확인할 수 없음', hint: '눌러서 다시 확인해요', action: 'refresh', spoken: '확인할 수 없음, 눌러서 다시 확인' },
    });
    assert.equal(permissionAccessibilityLabel('카메라', 'loading'), '카메라 권한 확인 중');
    assert.equal(permissionAccessibilityLabel('위치', 'denied'), '위치 권한 허용 안 함, 설정에서 바꿀 수 있어요. 설정 열기');
    assert.deepEqual(plain(APP_PERMISSIONS), [{ key: 'camera', label: '카메라' }, { key: 'location', label: '위치' }]);
});

/** 마이 화면의 권한 줄. 조회·요청·설정 열기를 기록해요. */
function myPermission130(env = serverEnv) {
    const r = createScreenRuntime(env, 'src/app/my.tsx', runtime => {
        myPermissionSetup(runtime);
        let focus; let blur;
        runtime.external['expo-router'].useFocusEffect = callback => { if (focus !== callback) { blur?.(); focus = callback; blur = callback(); } };
        runtime.blur = () => { blur?.(); blur = undefined; };
        runtime.focus = () => { blur = focus(); };
        runtime.mock = { queries: [], requests: [], opened: 0 };
        runtime.native.Linking = { openSettings: async () => { runtime.mock.opened++; } };
        const picker = runtime.external['expo-image-picker']; const location = runtime.external['expo-location'];
        picker.getCameraPermissionsAsync = () => { runtime.mock.queries.push('camera'); return runtime.mock.answer('camera'); };
        location.getForegroundPermissionsAsync = () => { runtime.mock.queries.push('location'); return runtime.mock.answer('location'); };
        picker.requestCameraPermissionsAsync = async () => { runtime.mock.requests.push('camera'); return runtime.permissions.cameraRequest; };
        location.requestForegroundPermissionsAsync = async () => { runtime.mock.requests.push('location'); return runtime.permissions.locationRequest; };
        runtime.mock.answer = async key => { const value = runtime.permissions[key]; if (value instanceof Error) throw value; return value; };
    });
    r.load('src/stores/auth-store.ts').signIn({ userId: 'user-1', nickname: '이전이름' });
    r.context.fetch = async () => ok(userData());
    r.row = (label, view = r.render()) => findElement(view, el => el.type === 'Pressable' && el.props.accessibilityLabel?.startsWith(`${label} 권한`));
    r.shown = label => {
        const row = r.row(label);
        const texts = []; const collect = node => { if (Array.isArray(node)) node.forEach(collect); else if (node?.type === 'Text') texts.push(textOf(node)); else if (node?.props) collect(node.props.children); };
        collect(row.props.children);
        return { texts, label: row.props.accessibilityLabel, spinner: !!findElement(row.props.children, el => el.type === 'ActivityIndicator'), disabled: row.props.disabled };
    };
    return r;
}
const permission130State = status => ({ status, granted: status === 'granted', canAskAgain: status !== 'denied', expires: 'never' });

test('130 마이 권한: 조회 중에는 가짜 값 없이 확인 중, 4가지 상태의 글자·안내·접근성 문구', async () => {
    const r = myPermission130(); const finishers = []; const finish = () => finishers.splice(0).forEach(fn => fn());
    r.permissions.camera = permission130State('denied');
    r.mock.answer = key => new Promise(done => { finishers.push(done); }).then(() => r.permissions[key]);
    r.render();
    for (const label of ['카메라', '위치']) {
        assert.deepEqual(plain(r.shown(label)), { texts: [label], label: `${label} 권한 확인 중`, spinner: true, disabled: true });
    }
    finish(); await flush();
    for (const [status, text, hint, color] of [['granted', '허용', null, '#12a77a'], ['denied', '허용 안 함', '설정에서 바꿀 수 있어요', '#e5484d'],
        ['undetermined', '아직 묻지 않음', '눌러서 허용할 수 있어요', '#6b7488'], [Error('조회 실패'), '확인할 수 없음', '눌러서 다시 확인해요', '#6b7488']]) {
        const v = myPermission130(); v.permissions.camera = typeof status === 'string' ? permission130State(status) : status;
        v.render(); await flush();
        const shown = v.shown('카메라');
        assert.deepEqual(plain(shown.texts), ['카메라', ...(hint ? [hint] : []), text]);
        assert.equal(shown.spinner, false); assert.equal(shown.disabled, false);
        assert.equal(shown.label, `카메라 권한 ${v.load('src/utils/app-permission.ts').PERMISSION_DISPLAY[typeof status === 'string' ? status : 'unknown'].spoken}`);
        const stateText = findElement(v.row('카메라').props.children, el => el.type === 'Text' && textOf(el) === text);
        assert.equal(stateText.props.style[1].color, color);
        assert.deepEqual(plain(v.shown('위치').texts), ['위치', '허용']);
        v.unmount();
    }
    r.unmount();
});

test('130 마이 권한: 허용·허용 안 함은 설정 열기, 아직 묻지 않음은 바로 요청 후 갱신, 확인할 수 없음은 다시 조회', async () => {
    const r = myPermission130();
    r.permissions.camera = permission130State('undetermined'); r.permissions.location = permission130State('denied');
    r.permissions.cameraRequest = permission130State('granted');
    r.render(); await flush(); assert.deepEqual(r.mock.queries, ['camera', 'location']);
    r.row('위치').props.onPress(); await flush(); assert.equal(r.mock.opened, 1); assert.deepEqual(r.mock.requests, []);
    r.row('카메라').props.onPress(); r.row('카메라').props.onPress(); await flush();
    assert.deepEqual(r.mock.requests, ['camera']); assert.equal(r.mock.opened, 1);
    assert.deepEqual(plain(r.shown('카메라').texts), ['카메라', '허용']);
    r.row('카메라').props.onPress(); await flush(); assert.equal(r.mock.opened, 2); assert.deepEqual(r.mock.requests, ['camera']);
    // 요청이 실패하면 확인할 수 없음, 누르면 다시 조회해요.
    r.permissions.location = permission130State('undetermined'); r.mock.queries.length = 0;
    r.render(); r.native.AppState.change('active'); await flush(); assert.deepEqual(plain(r.shown('위치').texts), ['위치', '눌러서 허용할 수 있어요', '아직 묻지 않음']);
    r.permissions.locationRequest = undefined; r.row('위치').props.onPress(); await flush();
    assert.deepEqual(plain(r.shown('위치').texts), ['위치', '눌러서 다시 확인해요', '확인할 수 없음']);
    r.permissions.location = permission130State('granted'); r.mock.queries.length = 0;
    r.row('위치').props.onPress(); await flush(); assert.deepEqual(r.mock.queries, ['camera', 'location']);
    assert.deepEqual(plain(r.shown('위치').texts), ['위치', '허용']); assert.equal(r.mock.opened, 2);
    r.unmount();
});

test('130 마이 권한: 앱이 다시 앞으로 오면(설정에서 돌아오면) 다시 조회해 갱신, 화면을 떠난 뒤 응답은 무시, 멈춘 조회는 확인할 수 없음', async () => {
    const r = myPermission130(); r.render(); await flush();
    assert.deepEqual(plain(r.shown('카메라').texts), ['카메라', '허용']);
    r.permissions.camera = permission130State('denied'); r.mock.queries.length = 0;
    r.native.AppState.change('background'); await flush(); assert.deepEqual(r.mock.queries, []);
    r.native.AppState.change('active'); await flush(); assert.deepEqual(r.mock.queries, ['camera', 'location']);
    assert.deepEqual(plain(r.shown('카메라').texts), ['카메라', '설정에서 바꿀 수 있어요', '허용 안 함']);
    // 화면을 떠난 뒤에는 조회하지 않고, 늦게 온 응답도 반영하지 않아요. 다시 들어오면 조회해요.
    const finishers = []; const finish = () => finishers.splice(0).forEach(fn => fn());
    r.mock.answer = key => new Promise(done => { finishers.push(() => done(r.permissions[key])); });
    r.native.AppState.change('active'); r.blur(); r.permissions.camera = permission130State('granted'); finish(); await flush();
    assert.deepEqual(plain(r.shown('카메라').texts), ['카메라', '설정에서 바꿀 수 있어요', '허용 안 함']);
    r.mock.queries.length = 0; r.native.AppState.change('active'); await flush(); assert.deepEqual(r.mock.queries, []);
    r.mock.answer = async key => r.permissions[key]; r.focus(); await flush();
    assert.deepEqual(r.mock.queries, ['camera', 'location']); assert.deepEqual(plain(r.shown('카메라').texts), ['카메라', '허용']);
    // 조회가 멈추면 5초 뒤 확인할 수 없음이에요.
    r.mock.answer = () => new Promise(() => {}); r.native.AppState.change('active'); await flush(); r.advance(5000); await flush();
    assert.deepEqual(plain(r.shown('카메라').texts), ['카메라', '눌러서 다시 확인해요', '확인할 수 없음']);
    r.unmount(); assert.equal(r.native.AppState.listeners.size, 0);
});

test('130 마이 권한은 mock 모드도 실제 조회 결과를 보여줘요', async () => {
    const r = myPermission130({}); r.permissions.camera = permission130State('denied'); r.permissions.location = permission130State('undetermined');
    r.render(); await flush(); r.advance(2000); await flush();
    assert.deepEqual(r.mock.queries, ['camera', 'location']);
    assert.deepEqual(plain(r.shown('카메라').texts), ['카메라', '설정에서 바꿀 수 있어요', '허용 안 함']);
    assert.deepEqual(plain(r.shown('위치').texts), ['위치', '눌러서 허용할 수 있어요', '아직 묻지 않음']);
    const source = fs.readFileSync(path.join(root, 'src/app/my.tsx'), 'utf8');
    assert.equal(source.includes('MOCK_PERMISSIONS'), false); assert.equal(/granted:\s*true/.test(source), false);
    r.unmount();
});

/* ---------- #129 경로 안내 화면 카카오맵 ---------- */

const CONGESTION_COLOR129 = { COMFORTABLE: '#19b36b', RELAXED: '#8cc63f', NORMAL: '#e5a800', CROWDED: '#f07a1f', VERY_CROWDED: '#e5484d' };
const congestion129 = (level, kind = 'PREDICTED') => level
    ? { supported: true, kind, pct: 80, level, levelLabel: '서버 라벨' }
    : { supported: false, kind: null, pct: null, level: null, levelLabel: null };
const station129 = (id, congestion) => ({ id, name: `역${id}`, slotStart: '08:00', slotDate: null, firstTrain: false, congestion });
function step129(type, overrides = {}) {
    return {
        type, guidance: '안내', durationSec: 60, distanceM: 100, direction: null, directionCode: null, stops: [], path: null, stations: [],
        line: type === 'SUBWAY' ? { id: 2, name: '2호선', color: '#00a84d' } : null, ...overrides,
    };
}
/** 도보 → 2호선(혼잡도 있음) → 4호선(혼잡도 없음, 노선 색) → 4호선 다시(연달아 같은 노선) → 7호선(노선 색 없음) */
function route129() {
    return {
        routeId: 'route-129', routeType: null,
        summary: { noService: false, serviceNotice: null, arrivesAfterAppointment: false, totalTimeSec: 1800, arrivalAt: '2026-11-13T09:00:00+09:00',
            fare: 1500, fareSource: 'KAKAO', transferCount: 3, walkingMinutes: 2, congestion: congestion129('CROWDED') },
        steps: [
            step129('WALKING', { path: [[126.99, 37.49], [127.0, 37.5]] }),
            step129('SUBWAY', { path: [[127.0, 37.5], [127.01, 37.51], [127.02, 37.52]],
                stops: [{ id: 1, name: '출발역', order: 0 }, { id: 2, name: '환승1', order: 1 }],
                stations: [station129(1, congestion129('NORMAL', 'ESTIMATED')), station129(2, congestion129('CROWDED', 'ESTIMATED')), station129(3, congestion129(null))] }),
            step129('SUBWAY', { line: { id: 4, name: '4호선', color: '#00a5de' }, path: [[127.02, 37.52], [127.03, 37.53]],
                stations: [station129(4, congestion129(null)), station129(5, { ...congestion129('VERY_CROWDED'), supported: false })] }),
            step129('SUBWAY', { line: { id: 4, name: '4호선', color: '#00a5de' }, path: [[127.03, 37.53], [127.04, 37.54]] }),
            step129('SUBWAY', { line: { id: 7, name: '7호선', color: null }, path: [[127.04, 37.54], [127.05, 37.55]] }),
        ],
    };
}
const routeMap129 = () => createRuntime().load('src/utils/route-map.ts');

test('129 경로 → 지도: [경도, 위도] 변환, 환승 여러 개 마커, 구간 색, 도보 점선, 노선 목록', () => {
    const { buildRouteMap, ROUTE_MARKER_COLOR, WALK_LINE_COLOR, NO_DATA_LINE_COLOR } = routeMap129();
    const map = plain(buildRouteMap(route129()));
    assert.deepEqual(map.lines.map(l => [l.id, l.color, l.dashed ?? false]), [
        [0, WALK_LINE_COLOR, true], [1, CONGESTION_COLOR129.CROWDED, false], [2, '#00a5de', false], [3, '#00a5de', false], [4, NO_DATA_LINE_COLOR, false]]);
    assert.deepEqual(map.lines[1].points[0], { latitude: 37.5, longitude: 127.0 });
    assert.deepEqual(map.markers.map(m => [m.kind, m.latitude, m.longitude, m.color]), [
        ['origin', 37.5, 127.0, ROUTE_MARKER_COLOR.origin], ['transfer', 37.52, 127.02, ROUTE_MARKER_COLOR.transfer],
        ['transfer', 37.53, 127.03, ROUTE_MARKER_COLOR.transfer], ['transfer', 37.54, 127.04, ROUTE_MARKER_COLOR.transfer],
        ['destination', 37.55, 127.05, ROUTE_MARKER_COLOR.destination]]);
    assert.equal(new Set(Object.values(ROUTE_MARKER_COLOR)).size, 3);
    assert.deepEqual(map.markers.map(m => m.id), [0, 1, 2, 3, 4]); assert.ok(map.markers.every(m => m.isSupported === true));
    assert.deepEqual(map.routeLines, [{ id: 2, name: '2호선', color: '#00a84d' }, { id: 4, name: '4호선', color: '#00a5de' }, { id: 7, name: '7호선', color: null }]);
    assert.deepEqual(map.bounds, { minLng: 126.99, minLat: 37.49, maxLng: 127.05, maxLat: 37.55 });
    assert.equal(map.usesCongestion, true); assert.equal(map.usesLineColor, true); assert.equal(map.estimated, true); assert.equal(map.mock, false);
});

test('129 경로 → 지도: path 없음·점 1개·구간 1개·노선 하나·잘못된 좌표', () => {
    const { buildRouteMap, toCoordinates } = routeMap129();
    const { DEFAULT_MAP_CENTER } = createRuntime().load('src/utils/home-map.ts');
    // path 가 모두 없으면 선·마커·범위 없이 기본 중심
    const none = route129(); none.steps.forEach(step => { step.path = null; });
    const empty = plain(buildRouteMap(none));
    assert.deepEqual([empty.lines, empty.markers, empty.bounds, empty.center], [[], [], null, plain(DEFAULT_MAP_CENTER)]);
    assert.equal(empty.routeLines.length, 3); assert.equal(empty.usesCongestion, false); assert.equal(empty.estimated, false);
    // 환승 구간 path 가 없으면 그 마커와 선만 생략
    const partial = route129(); partial.steps[2].path = null; partial.steps[4].path = [[127.04, 37.54]];
    const p = plain(buildRouteMap(partial));
    assert.deepEqual(p.lines.map(l => l.id), [0, 1, 3]);
    assert.deepEqual(p.markers.map(m => m.kind), ['origin', 'transfer', 'transfer', 'destination']);
    assert.deepEqual([p.markers[3].latitude, p.markers[3].longitude], [37.54, 127.04]);
    // 구간 1개, 노선 하나
    const single = { ...route129(), steps: [step129('SUBWAY', { path: [[127.0, 37.5], [127.01, 37.51]] })] };
    const s = plain(buildRouteMap(single));
    assert.deepEqual(s.markers.map(m => m.kind), ['origin', 'destination']); assert.deepEqual(s.routeLines, [{ id: 2, name: '2호선', color: '#00a84d' }]);
    assert.deepEqual(s.lines.map(l => l.color), ['#00a84d']); assert.equal(s.usesLineColor, true);
    // [경도, 위도] 순서와 범위 밖·형식 틀린 점 버리기
    assert.deepEqual(plain(toCoordinates([[127, 37.5], [37.5, 127], [181, 37], [127, -91], [NaN, 1], ['127', '37'], [127], null, [126.9, 37.4, 9]])),
        [{ latitude: 37.5, longitude: 127 }, { latitude: 37.4, longitude: 126.9 }]);
    assert.deepEqual(plain(toCoordinates(null)), []); assert.deepEqual(plain(toCoordinates('x')), []);
    const bad = { ...route129(), steps: [step129('SUBWAY', { path: [[127, 37.5], [200, 37.5], [127.01, 37.51], [127, 95]] })] };
    assert.deepEqual(plain(buildRouteMap(bad).lines[0].points), [{ latitude: 37.5, longitude: 127 }, { latitude: 37.51, longitude: 127.01 }]);
    const onlyBad = { ...route129(), steps: [step129('SUBWAY', { path: [[200, 37.5], [127, 95]] })] };
    assert.equal(buildRouteMap(onlyBad).lines.length, 0); assert.equal(buildRouteMap(onlyBad).markers.length, 0);
});

test('129 긴 path 는 처음과 끝을 지키며 상한 안으로 고르게 줄여요', () => {
    const { buildRouteMap, thinPoints } = routeMap129();
    const { MAP_LIMITS, isValidMapLines } = createRuntime().load('src/components/map/map-html.ts');
    assert.deepEqual(plain(thinPoints([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)), [1, 5, 9]);
    assert.deepEqual(plain(thinPoints([1, 2, 3], 5)), [1, 2, 3]); assert.deepEqual(plain(thinPoints([1, 2, 3], 1)), [1, 3]);
    const long = Array.from({ length: 4000 }, (_, i) => [127 + i / 100000, 37.5 + i / 100000]);
    const one = buildRouteMap({ ...route129(), steps: [step129('SUBWAY', { path: long })] });
    assert.equal(one.lines[0].points.length, MAP_LIMITS.linePoints);
    assert.deepEqual(plain(one.lines[0].points[0]), { latitude: 37.5, longitude: 127 });
    assert.deepEqual(plain(one.lines[0].points.at(-1)), { latitude: 37.5 + 3999 / 100000, longitude: 127 + 3999 / 100000 });
    assert.deepEqual(plain(one.markers.at(-1)), { id: 1, latitude: 37.5 + 3999 / 100000, longitude: 127 + 3999 / 100000, isSupported: true, kind: 'destination', color: one.markers.at(-1).color });
    const many = buildRouteMap({ ...route129(), steps: Array.from({ length: 12 }, () => step129('SUBWAY', { path: long })) });
    const total = many.lines.reduce((sum, line) => sum + line.points.length, 0);
    assert.ok(total <= MAP_LIMITS.totalPoints); assert.equal(isValidMapLines(plain(many.lines)), true);
    const tooMany = buildRouteMap({ ...route129(), steps: Array.from({ length: 80 }, () => step129('WALKING', { path: [[127, 37.5], [127.01, 37.51]] })) });
    assert.equal(tooMany.lines.length, MAP_LIMITS.lines); assert.equal(isValidMapLines(plain(tooMany.lines)), true);
});

test('129 범위: 점 하나·폭 0은 넓히고, 그릴 것이 없으면 null', () => {
    const { coordinateBounds, buildRouteMap } = routeMap129();
    const { isMapBounds } = createRuntime().load('src/utils/home-map.ts');
    assert.equal(coordinateBounds([]), null);
    const one = coordinateBounds([{ latitude: 37.5, longitude: 127 }]);
    assert.equal(isMapBounds(one), true); assert.ok(one.minLat < 37.5 && one.maxLat > 37.5 && one.minLng < 127 && one.maxLng > 127);
    const flat = coordinateBounds([{ latitude: 37.5, longitude: 127 }, { latitude: 37.5, longitude: 127.1 }]);
    assert.equal(isMapBounds(flat), true); assert.deepEqual([flat.minLng, flat.maxLng], [127, 127.1]); assert.ok(flat.maxLat > flat.minLat);
    for (const edge of [{ latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 }]) assert.equal(isMapBounds(coordinateBounds([edge])), true);
    const point = buildRouteMap({ ...route129(), steps: [step129('SUBWAY', { path: [[127, 37.5]] })] });
    assert.equal(point.lines.length, 0); assert.deepEqual(plain(point.markers.map(m => m.kind)), ['origin', 'destination']);
    assert.equal(isMapBounds(point.bounds), true); assert.deepEqual(plain(point.center), { latitude: 37.5, longitude: 127 });
});

test('129 혼잡도 → 선 색: 5단계, 가장 높은 단계, 정보 없음은 노선 색, 노선 색 없음은 회색', () => {
    const { stepLineColor, stepCongestion, NO_DATA_LINE_COLOR, WALK_LINE_COLOR, CONGESTION_LEVELS, CONGESTION_LEVEL_LABEL } = routeMap129();
    const { CONGESTION_STYLE, UNSUPPORTED_COLOR } = createRuntime().load('src/components/route/Congestion.tsx');
    assert.deepEqual(plain(CONGESTION_LEVELS), Object.keys(CONGESTION_COLOR129));
    assert.deepEqual(plain(CONGESTION_LEVEL_LABEL), { COMFORTABLE: '쾌적', RELAXED: '여유', NORMAL: '보통', CROWDED: '혼잡', VERY_CROWDED: '매우 혼잡' });
    for (const level of CONGESTION_LEVELS) {
        assert.equal(stepLineColor(step129('SUBWAY', { stations: [station129(1, congestion129(level))] })), CONGESTION_STYLE[level].color);
        assert.equal(CONGESTION_STYLE[level].color, CONGESTION_COLOR129[level]);
    }
    const mixed = step129('SUBWAY', { stations: [station129(1, congestion129('VERY_CROWDED', 'MOCK')), station129(2, congestion129('RELAXED')), station129(3, congestion129(null))] });
    assert.equal(stepLineColor(mixed), CONGESTION_COLOR129.VERY_CROWDED); assert.equal(stepCongestion(mixed).kind, 'MOCK');
    for (const stations of [[], undefined, [station129(1, congestion129(null))], [station129(1, null)], [station129(1, { ...congestion129('NORMAL'), supported: false })]]) {
        assert.equal(stepLineColor(step129('SUBWAY', { stations })), '#00a84d');
    }
    for (const color of [null, '', 'red', '#00a84', '00a84d']) assert.equal(stepLineColor(step129('SUBWAY', { line: { id: 2, name: '2호선', color } })), NO_DATA_LINE_COLOR);
    assert.equal(stepLineColor(step129('SUBWAY', { line: null })), NO_DATA_LINE_COLOR);
    assert.equal(NO_DATA_LINE_COLOR, UNSUPPORTED_COLOR);
    assert.equal(stepLineColor(step129('WALKING', { stations: [station129(1, congestion129('CROWDED'))] })), WALK_LINE_COLOR);
    // 혼잡도 데이터는 바꾸지 않아요.
    const route = route129(); const before = JSON.stringify(route); routeMap129().buildRouteMap(route); assert.equal(JSON.stringify(route), before);
    // 칠한 혼잡도의 kind 만 범례에 반영해요(MOCK 은 임시).
    const mock = route129(); mock.steps[1].stations = [station129(1, congestion129('NORMAL', 'MOCK'))];
    const built = routeMap129().buildRouteMap(mock); assert.equal(built.mock, true); assert.equal(built.estimated, false);
    mock.steps[1].path = null; assert.equal(routeMap129().buildRouteMap(mock).mock, false);
});

test('129 노선 목록: 타는 순서, 연달아 같은 노선은 한 번, 다시 타면 다시, 이름·색 없으면 있는 값만', () => {
    const { buildRouteMap } = routeMap129();
    const line = (id, name, color) => step129('SUBWAY', { line: { id, name, color } });
    const route = { ...route129(), steps: [line(2, '2호선', '#00a84d'), step129('WALKING'), line(2, '2호선', '#00a84d'), line(3, '3호선', '#ef7c1c'), line(2, '2호선', '#00a84d'),
            line(null, '신분당선', null), line(null, ' ', '#d4003b'), step129('SUBWAY', { line: null }), line(null, '', null)] };
    assert.deepEqual(plain(buildRouteMap(route).routeLines), [
        { id: 2, name: '2호선', color: '#00a84d' }, { id: 3, name: '3호선', color: '#ef7c1c' }, { id: 2, name: '2호선', color: '#00a84d' },
        { id: null, name: '신분당선', color: null }, { id: null, name: null, color: '#d4003b' }]);
    assert.deepEqual(plain(buildRouteMap({ ...route129(), steps: [step129('WALKING')] }).routeLines), []);
});

/** 웹뷰 HTML 안의 스크립트를 가짜 카카오 SDK 로 실행해요. */
function html129() {
    const html = createRuntime().load('src/components/map/map-html.ts').buildMapHtml('test');
    const listeners = {}; const dots = []; const polylines = []; const fits = []; let script;
    class LatLng { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } getLat() { return this.latitude; } getLng() { return this.longitude; } }
    const sandbox = {
        window: { ReactNativeWebView: { postMessage() {} }, addEventListener: (name, fn) => { listeners[name] = fn; } },
        document: { addEventListener() {}, getElementById: () => ({}), createElement: () => ({ style: {} }), head: { appendChild: el => { script = el; } } },
        kakao: { maps: { LatLng, load: fn => fn(), event: { addListener() {} },
                LatLngBounds: class { constructor(sw, ne) { this.sw = sw; this.ne = ne; } },
                Map: class { setCenter() {} setBounds(bounds, ...padding) { fits.push({ bounds, padding }); } getBounds() { return { getSouthWest: () => new LatLng(37.4, 126.9), getNorthEast: () => new LatLng(37.7, 127.2) }; } },
                CustomOverlay: class { constructor(options) { this.color = options.content.style.backgroundColor; dots.push(this); } setMap(v) { this.detached = v === null; } },
                Polyline: class { constructor(options) { this.options = options; polylines.push(this); } setMap(v) { this.detached = v === null; } },
            } },
    };
    vm.runInNewContext(html.split('<script>')[1].split('</script>')[0], sandbox); script.onload();
    const point = { latitude: 37.5, longitude: 127 };
    const base = { type: 'state', center: point, myLocation: null, revision: 0, markers: [] };
    return { html, dots, polylines, fits, base, point, send: value => listeners.message({ data: JSON.stringify(value) }) };
}
const line129 = (id = 1, color = '#00a84d', points = [{ latitude: 37.5, longitude: 127 }, { latitude: 37.51, longitude: 127.01 }]) => ({ id, color, points });
const fit129 = (revision = 1) => ({ bounds: { minLng: 126.99, minLat: 37.49, maxLng: 127.05, maxLat: 37.55 }, revision });

test('129 WebView: 선·색 마커·범위 맞춤은 번호가 바뀔 때만, 갱신 때 이전 선 지우기', () => {
    const h = html129();
    h.send({ ...h.base, markers: [{ ...h.point, id: 1, isSupported: true, color: '#2879ef' }, { ...h.point, id: 2, isSupported: false }],
        lines: [line129(1), { ...line129(2, '#8c93a3'), dashed: true }], fit: fit129(1) });
    assert.deepEqual(h.dots.map(d => d.color), ['#2879ef', '#8c93a3']);
    assert.deepEqual(h.polylines.map(p => [p.options.strokeColor, p.options.strokeStyle, p.options.path.length]), [['#00a84d', 'solid', 2], ['#8c93a3', 'shortdash', 2]]);
    assert.equal(h.fits.length, 1); assert.equal(h.fits[0].bounds.sw.latitude, 37.49); assert.equal(h.fits[0].bounds.ne.longitude, 127.05);
    // 같은 번호는 다시 맞추지 않고(사용자가 움직인 지도 유지), 선은 새로 그려요.
    h.send({ ...h.base, lines: [line129(3, '#e5484d')], fit: fit129(1) });
    assert.equal(h.fits.length, 1); assert.ok(h.polylines.slice(0, 2).every(p => p.detached)); assert.equal(h.polylines.length, 3);
    assert.ok(h.dots.slice(0, 2).every(d => d.detached));
    h.send({ ...h.base, lines: [line129(3, '#e5484d')], fit: fit129(2) }); assert.equal(h.fits.length, 2);
    h.send({ ...h.base }); assert.ok(h.polylines.every(p => p.detached)); assert.equal(h.fits.length, 2);
});

test('129 WebView: 형식이 틀린 color·상한 초과·좌표 범위 밖 메시지는 통째로 무시', () => {
    const h = html129();
    const { MAP_LIMITS } = createRuntime().load('src/components/map/map-html.ts');
    const points = n => Array.from({ length: n }, (_, i) => ({ latitude: 37.5, longitude: 127 + i / 1e5 }));
    const bad = [
        { markers: [{ ...h.point, id: 1, isSupported: true, color: 'red' }] },
        { markers: [{ ...h.point, id: 1, isSupported: true, color: '#12345' }] },
        { markers: [{ ...h.point, id: 1, isSupported: true, color: 'url(x)' }] },
        { lines: [line129(1, '#00a84dff')] }, { lines: [line129(1, 'rgb(0,0,0)')] }, { lines: [line129(1, '#00a84d;x')] },
        { lines: [line129(1.5)] }, { lines: [line129('1')] }, { lines: [{ ...line129(), dashed: 'yes' }] },
        { lines: [line129(1, '#00a84d', [{ latitude: 91, longitude: 127 }, h.point])] },
        { lines: [line129(1, '#00a84d', [{ latitude: 37.5, longitude: 181 }, h.point])] },
        { lines: [line129(1, '#00a84d', [h.point])] }, { lines: {} },
        { lines: Array.from({ length: MAP_LIMITS.lines + 1 }, (_, i) => line129(i)) },
        { lines: [line129(1, '#00a84d', points(MAP_LIMITS.linePoints + 1))] },
        { lines: Array.from({ length: 6 }, (_, i) => line129(i, '#00a84d', points(MAP_LIMITS.totalPoints / 5))) },
        { fit: { bounds: { minLng: 127, minLat: 37.5, maxLng: 127, maxLat: 37.6 }, revision: 1 } },
        { fit: { bounds: { minLng: 127, minLat: 37.5, maxLng: 181, maxLat: 37.6 }, revision: 1 } },
        { fit: { ...fit129(), revision: 1.5 } }, { fit: null },
    ];
    for (const change of bad) h.send({ ...h.base, markers: [{ ...h.point, id: 9, isSupported: true }], lines: [line129()], ...change });
    assert.deepEqual([h.dots.length, h.polylines.length, h.fits.length], [0, 0, 0]);
    // 상한에 딱 맞는 메시지는 그려요.
    h.send({ ...h.base, lines: Array.from({ length: 5 }, (_, i) => line129(i, '#00a84d', points(MAP_LIMITS.totalPoints / 5))) });
    assert.equal(h.polylines.length, 5);
});

test('129 HTML 에 경로·역 데이터가 들어가지 않고 CSP·이동 차단이 그대로예요', () => {
    const { buildMapHtml, isAllowedMapNavigation } = createRuntime().load('src/components/map/map-html.ts');
    const html = buildMapHtml('test');
    assert.equal(buildMapHtml.length, 1);
    for (const value of ['127.01', '37.51', '2호선', '#00a84d', '#00a5de', 'route-129']) assert.ok(!html.includes(value), value);
    assert.ok(html.includes(`content="default-src 'none'; form-action 'none'; base-uri 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://*.kakao.com https://*.daum.net https://*.daumcdn.net; style-src 'unsafe-inline'; img-src data: https://*.kakao.com https://*.daumcdn.net https://*.daum.net; connect-src https://*.kakao.com https://*.daum.net https://*.daumcdn.net"`));
    for (const url of ['https://kakao.com.evil.test', 'http://dapi.kakao.com', 'https://localhost:9999']) assert.equal(isAllowedMapNavigation(url), false);
});

/** 네이티브 KakaoMap 을 렌더해 WebView 로 보내는 메시지를 모아요. */
function nativeMap129(props) {
    const r = createScreenRuntime({ EXPO_PUBLIC_KAKAO_MAP_JS_KEY: 'test' }, 'src/components/KakaoMap.tsx');
    const posted = [];
    const point = { latitude: 37.5, longitude: 127 };
    const all = { center: point, myLocation: point, markers: [{ ...point, id: 1, isSupported: true }], onRegionChange() {}, ...props };
    const render = (next = all) => r.renderComponent({ type: r.screen.default, props: next });
    let view = render();
    const webView = findElement(view, e => e.type === 'WebView');
    webView.props.ref.current = { postMessage: message => posted.push(JSON.parse(message)) };
    webView.props.onMessage({ nativeEvent: { data: '{"type":"ready"}' } });
    view = render();
    return { r, posted, render, all, view };
}

test('129 네이티브 KakaoMap: 선택 값이 없으면 홈 지도 메시지 그대로, 있으면 lines·fit·color 를 보내요', () => {
    const home = nativeMap129({});
    assert.deepEqual(home.posted.map(m => Object.keys(m)), [['type', 'center', 'myLocation', 'markers', 'revision']]);
    const lines = [line129()]; const bounds = fit129().bounds;
    const route = nativeMap129({ myLocation: null, lines, fitBounds: bounds, fitRevision: 1, markers: [{ latitude: 37.5, longitude: 127, id: 0, isSupported: true, color: '#2879ef' }] });
    assert.deepEqual(route.posted.at(-1), { type: 'state', center: { latitude: 37.5, longitude: 127 }, myLocation: null,
        markers: [{ latitude: 37.5, longitude: 127, id: 0, isSupported: true, color: '#2879ef' }], revision: 0, lines, fit: { bounds, revision: 1 } });
    const count = route.posted.length; route.render(); assert.equal(route.posted.length, count);
    assert.equal(findElement(nativeMap129({ fitBounds: null }).view, e => e.type === 'WebView') !== null, true);
    assert.equal('fit' in nativeMap129({ fitBounds: null }).posted.at(-1), false);
});

test('129 웹 지도: 선과 색 마커, 갱신 때 이전 것 지우기, 범위 맞춤은 번호가 바뀔 때만, Polyline 없는 SDK 의 홈 지도', () => {
    const r = createRuntime(); const { validMapState, createWebMap } = r.load('src/components/map/map-web.ts');
    const f = webMap126Fixture(); const polylines = []; const fits = [];
    // 선이 없는 홈 지도는 Polyline·LatLngBounds 가 없어도 그대로 동작해요.
    const home = createWebMap(f.container, f.sdk, f.state, { onRegionChange() {}, onReady() {}, onError() { assert.fail(); } });
    home.update({ ...f.state, lines: [] }); home.dispose();
    const g = webMap126Fixture();
    g.sdk.Polyline = class { constructor(options) { this.options = options; polylines.push(this); } setMap(v) { this.detached = v === null; } };
    g.sdk.LatLngBounds = class { constructor(sw, ne) { this.sw = sw; this.ne = ne; } };
    g.sdk.Map.prototype.setBounds = function (bounds, ...padding) { fits.push({ bounds, padding }); };
    const bounds = fit129().bounds;
    const state = { center: g.state.center, myLocation: null, centerRevision: 0, fitBounds: bounds, fitRevision: 1,
        markers: [{ ...g.state.center, id: 0, isSupported: true, color: '#6a5ae0' }, { ...g.state.center, id: 1, isSupported: false }],
        lines: [line129(0, '#f07a1f'), { ...line129(1, '#8c93a3'), dashed: true }] };
    assert.equal(validMapState(state), true);
    for (const change of [{ lines: [line129(0, 'red')] }, { markers: [{ ...g.state.center, id: 0, isSupported: true, color: '#fff' }] },
        { lines: [line129(0, '#00a84d', [{ latitude: 37.5, longitude: 999 }, g.state.center])] }, { fitBounds: { ...bounds, minLat: 40 } }, { fitRevision: 0.5 }]) {
        assert.equal(validMapState({ ...state, ...change }), false);
    }
    const controller = createWebMap(g.container, g.sdk, state, { onRegionChange() {}, onReady() {}, onError() { assert.fail(); } });
    assert.deepEqual(polylines.map(p => [p.options.strokeColor, p.options.strokeStyle, p.options.path.length]), [['#f07a1f', 'solid', 2], ['#8c93a3', 'shortdash', 2]]);
    assert.deepEqual(g.overlays.map(o => /background-color:([^;]+)/.exec(o.options.content.style.cssText)[1]), ['#6a5ae0', '#8c93a3']);
    assert.equal(fits.length, 1); assert.equal(fits[0].bounds.sw.getLat(), bounds.minLat); assert.equal(fits[0].bounds.ne.getLng(), bounds.maxLng);
    controller.update({ ...state, lines: [line129(5, '#e5484d')] });
    assert.ok(polylines.slice(0, 2).every(p => p.detached)); assert.equal(polylines.length, 3); assert.ok(g.overlays.slice(0, 2).every(o => o.detached));
    assert.equal(fits.length, 1);
    controller.update({ ...state, lines: [line129(5, 'bad')] }); assert.equal(polylines.length, 3); assert.equal(polylines[2].detached, undefined);
    controller.update({ ...state, fitRevision: 2 }); assert.equal(fits.length, 2);
    controller.update({ ...state, fitRevision: 2 }); assert.equal(fits.length, 2);
    controller.dispose(); assert.ok(polylines.every(p => p.detached));
});

/** 경로 안내 화면. mock=true 면 mock 모드예요. */
function guide129({ mock = false, route = route129() } = {}) {
    const r = createScreenRuntime(mock ? {} : serverEnv, 'src/app/route-guide.tsx', runtime => {
        let focus; let blur;
        runtime.external['expo-router'].useFocusEffect = callback => { if (focus !== callback) { blur?.(); focus = callback; blur = callback(); } };
        runtime.blur = () => { blur?.(); blur = undefined; };
        runtime.focus = () => { blur = focus(); };
        runtime.native.ScrollView = 'ScrollView';
    });
    r.load('src/stores/route-store.ts').setSelectedRoute({ route, routeSource: 'KAKAO', origin: { id: 1, name: '출발역', lines: [2], isSupported: true }, destination: { id: 9, name: '도착역', lines: [7], isSupported: true } });
    r.auth = r.load('src/stores/auth-store.ts');
    if (!mock) r.auth.signIn({ userId: 'user-129', nickname: '나' });
    r.external['expo-router'].useLocalSearchParams = () => ({ routeId: route.routeId });
    r.KakaoMap = r.load('src/components/KakaoMap.tsx').default;
    r.Preview = r.load('src/components/route/RouteMapPreview.tsx').default;
    r.Legend = r.load('src/components/route/RouteMapLegend.tsx').default;
    r.Timeline = r.load('src/components/route/RouteTimeline.tsx').default;
    r.map = view => findElement(view, e => e.type === r.KakaoMap);
    r.legend = view => findElement(view, e => e.type === r.Legend);
    return r;
}
const legendTexts129 = element => findAll125(deep125(element), e => e.type === 'Text').map(textOf);

test('129 서버 모드 경로 화면: KakaoMap(경로선·마커·범위)과 범례(혼잡도·도보·노선·마커), 경로 정보 그대로', () => {
    const r = guide129(); const view = r.render();
    const map = r.map(view);
    assert.ok(map); assert.equal(findElement(view, e => e.type === r.Preview), null);
    const expected = plain(r.load('src/utils/route-map.ts').buildRouteMap(route129()));
    assert.deepEqual(plain(map.props.lines), expected.lines); assert.deepEqual(plain(map.props.markers), expected.markers);
    assert.deepEqual(plain(map.props.fitBounds), expected.bounds); assert.equal(map.props.fitRevision, 1);
    assert.equal(map.props.myLocation, null); assert.equal(map.props.label, '경로 지도'); assert.equal(map.key, `${r.load('src/services/auth.ts').getSessionGeneration()}:user-129:route-129`);
    const wrapper = findElement(view, e => e.props?.children === map || (Array.isArray(e.props?.children) && e.props.children.includes(map)));
    assert.equal(wrapper.props.style.height, 220);
    const texts = legendTexts129(r.legend(view));
    for (const text of ['혼잡도', '쾌적', '여유', '보통', '혼잡', '매우 혼잡', '추정', '도보', '출발', '환승', '도착', '노선', '2호선', '4호선', '7호선', '혼잡도 정보가 없는 구간은 노선 색으로 그려요.']) assert.ok(texts.includes(text), text);
    assert.equal(texts.includes('임시'), false);
    // 노선은 타는 순서대로, 노선 색과 이름이 같이 보여요(LineBadge 재사용).
    const legend = deep125(r.legend(view));
    assert.ok(texts.indexOf('2호선') < texts.indexOf('4호선') && texts.indexOf('4호선') < texts.indexOf('7호선'));
    assert.equal(texts.filter(t => t === '4호선').length, 1);
    const badges = findAll125(legend, e => e.props?.style?.[1]?.backgroundColor && e.props.style[0]?.alignItems === 'center').map(e => e.props.style[1].backgroundColor);
    assert.deepEqual(badges, ['#00a84d', '#00a5de']);
    const rows = findAll125(legend, e => e.type === 'View' && e.props.style?.flexWrap === 'wrap'); assert.ok(rows.length >= 3);
    // 경로 정보 카드와 목록은 그대로예요.
    assert.ok(findElement(view, e => e.type === r.Timeline));
    assert.ok(findElement(view, e => e.type === 'Text' && textOf(e).includes('출발역 → 도착역')));
});

test('129 지도 실패: 경로 정보는 그대로, 범례만 숨기고 다시 불러오면 다시 보여요. 화면을 떠난 뒤·계정 전환 뒤 메시지는 무시', () => {
    const r = guide129(); let view = r.render();
    r.map(view).props.onError(); view = r.render();
    assert.equal(r.legend(view), null); assert.ok(r.map(view)); assert.ok(findElement(view, e => e.type === r.Timeline));
    assert.ok(findElement(view, e => e.type === 'Text' && textOf(e).includes('출발역 → 도착역')));
    r.map(view).props.onRegionChange({ minLng: 126.9, minLat: 37.4, maxLng: 127.2, maxLat: 37.7 }); view = r.render();
    assert.ok(r.legend(view));
    // 화면을 떠난 뒤에는 처리하지 않아요.
    const onError = r.map(view).props.onError; r.blur(); onError(); view = r.render(); assert.ok(r.legend(view));
    r.focus(); view = r.render();
    // 계정이 바뀐 뒤 이전 지도에서 온 메시지는 처리하지 않고, 새 계정은 지도를 새로 만들어요.
    const before = r.map(view); const oldKey = before.key;
    r.auth.signIn({ userId: 'user-other', nickname: '다른 사람' }); before.props.onError(); view = r.render();
    assert.ok(r.legend(view)); assert.notEqual(r.map(view).key, oldKey);
});

test('129 그릴 것이 없는 서버 경로는 기본 중심 지도만(안내 문구 없음), mock 모드는 RouteMapPreview 그대로', () => {
    const route = route129(); route.steps.forEach(step => { step.path = null; });
    const r = guide129({ route }); const view = r.render(); const map = r.map(view);
    const { DEFAULT_MAP_CENTER } = r.load('src/utils/home-map.ts');
    assert.deepEqual(plain(map.props.center), plain(DEFAULT_MAP_CENTER)); assert.deepEqual(plain(map.props.lines), []);
    assert.deepEqual(plain(map.props.markers), []); assert.equal(map.props.fitBounds, null);
    const m = guide129({ mock: true }); const mockView = m.render();
    assert.equal(m.map(mockView), null); assert.equal(m.legend(mockView), null);
    const preview = findElement(mockView, e => e.type === m.Preview);
    assert.ok(preview); assert.equal(preview.props.route.routeId, 'route-129'); assert.deepEqual(Object.keys(preview.props), ['route']);
});

/** 함수 컴포넌트를 펼치지 않은 화면 트리(이름·key·props·자식)예요. */
function shallow129(node) {
    if (node == null || typeof node === 'boolean') return null;
    if (Array.isArray(node)) return node.map(shallow129).flat().filter(value => value !== null);
    if (typeof node !== 'object') return String(node);
    const { children, ...rest } = node.props ?? {};
    const props = {};
    for (const [key, value] of Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))) {
        if (value === undefined) continue;
        props[key] = typeof value === 'function' ? '[fn]' : value && typeof value === 'object' && value.$$typeof ? shallow129(value) : JSON.parse(JSON.stringify(value));
    }
    return { t: typeof node.type === 'function' ? node.type.name : String(node.type), k: node.key, p: props, c: shallow129(children) };
}
/** #129 이전(dev e970115) route-guide.tsx 의 mock 모드 트리 sha256 이에요. */
const MOCK_GUIDE_SHA129 = 'b96b2ecb22153e475a783a02f6e1e08552c118446ec3e8764218114d4239d13e';
test('129 mock 모드 경로 화면 트리는 #129 이전과 같아요', () => {
    const r = guide129({ mock: true });
    const sha = require('node:crypto').createHash('sha256').update(JSON.stringify(shallow129(r.render()))).digest('hex');
    assert.equal(sha, MOCK_GUIDE_SHA129);
});


test('145 receipt 없이 구독 전 변경을 동기화하고 준비된 방의 추가 등록은 재조회하지 않아요', async () => {
    const r = await realtimeRuntime(); let server = '이전 이름'; let cached = server; let reads = 1;
    const sync = () => { cached = server; reads++; };
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onSubscribed: sync, onReconnected: sync });
    const socket = await r.connect(false);
    server = '바뀐 이름';
    assert.equal(cached, '이전 이름'); assert.equal(reads, 1);
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onSubscribed: sync, onReconnected: sync });
    assert.equal(socket.commands('SUBSCRIBE').length, 1);
    r.advance(r.rt.SUBSCRIBE_SETTLE_MS);
    assert.equal(cached, server); assert.equal(reads, 3);
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onSubscribed: sync, onReconnected: sync });
    socket.receive('RECEIPT', { 'receipt-id': r.receipt(socket, RT_ROOM) });
    assert.equal(reads, 3); assert.equal(socket.commands('SUBSCRIBE').length, 1);
    socket.close(); const next = await r.reconnect(); assert.equal(reads, 6);
    next.close(); const stale = await r.reconnect(); r.service.dispose();
    stale.receive('RECEIPT', { 'receipt-id': r.receipt(stale, RT_ROOM) });
    assert.equal(reads, 9);
});

test('145 최초 구독 확인 후 방 상세·후보·추천 요청을 합쳐요', async () => {
    const r = roomQueryScreen('src/hooks/use-room-events.ts'); let ready; const calls = [];
    r.load('src/services/realtime.ts').subscribeRoomEvents = (_id, _listener, options) => {
        ready = options.onSubscribed; return () => {};
    };
    const callbacks = { refresh: target => calls.push(target), rejected() {} };
    r.renderComponent({ type: () => r.screen.useRoomEvents(ROOM_QUERY_ID, callbacks), props: {} });
    r.advance(300); await settle(); assert.equal(calls.length, 0);
    ready(); ready(); r.advance(300); await settle();
    assert.deepEqual(calls, ['detail', 'proposals', 'recommendation']);
    r.unmount(); ready(); r.advance(300); await settle(); assert.equal(calls.length, 3);
});

test('145 최초 REST 이후 구독 확인 전에 생긴 채팅을 최신 조회로 복구해요', async () => {
    const r = chat118Hook('open'); let items = []; let reads = 0;
    r.context.fetch = async () => { reads++; return ok({ items, hasMore: false, nextCursor: null }); };
    r.render(); await settle(); assert.equal(reads, 1);
    const message = chat118Message(); items = [message];
    r.prepared(); await settle();
    assert.equal(reads, 2); assert.equal(r.render().messages[0].id, message.id);
    r.render(); await settle(); assert.equal(reads, 2);
    r.unmount(); r.prepared(); await settle(); assert.equal(reads, 2);
});

test('145 최초 채팅 조회가 늦어도 구독 동기화와 조회 중 이벤트를 보존해요', async () => {
    const r = chat118Hook('open'); const initial = deferred(); const sync = deferred(); let reads = 0;
    r.context.fetch = () => ++reads === 1 ? initial.promise : sync.promise;
    r.render(); await settle(); assert.equal(reads, 1);
    r.prepared(); await settle(); assert.equal(reads, 2);
    const missed = chat118Message();
    const live = chat118Message({ id: '01900000-0000-7000-8000-000000000002', content: '구독 후 메시지' });
    r.event(live);
    sync.resolve(ok({ items: [missed], hasMore: false, nextCursor: null })); await settle();
    initial.resolve(ok({ items: [], hasMore: false, nextCursor: null })); await settle();
    assert.deepEqual(plain(r.render().messages.map(message => message.id)).sort(), [missed.id, live.id].sort());
    r.unmount();
});

test('145 최초 조회 뒤 구독 확인 전 방 이름과 멤버 변경을 화면 캐시에 반영해요', async () => {
    const r = roomQueryScreen('src/app/rooms/[roomId].tsx', { roomId: ROOM_QUERY_ID });
    let ready; let detail = roomQueryDetail(); let detailReads = 0; let proposalReads = 0;
    r.load('src/services/realtime.ts').subscribeRoomEvents = (_id, _receive, options) => {
        ready ??= options.onSubscribed; return () => {};
    };
    r.context.fetch = async url => {
        if (url.endsWith('/invite-code')) return ok({ roomCode: 'ABC123' });
        if (url.includes('station-proposals')) {
            proposalReads++; return ok({ items: [], maxProposals: 9, selectedStation: null });
        }
        detailReads++; return ok(detail);
    };
    r.render(); await settle(); await settle(); r.render();
    const cache = r.load('src/services/room-cache.ts');
    const initialDetailReads = detailReads; const initialProposalReads = proposalReads;
    assert.ok(initialDetailReads > 0); assert.ok(initialProposalReads > 0);
    detail = { ...detail, name: '구독 대기 중 바뀐 방', members: detail.members.slice(0, 1) };
    assert.notEqual(cache.readCachedRoomDetail(ROOM_QUERY_ID).name, detail.name);
    ready(); r.advance(300); await settle(); await settle(); r.render();
    assert.equal(cache.readCachedRoomDetail(ROOM_QUERY_ID).name, detail.name);
    assert.equal(cache.readCachedRoomDetail(ROOM_QUERY_ID).members.length, 1);
    assert.equal(detailReads, initialDetailReads + 1); assert.equal(proposalReads, initialProposalReads + 1);
    r.unmount();
});

test('145 receipt 없이 500ms 뒤 최초 동기화와 재연결 재조회를 한 번씩 실행해요', async () => {
    const r = await realtimeRuntime({ settleSubscriptions: false }); let initial = 0; let recovered = 0;
    const callbacks = { onSubscribed: () => initial++, onReconnected: () => recovered++ };
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, callbacks);
    const socket = await r.connect();
    assert.equal(r.rt.SUBSCRIBE_SETTLE_MS, 500);
    r.advance(499); assert.equal(initial, 0);
    r.advance(1); assert.equal(initial, 1); assert.equal(recovered, 0);
    r.advance(500); assert.equal(initial, 1);
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, callbacks);
    assert.equal(socket.commands('SUBSCRIBE').length, 1);
    r.advance(500); assert.equal(initial, 1); assert.equal(recovered, 0);
    socket.close(); await r.reconnect();
    r.advance(499); assert.equal(recovered, 0);
    r.advance(1); assert.equal(initial, 1); assert.equal(recovered, 2);
    r.advance(500); assert.equal(recovered, 2);
    r.service.dispose(); assert.equal(r.timers.size, 0);
});

test('145 receipt가 먼저 오면 즉시 준비되고 타이머나 늦은 receipt는 중복 호출하지 않아요', async () => {
    for (const receiptFirst of [true, false]) {
        const r = await realtimeRuntime({ settleSubscriptions: false }); let calls = 0;
        r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onSubscribed: () => calls++ });
        const socket = await r.connect();
        r.advance(receiptFirst ? 100 : 500);
        assert.equal(calls, receiptFirst ? 0 : 1);
        socket.receive('RECEIPT', { 'receipt-id': r.receipt(socket, RT_ROOM) });
        assert.equal(calls, 1);
        assert.equal([...r.timers.values()].filter(timer => timer.ms === 500).length, 0);
        r.advance(1000); assert.equal(calls, 1);
        r.service.dispose();
    }
});

test('145 화면 이탈·방 제거·로그아웃·연결 종료·dispose 뒤 준비 콜백과 타이머를 정리해요', async () => {
    for (const action of ['unmount', 'forget', 'logout', 'stop', 'dispose']) {
        const r = await realtimeRuntime({ settleSubscriptions: false }); let calls = 0;
        const off = r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onSubscribed: () => calls++, onReconnected: () => calls++ });
        const socket = await r.connect();
        r.advance(100);
        if (action === 'unmount') off();
        if (action === 'forget') r.service.forgetRoom(RT_ROOM);
        if (action === 'logout') await r.auth.clearLocalSession();
        if (action === 'stop') socket.close();
        if (action === 'dispose') r.service.dispose();
        assert.equal([...r.timers.values()].filter(timer => timer.ms === 500).length, 0, action);
        socket.receive('RECEIPT', { 'receipt-id': r.receipt(socket, RT_ROOM) });
        r.advance(500); assert.equal(calls, 0, action);
        r.service.dispose(); assert.equal(r.timers.size, 0);
    }
});

test('145 대기 중 제거된 리스너는 무시하고 남은 화면만 동기화해요', async () => {
    const r = await realtimeRuntime({ settleSubscriptions: false }); let removed = 0; let active = 0;
    const off = r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onSubscribed: () => removed++ });
    const socket = await r.connect();
    r.service.subscribeRoomEvents(RT_ROOM, () => {}, { onSubscribed: () => active++ });
    off(); r.advance(500);
    assert.equal(removed, 0); assert.equal(active, 1); assert.equal(socket.commands('SUBSCRIBE').length, 1);
    r.service.dispose();
});

/* ---------- INTERNAL 경로 안내 문구 (#147) ---------- */
async function route147Search(data, roomId) {
    const r = routeScreenRuntime({ departure: '강남', destination: '사당', ...(roomId ? { roomId } : {}) });
    r.route147Data = data;
    r.context.fetch = async url => jsonResponse({ success: true, data: url.endsWith('/routes/search') ? r.route147Data
            : stationSearchData([url.includes(encodeURIComponent('강남')) ? serverRouteStation(88001, '강남') : serverRouteStation(99002, '사당')]) });
    for (let i = 0; i < 5; i++) { r.render(); await settle(); }
    r.view147 = () => r.render();
    r.card147 = () => findElement(r.view147(), element => element.type === r.load('src/components/route/RouteCard.tsx').default);
    return r;
}

function route147Guide(selected) {
    const r = guide129({ route: selected.route });
    r.load('src/stores/route-store.ts').setSelectedRoute(selected);
    return r;
}

test('147 KAKAO·정상 약속방 INTERNAL·대체 INTERNAL은 계산 원인을 단정하지 않고 검색·안내 문구가 같아요', async () => {
    // 정상 시각표/장애 대체를 나타내는 서버 필드는 없어요. 같은 INTERNAL 계약을 각각의 사용 맥락에서 확인해요.
    const cases = [
        { label: '개인 KAKAO', source: 'KAKAO' },
        { label: '약속방 KAKAO', source: 'KAKAO', roomId: 'room-147' },
        { label: '정상 약속방 INTERNAL', source: 'INTERNAL', roomId: 'room-147' },
        { label: '개인 대체 INTERNAL', source: 'INTERNAL' },
        { label: '약속방 대체 INTERNAL', source: 'INTERNAL', roomId: 'room-147' },
    ];
    for (const scenario of cases) for (const fareSource of ['KAKAO', 'ESTIMATED']) {
        const data = routeData(); data.routeSource = scenario.source; data.routes[0].summary.fareSource = fareSource;
        const search = await route147Search(data, scenario.roomId); const view = search.view147(); const card = search.card147();
        assert.ok(card, scenario.label); card.props.onStart();
        const selected = search.load('src/stores/route-store.ts').getSelectedRoute();
        const guide = route147Guide(selected); const guided = guide.render();
        for (const screen of [view, guided]) {
            assert.equal(!!findText(screen, '자체 계산한 경로예요.'), scenario.source === 'INTERNAL', scenario.label);
            assert.doesNotMatch(textOf(screen), /실시간 경로를 불러오지 못해|예상 경로를 보여|요금은 예상 금액이에요|시각표로 계산|카카오.*실패/, scenario.label);
        }
        const Card = search.load('src/components/route/RouteCard.tsx').default;
        assert.equal(!!findText(Card({ ...card.props, expanded: true }), '예상'), fareSource === 'ESTIMATED');
        assert.equal(!!findTextIncluding(Card({ ...card.props, expanded: false }), '예상 '), fareSource === 'ESTIMATED');
        assert.equal(!!findText(guided, '예상'), fareSource === 'ESTIMATED');
        assert.equal(selected.routeSource, scenario.source);
        search.unmount(); guide.unmount();
    }
});

test('147 INTERNAL의 중립 문구를 표시해도 기존 지난 약속·첫차·지각 안내는 유지돼요', async () => {
    const data = routeData(); data.routeSource = 'INTERNAL';
    Object.assign(data, { appointmentPassed: true, notice: '약속 시각이 지나 지금 출발 기준으로 안내해요.' });
    Object.assign(data.routes[0].summary, { noService: true, serviceNotice: '첫차 운행 시각부터 안내해요.', arrivesAfterAppointment: true });
    const search = await route147Search(data, 'room-147'); const view = search.view147(); const card = search.card147();
    assert.ok(findText(view, data.notice)); assert.ok(findText(view, '자체 계산한 경로예요.'));
    const Notices = search.load('src/components/route/RouteNotices.tsx').default;
    const Card = search.load('src/components/route/RouteCard.tsx').default;
    for (const expanded of [false, true]) {
        const notices = findElement(Card({ ...card.props, expanded }), element => element.type === Notices);
        assert.ok(notices); const rendered = Notices(notices.props);
        assert.ok(findText(rendered, data.routes[0].summary.serviceNotice)); assert.ok(findText(rendered, '약속 시각보다 늦게 도착해요'));
    }
    card.props.onStart(); const guide = route147Guide(search.load('src/stores/route-store.ts').getSelectedRoute()); const guided = guide.render();
    assert.ok(findText(guided, '자체 계산한 경로예요.'));
    const guideNotices = findElement(guided, element => element.type === guide.load('src/components/route/RouteNotices.tsx').default);
    const rendered = guideNotices.type(guideNotices.props);
    assert.ok(findText(rendered, data.routes[0].summary.serviceNotice)); assert.ok(findText(rendered, '약속 시각보다 늦게 도착해요'));
    // 응답 최상위 appointmentPassed·notice를 안내 화면으로 전달하는 변경은 #148에서 별도로 진행해요.
    search.unmount(); guide.unmount();
});

test('147 INTERNAL 다음 KAKAO를 검색·선택하면 이전 자체 계산 안내가 남지 않아요', async () => {
    const data = routeData(); data.routeSource = 'INTERNAL';
    const search = await route147Search(data, 'room-147'); assert.ok(findText(search.view147(), '자체 계산한 경로예요.'));
    search.card147().props.onStart(); const guide = route147Guide(search.load('src/stores/route-store.ts').getSelectedRoute());
    assert.ok(findText(guide.render(), '자체 계산한 경로예요.'));
    search.route147Data = routeData(); search.route147Data.routes[0].routeId = 'server-route-147-next';
    findElement(search.view147(), element => element.props?.accessibilityLabel === '출발역과 도착역 바꾸기').props.onPress();
    for (let i = 0; i < 5; i++) { search.render(); await settle(); }
    assert.equal(findText(search.view147(), '자체 계산한 경로예요.'), null);
    search.card147().props.onStart(); const selected = search.load('src/stores/route-store.ts').getSelectedRoute();
    guide.load('src/stores/route-store.ts').setSelectedRoute(selected);
    guide.external['expo-router'].useLocalSearchParams = () => ({ routeId: selected.route.routeId });
    assert.equal(findText(guide.render(), '자체 계산한 경로예요.'), null);
    search.unmount(); guide.unmount();
});

/* ---------- #146 환승 단계를 도보가 아니라 환승 소요로 표시 ---------- */

/** 도보(90초) → 2호선 → 환승(660초: 도보 1분 + 대기 10분) → 3호선 → 환승(20초) → 7호선 → 도보(200초) */
function route146({ walkingMinutes = 1, transferCount = 2 } = {}) {
    const subway = (id, name, stops) => ({ type: 'SUBWAY', guidance: `${name} 탑승`, durationSec: 600, distanceM: 5000,
        line: { id, name, color: '#00a84d' }, direction: null, directionCode: 'UP',
        stops: stops.map((stopName, order) => ({ id: id * 100 + order, name: stopName, order })), path: null, stations: [] });
    const walk = (guidance, durationSec) => ({ type: 'WALKING', guidance, durationSec, distanceM: 80, line: null, direction: null, directionCode: null, stops: [], path: null, stations: [] });
    return {
        routeId: 'route-146', routeType: null,
        summary: { noService: false, serviceNotice: null, arrivesAfterAppointment: false, totalTimeSec: 2770, arrivalAt: '2026-11-14T09:00:00+09:00',
            fare: 1500, fareSource: 'KAKAO', transferCount, walkingMinutes, congestion: { supported: false, kind: null, pct: null, level: null, levelLabel: null } },
        steps: [
            walk('출발역까지 걷기', 90),
            subway(2, '2호선', ['강남', '교대']),
            walk('서버 환승 안내', 660),
            subway(3, '3호선', ['교대', '고속터미널']),
            walk('고속터미널역 7호선 승강장으로 환승', 20),
            subway(7, '7호선', ['고속터미널', '이수']),
            walk('도착지까지 걷기', 200),
        ],
    };
}
/** 도보 줄은 끝에 " · 80m"(거리)가 붙어서 앞부분으로 비교해요. */
function texts146(node) {
    return findAll125(node, element => element.type === 'Text').map(textOf);
}
function timeline146(route) {
    const r = createRuntime(serverEnv, { ...require('react'), useState: initial => [initial, () => {}] });
    const Timeline = r.load('src/components/route/RouteTimeline.tsx').default;
    return texts146(Timeline({ route, onSignCheck() {} }));
}
function card146(route, expanded) {
    const r = createRuntime(serverEnv);
    return texts146(r.load('src/components/route/RouteCard.tsx').default({ route, expanded, onPress() {}, onStart() {} }));
}

test('146 환승 판별과 분 계산: 두 SUBWAY 사이 WALKING 만 환승, 최소 1분, 안내 끝 "환승"은 "이동"으로', () => {
    const format = createRuntime().load('src/components/route/format.ts');
    const steps = route146().steps;
    assert.deepEqual(steps.map((_, index) => format.isTransferStep(steps, index)), [false, false, true, false, true, false, false]);
    assert.equal(format.isTransferStep(steps, 99), false);
    for (const [sec, minutes] of [[660, 11], [20, 1], [29, 1], [0, 1], [89, 1], [90, 2], [NaN, 1]]) assert.equal(format.stepMinutes(sec), minutes, String(sec));
    assert.equal(format.formatTransferDuration(steps[2]), '환승 소요 11분');
    assert.deepEqual(steps.map((step, index) => step.type === 'WALKING' ? format.formatWalkingStep(steps, index) : null).filter(Boolean), [
        '출발역까지 걷기 · 도보 2분', '서버 환승 안내 · 환승 소요 11분', '고속터미널역 7호선 승강장으로 이동 · 환승 소요 1분', '도착지까지 걷기 · 도보 3분']);
    // 안내 중간의 "환승"과 단독 "환승"
    const only = [...steps]; only[2] = { ...steps[2], guidance: '환승' };
    assert.equal(format.formatWalkingStep(only, 2), '이동 · 환승 소요 11분');
    only[2] = { ...steps[2], guidance: '환승통로로 이동' };
    assert.equal(format.formatWalkingStep(only, 2), '환승통로로 이동 · 환승 소요 11분');
    // 지하철 하나 앞뒤의 도보는 환승이 아니에요.
    const single = [steps[0], steps[1], steps[6]];
    assert.deepEqual(single.map((_, index) => format.isTransferStep(single, index)), [false, false, false]);
});

test('146 도보 1분 + 대기 10분 환승: 어디에도 "도보 11분" 없이 "환승 소요 11분", 요약은 서버 값 "도보 1분"', async () => {
    const route = route146();
    const detail = timeline146(route); const expanded = card146(route, true); const collapsed = card146(route, false);
    for (const texts of [detail, expanded, collapsed]) assert.ok(!texts.some(text => /도보 11분|환승 도보/.test(text)), texts.join(' / '));
    assert.ok(detail.some(text => text.startsWith('서버 환승 안내 · 환승 소요 11분')));
    assert.ok(expanded.some(text => text.trim() === '환승 소요 11분'));
    assert.ok(expanded.some(text => text.includes('환승 2회 · 도보 1분')));
    // 경로 안내 화면 요약도 서버 값 그대로예요.
    const r = guide129({ route }); const view = r.render();
    assert.ok(findElement(view, element => element.type === 'Text' && textOf(element).includes('환승 2회 · 도보 1분')));
    assert.ok(!textOf(view).includes('도보 11분'));
    assert.ok(findElement(view, element => element.type === r.Timeline && element.props.route === route));
});

test('146 환승 여러 번: 펼친 카드와 경로 상세가 환승마다 같은 숫자, 첫·마지막 도보는 "도보", 요약과 모순 없음', () => {
    for (const walkingMinutes of [1, 5]) {
        const route = route146({ walkingMinutes });
        const format = createRuntime().load('src/components/route/format.ts');
        const detail = timeline146(route); const expanded = card146(route, true);
        const detailTransfers = detail.filter(text => text.includes('환승 소요')).map(text => /환승 소요 (\d+)분/.exec(text)[1]);
        const cardTransfers = expanded.filter(text => text.includes('환승 소요')).map(text => /환승 소요 (\d+)분/.exec(text)[1]);
        assert.deepEqual(detailTransfers, ['11', '1']); assert.deepEqual(cardTransfers, detailTransfers);
        assert.deepEqual(cardTransfers, route.steps.filter((_, index) => format.isTransferStep(route.steps, index)).map(step => String(format.stepMinutes(step.durationSec))));
        // 첫 지하철 전 도보는 "도보"(이전에는 펼친 카드가 "환승 도보"로 잘못 표시했어요), 마지막 도보도 "도보"
        assert.ok(expanded.some(text => text.trim() === '도보 2분'));
        assert.ok(detail.some(text => text.startsWith('출발역까지 걷기 · 도보 2분'))); assert.ok(detail.some(text => text.startsWith('도착지까지 걷기 · 도보 3분')));
        // 요약 도보는 서버 값 그대로, 환승 횟수는 환승 단계 수와 같아요.
        assert.ok(expanded.some(text => text.includes(`환승 2회 · 도보 ${walkingMinutes}분`)));
        assert.equal(cardTransfers.length, route.summary.transferCount);
        assert.ok(!expanded.some(text => text.includes('환승 도보')) && !detail.some(text => text.includes('환승 도보')));
        // 접힌 카드는 단계 시간을 보여주지 않고 환승 횟수만 보여줘요.
        const collapsed = card146(route, false);
        assert.ok(collapsed.some(text => text.includes('환승 2회'))); assert.ok(!collapsed.some(text => /환승 소요|도보 \d+분/.test(text)));
    }
});

test('146 카카오(KAKAO)·시각표(INTERNAL) 경로는 같은 문구, 30초 미만 환승도 1분', () => {
    const results = [];
    for (const routeSource of ['KAKAO', 'INTERNAL']) {
        const route = route146();
        const r = guide129({ route });
        r.load('src/stores/route-store.ts').setSelectedRoute({ ...r.load('src/stores/route-store.ts').getSelectedRoute(), routeSource });
        const view = r.render();
        assert.equal(r.load('src/stores/route-store.ts').getSelectedRoute().routeSource, routeSource);
        const timeline = findElement(view, element => element.type === r.Timeline);
        results.push(JSON.stringify([timeline146(timeline.props.route), card146(route, true)]));
        assert.ok(timeline146(route).some(text => text.startsWith('고속터미널역 7호선 승강장으로 이동 · 환승 소요 1분')));
        assert.ok(!timeline146(route).some(text => /환승 소요 0분|도보 0분/.test(text)));
    }
    assert.equal(results[0], results[1]);
});

/* #146 보완: 다음 열차 대기가 따로 표시되면 환승 단계는 걷는 시간만이라 "환승 도보", 아니면 "환승 소요" */

/** route146 의 지하철 단계에 대기를 넣어요. waits[i] 는 i번째 지하철 단계의 waitSec(undefined 면 넣지 않음). */
function route146Waits(waits, ...kind) {
    const waitKind = kind.length ? kind[0] : 'ESTIMATED'; // undefined 를 넘기면 waitKind 없음
    const route = route146(); let subway = 0;
    route.steps = route.steps.map(step => {
        if (step.type !== 'SUBWAY') return step;
        const waitSec = waits[subway++];
        return waitSec === undefined ? step : { ...step, waitSec, waitKind };
    });
    return route;
}

test('146 보완: mock 건대입구 → 사당은 "환승 도보 3분"과 "환승 대기 약 2분", "환승 소요" 없음', async () => {
    const r = createRuntime();
    const { MOCK_STATIONS } = r.load('src/mocks/routes.ts');
    const station = name => MOCK_STATIONS.find(item => item.name === name);
    const pending = r.load('src/services/route.ts').searchRoute(station('건대입구'), station('사당'));
    r.advance(5000); const result = await pending;
    const route = result.routes.find(item => item.routeId === 'r1');
    const format = r.load('src/components/route/format.ts');
    const transfers = route.steps.map((_, index) => index).filter(index => format.isTransferStep(route.steps, index));
    assert.ok(transfers.length >= 1);
    for (const index of transfers) assert.equal(format.hasSeparateTransferWait(route.steps, index), true);
    const expanded = card146(route, true); const detail = timeline146(route);
    assert.ok(expanded.some(text => text.trim() === '환승 도보 3분'), expanded.join(' / '));
    assert.ok(expanded.some(text => text === '환승 대기 약 2분'));
    assert.ok(detail.some(text => text.startsWith('이수역 4호선 승강장으로 환승 · 도보 3분')), detail.join(' / '));
    assert.ok(detail.some(text => text === '환승 대기 약 2분'));
    for (const texts of [expanded, detail]) assert.ok(!texts.some(text => text.includes('환승 소요')));
});

test('146 보완: 대기가 따로 오지 않는 660초 환승은 "환승 소요 11분", 섞인 경로는 환승마다 맞게', () => {
    // 첫 환승(660초) 뒤 열차는 대기 없음, 둘째 환승(20초) 뒤 열차는 대기 120초
    const mixed = route146Waits([180, undefined, 120]);
    const format = createRuntime().load('src/components/route/format.ts');
    assert.deepEqual([2, 4].map(index => format.hasSeparateTransferWait(mixed.steps, index)), [false, true]);
    const expanded = card146(mixed, true); const detail = timeline146(mixed);
    assert.ok(expanded.some(text => text.trim() === '환승 소요 11분')); assert.ok(expanded.some(text => text.trim() === '환승 도보 1분'));
    assert.ok(expanded.some(text => text === '환승 대기 약 2분')); assert.ok(expanded.some(text => text === '승차 대기 약 3분'));
    assert.ok(detail.some(text => text.startsWith('서버 환승 안내 · 환승 소요 11분')));
    assert.ok(detail.some(text => text.startsWith('고속터미널역 7호선 승강장으로 환승 · 도보 1분')));
    assert.ok(expanded.some(text => text.trim() === '도보 2분')); // 첫 열차 전 걷기는 그대로 "도보"
    for (const texts of [expanded, detail, card146(mixed, false)]) assert.ok(!texts.some(text => text.includes('도보 11분')), texts.join(' / '));
    assert.ok(expanded.some(text => text.includes('환승 2회 · 도보 1분')));
    // 펼친 카드와 경로 상세의 숫자가 환승마다 같아요.
    const numbers = texts => texts.map(text => /환승 (?:소요|도보) (\d+)분|· (?:환승 소요|도보) (\d+)분/.exec(text)).filter(Boolean).map(match => match[1] ?? match[2]);
    assert.deepEqual(numbers(expanded.filter(text => /^\s*환승 (소요|도보)/.test(text))), ['11', '1']);
    assert.deepEqual(numbers(detail.filter(text => /^(서버 환승 안내|고속터미널역)/.test(text))), ['11', '1']);
});

test('146 보완: waitSec 이 0·null 이거나 waitKind 가 없거나 NONE 이면 따로 표시되지 않는 경우(환승 소요)', () => {
    const format = createRuntime().load('src/components/route/format.ts');
    for (const [wait, kind] of [[0, 'ESTIMATED'], [null, 'ESTIMATED'], [-5, 'REALTIME'], [120, 'NONE'], [120, undefined]]) {
        const route = route146Waits([undefined, wait, wait], kind);
        assert.equal(format.formatWait(route.steps[3], true), '', `${wait} ${kind}`);
        assert.deepEqual([2, 4].map(index => format.hasSeparateTransferWait(route.steps, index)), [false, false], `${wait} ${kind}`);
        const expanded = card146(route, true); const detail = timeline146(route);
        assert.ok(expanded.some(text => text.trim() === '환승 소요 11분')); assert.ok(!expanded.some(text => text.includes('환승 대기')));
        assert.ok(detail.some(text => text.startsWith('고속터미널역 7호선 승강장으로 이동 · 환승 소요 1분')));
    }
    // 대기 줄과 환승 문구 판단은 같은 함수를 써서 어긋나지 않아요.
    const shown = route146Waits([undefined, 60, 60], 'REALTIME');
    assert.equal(format.formatWait(shown.steps[3], true), '환승 대기 1분'); assert.equal(format.hasSeparateTransferWait(shown.steps, 2), true);
    assert.ok(card146(shown, true).some(text => text.trim() === '환승 도보 11분'));
});

/* ---------- 지난 약속 안내의 경로 안내 전달 (#148) ---------- */
test('148 검색 응답의 지난 약속 여부·안내를 선택 경로에 그대로 저장하고 안내에서도 같은 조건으로 표시해요', async () => {
    const message = '약속 시각이 이미 지나 지금 출발 기준으로 안내해요.';
    for (const routeSource of ['KAKAO', 'INTERNAL']) for (const [appointmentPassed, notice] of [
        [true, message], [false, message], [true, null], [false, null], [true, ''],
    ]) {
        const data = { ...routeData(), routeSource, appointmentPassed, notice };
        const search = await route147Search(data, 'room-148'); const card = search.card147(); assert.ok(card);
        card.props.onStart(); const selected = search.load('src/stores/route-store.ts').getSelectedRoute();
        assert.equal(selected.appointmentPassed, appointmentPassed);
        assert.equal(selected.notice, notice, '서버 문구를 새로 만들거나 변경하지 않아요');
        assert.equal(selected.route, card.props.route);
        const guide = route147Guide(selected); const view = guide.render();
        assert.equal(!!findText(view, message), appointmentPassed && notice === message);
        assert.equal(!!findText(view, '자체 계산한 경로예요.'), routeSource === 'INTERNAL');
        search.unmount(); guide.unmount();
    }
});

test('148 다음 방·일반 경로의 새 응답을 선택하면 같은 routeId여도 이전 지난 약속 안내가 남지 않아요', async () => {
    const message = '지난 방의 지금 출발 안내예요.';
    for (const nextRoom of ['future-room-148', undefined]) for (const sameRouteId of [true, false]) {
        const past = { ...routeData(), appointmentPassed: true, notice: message };
        const search = await route147Search(past, 'past-room-148'); search.card147().props.onStart();
        const guide = route147Guide(search.load('src/stores/route-store.ts').getSelectedRoute());
        assert.ok(findText(guide.render(), message));
        search.route147Data = { ...routeData(), appointmentPassed: false, notice: null };
        if (!sameRouteId) search.route147Data.routes[0].routeId = 'route-148-next';
        search.external['expo-router'].useLocalSearchParams = () => ({ departure: '강남', destination: '사당', ...(nextRoom ? { roomId: nextRoom } : {}) });
        for (let i = 0; i < 5; i++) { search.render(); await settle(); }
        search.card147().props.onStart(); const selected = search.load('src/stores/route-store.ts').getSelectedRoute();
        assert.equal(selected.appointmentPassed, false); assert.equal(selected.notice, null);
        guide.load('src/stores/route-store.ts').setSelectedRoute(selected);
        guide.external['expo-router'].useLocalSearchParams = () => ({ routeId: selected.route.routeId });
        assert.equal(findText(guide.render(), message), null);
        search.unmount(); guide.unmount();
    }
});

test('148 지난 약속·첫차·지각·자체 계산 안내가 함께 있어도 경로 안내에서 모두 유지돼요', async () => {
    const data = { ...routeData(), routeSource: 'INTERNAL', appointmentPassed: true, notice: '약속 시각이 지나 지금 출발 기준으로 안내해요.' };
    Object.assign(data.routes[0].summary, { noService: true, serviceNotice: '첫차부터 이용할 수 있는 경로예요.', arrivesAfterAppointment: true });
    const search = await route147Search(data, 'room-148'); search.card147().props.onStart();
    const selected = search.load('src/stores/route-store.ts').getSelectedRoute(); const guide = route147Guide(selected); const view = guide.render();
    assert.ok(findText(view, data.notice)); assert.ok(findText(view, '자체 계산한 경로예요.'));
    const notices = findElement(view, element => element.type === guide.load('src/components/route/RouteNotices.tsx').default);
    assert.ok(notices); const rendered = notices.type(notices.props);
    assert.ok(findText(rendered, data.routes[0].summary.serviceNotice)); assert.ok(findText(rendered, '약속 시각보다 늦게 도착해요'));
    assert.equal(selected.route.summary.noService, true); assert.equal(selected.route.summary.arrivesAfterAppointment, true);
    search.unmount(); guide.unmount();
});

test('148 같은 응답의 다른 경로를 고르면 새 경로와 응답 최상위 지난 약속 안내가 함께 전달돼요', async () => {
    const data = { ...routeData(), appointmentPassed: true, notice: '이 검색은 지금 출발 기준이에요.' };
    data.routes.push({ ...data.routes[0], routeId: 'route-148-alternative', summary: { ...data.routes[0].summary, totalTimeSec: 1200 } });
    const search = await route147Search(data, 'room-148');
    const Card = search.load('src/components/route/RouteCard.tsx').default;
    const first = findElement(search.view147(), element => element.type === Card && element.props.route.routeId === 'server-route-1');
    first.props.onStart();
    const second = findElement(search.view147(), element => element.type === Card && element.props.route.routeId === 'route-148-alternative');
    second.props.onStart(); const selected = search.load('src/stores/route-store.ts').getSelectedRoute();
    assert.equal(selected.route.routeId, 'route-148-alternative'); assert.equal(selected.notice, data.notice); assert.equal(selected.appointmentPassed, true);
    const guide = route147Guide(selected); assert.ok(findText(guide.render(), data.notice));
    guide.external['expo-router'].useLocalSearchParams = () => ({ routeId: 'unrelated-route-148' });
    const empty = guide.render(); assert.ok(findText(empty, '선택한 경로가 없어요')); assert.equal(findText(empty, data.notice), null);
    search.unmount(); guide.unmount();
});

test('148 실제 사용자 서비스의 로그아웃은 지난 약속 안내가 포함된 선택 경로 전체를 지워요', async () => {
    for (const mock of [false, true]) {
        const r = guide129({ mock }); const store = r.load('src/stores/route-store.ts'); let calls = 0;
        r.context.fetch = () => { calls++; throw Error('로그아웃 검사에서 서버를 호출하지 않아요'); };
        const notice = '이전 사용자의 지난 약속 안내예요.';
        store.setSelectedRoute({ ...store.getSelectedRoute(), appointmentPassed: true, notice });
        assert.ok(findText(r.render(), notice));
        const pending = r.load('src/services/user.ts').logout();
        if (mock) await finishRoomMock(r, pending); else await pending;
        assert.equal(store.getSelectedRoute(), null);
        assert.ok(findText(r.render(), '선택한 경로가 없어요')); assert.equal(findText(r.render(), notice), null);
        r.load('src/stores/auth-store.ts').signIn({ userId: 'next-user-148', nickname: '다음 사용자' });
        assert.equal(store.getSelectedRoute(), null); assert.equal(calls, 0); r.unmount();
    }
});

/* ---------- 약속 시각 변경 후 추천 최신 상태 갱신 (#136) ---------- */
async function roomUpdated136(screen = 'src/app/rooms/[roomId]/recommendations.tsx', missing = false) {
    const params = { roomId: ROOM_QUERY_ID };
    const r = roomQueryScreen(screen, params); const calls = []; let listener;
    const events = r.load('src/services/room-events.ts'); const mergeRoomUpdated = events.mergeRoomUpdated;
    events.mergeRoomUpdated = (...args) => { const next = mergeRoomUpdated(...args); r.merged136 = next; return next; };
    const hooks = r.load('src/hooks/use-room-events.ts'); const useRoomEvents = hooks.useRoomEvents;
    hooks.useRoomEvents = (roomId, callbacks) => useRoomEvents(roomId, { ...callbacks, receive: event => {
        const targets = callbacks.receive?.(event); r.targets136 = targets; return targets;
    } });
    r.load('src/services/realtime.ts').subscribeRoomEvents = (_id, receive) => { listener ??= receive; return () => {}; };
    r.latest136 = recoRun({ results: [] });
    r.context.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method ?? 'GET' });
        if (url.includes('/recommendations')) return r.pending136 ? r.pending136() : ok(r.latest136);
        if (missing) return new Promise(() => {});
        return ok(url.endsWith('/invite-code') ? { roomCode: 'ABC123' }
            : url.includes('station-proposals') ? { items: [], maxProposals: 9, selectedStation: null }
                : { ...roomQueryDetail(), id: params.roomId });
    };
    for (let i = 0; i < 5; i++) { r.render(); await settle(); }
    calls.length = 0;
    return Object.assign(r, { calls136: calls, params136: params,
        emit136: (payload = { ...roomQuerySummary(), appointmentAt: '2026-11-15T10:00:00Z' }, type = 'ROOM_UPDATED') =>
            listener({ type, roomId: params.roomId, payload, at: '2026-11-13T10:00:00Z' }) });
}

test('#136 ROOM_UPDATED는 추천만 예약하고 SELECTED_STATION_CHANGED는 그대로예요', () => {
    const { roomEventTargets } = createRuntime().load('src/services/room-events.ts');
    assert.deepEqual(plain(roomEventTargets('ROOM_UPDATED')), ['recommendation']);
    assert.deepEqual(plain(roomEventTargets('SELECTED_STATION_CHANGED')), []);
});

test('#136 연속 ROOM_UPDATED는 8.2 GET 한 번으로 합치고 서버 stale 사유를 표시해요', async () => {
    const r = await roomUpdated136();
    r.latest136 = recoRun({ results: [], isStale: true, staleReasons: ['APPOINTMENT_CHANGED'] });
    r.emit136(); r.advance(100); r.emit136(); r.advance(100); r.emit136();
    r.advance(99); await settle(); assert.equal(r.calls136.length, 0);
    r.advance(1); await settle(); const view = r.render();
    assert.deepEqual(r.calls136.map(call => [call.method, call.url.split('/api/v1')[1]]),
        [['GET', `/rooms/${ROOM_QUERY_ID}/recommendations/latest`]]);
    assert.ok(findText(view, '약속 시각이 바뀌었어요'));
    assert.equal(findText(view, '참여자나 출발역이 바뀌었어요'), null);
    assert.equal(r.merged136.appointmentAt, '2026-11-15T10:00:00Z');
    await settle(); await settle();
    // 약속이 바뀌어도 프론트에서 stale을 계산하지 않아요.
    r.latest136 = recoRun({ results: [], isStale: false, staleReasons: [] });
    r.emit136(); r.advance(300); await settle();
    assert.equal(findText(r.render(), '약속 시각이 바뀌었어요'), null);
    assert.equal(r.calls136.filter(call => call.method === 'POST').length, 0); r.unmount();
});

test('#136 ROOM_UPDATED 병합 실패·상세 미로딩 경로도 상세와 최신 추천을 조회해요', async () => {
    for (const missing of [false, true]) {
        const r = await roomUpdated136('src/app/rooms/[roomId]/recommendations.tsx', missing);
        // receive 반환값과 실제 refresh 경로를 함께 검사해요.
        const calls = [];
        r.context.fetch = async (url, options = {}) => {
            calls.push([url, options.method ?? 'GET']);
            return ok(url.includes('/recommendations') ? recoRun({ results: [] }) : { ...roomQueryDetail(), id: r.params136.roomId });
        };
        r.emit136({}); r.advance(300); await settle();
        assert.equal(calls.filter(([url]) => url.endsWith('/recommendations/latest')).length, 1);
        assert.deepEqual(plain(r.targets136), ['detail', 'recommendation']);
        // 상세 미로딩이면 기존 진행 중인 상세 조회를 공유해요.
        assert.equal(calls.filter(([url]) => url.endsWith(`/rooms/${r.params136.roomId}`)).length, missing ? 0 : 1);
        assert.ok(calls.every(([, method]) => method === 'GET')); r.unmount();
    }
});

test('#136 로그아웃·계정 변경·방 이동 뒤 늦은 ROOM_UPDATED 추천 응답을 무시해요', async () => {
    for (const change of ['logout', 'account', 'room']) {
        const r = await roomUpdated136(); let finish;
        r.pending136 = () => new Promise(resolve => { finish = resolve; });
        r.emit136(); r.advance(300); await settle(); assert.ok(finish);
        if (change === 'logout') r.load('src/stores/auth-store.ts').signOut();
        else if (change === 'account') r.load('src/stores/auth-store.ts').signIn({ userId: ROOM_QUERY_OTHER, nickname: '다음 계정' });
        else r.params136.roomId = ROOM_QUERY_ID2;
        r.pending136 = null; r.render(); await settle(); await settle(); r.render();
        finish(ok(recoRun({ results: [], isStale: true, staleReasons: ['APPOINTMENT_CHANGED'] })));
        await settle(); assert.equal(findText(r.render(), '약속 시각이 바뀌었어요'), null);
        assert.equal(r.calls136.filter(call => call.method === 'POST').length, 0); r.unmount();
    }
});

test('#136 최신 요청 이후 도착한 이전 ROOM_UPDATED 추천 응답은 무시해요', async () => {
    const r = await roomUpdated136(); let finish;
    r.pending136 = () => new Promise(resolve => { finish = resolve; });
    r.emit136(); r.advance(300); await settle();
    r.pending136 = null;
    r.emit136({ runId: 'new-run-136' }, 'RECOMMENDATION_CREATED');
    const view = r.render();
    const refresh = findElement(view, node => node.type === 'Pressable' && findText(node.props.children, '보기'));
    assert.ok(refresh); refresh.props.onPress(); await settle();
    finish(ok(recoRun({ results: [], isStale: true, staleReasons: ['APPOINTMENT_CHANGED'] })));
    await settle(); assert.equal(findText(r.render(), '약속 시각이 바뀌었어요'), null); r.unmount();
});

test('#136 방 상세 ROOM_UPDATED는 방 정보만 반영하고 추천 API를 호출하지 않아요', async () => {
    const r = await roomUpdated136('src/app/rooms/[roomId].tsx');
    r.emit136(); r.emit136(); r.advance(300); await settle(); r.render();
    assert.equal(r.load('src/services/room-cache.ts').readCachedRoomDetail(ROOM_QUERY_ID).appointmentAt, '2026-11-15T10:00:00Z');
    assert.equal(r.calls136.length, 0);
    r.emit136({}); r.advance(300); await settle();
    assert.equal(r.calls136.filter(call => call.url.includes('/recommendations')).length, 0); r.unmount();
});

/* ---------- #143 방 이름 글자 수 기준 통일 ---------- */

const ROOM_NAME_EMPTY143 = '약속방 이름을 입력해 주세요.';
const ROOM_NAME_LONG143 = '약속방 이름은 30자까지 쓸 수 있어요.';
/** [이름, 기대 문구(null 이면 통과)] */
function roomNameCases143() {
    const mixed30 = '가'.repeat(10) + 'a'.repeat(10) + '😀🚇'.repeat(5);
    return [
        ['가'.repeat(30), null], ['가'.repeat(31), ROOM_NAME_LONG143],
        ['a'.repeat(30), null], ['a'.repeat(31), ROOM_NAME_LONG143],
        ['😀'.repeat(15) + '🚇'.repeat(15), null], ['😀'.repeat(16) + '🚇'.repeat(15), ROOM_NAME_LONG143],
        [mixed30, null], [mixed30 + '가', ROOM_NAME_LONG143],
        [`  ${'가'.repeat(30)}  `, null], [`\t${'😀'.repeat(30)}\n`, null], [` ${'a'.repeat(31)} `, ROOM_NAME_LONG143],
        ['', ROOM_NAME_EMPTY143], ['   ', ROOM_NAME_EMPTY143], ['\t\n　', ROOM_NAME_EMPTY143],
    ];
}

test('143 validateRoomName: 한글·영문·이모지·혼합 30/31, 앞뒤 공백 제외, 공백만은 빈 이름', () => {
    const room = createRuntime().load('src/services/room.ts');
    assert.equal(room.ROOM_NAME_MAX, 30);
    for (const [name, expected] of roomNameCases143()) {
        assert.equal(room.validateRoomName(name), expected, JSON.stringify(name));
        if (expected === null) assert.ok(room.roomNameLength(name) <= 30 && room.roomNameLength(name) >= 1);
    }
    // 이모지 30자는 UTF-16 으로 60이지만 30자로 세요.
    assert.equal('😀'.repeat(30).length, 60); assert.equal(room.roomNameLength('😀'.repeat(30)), 30);
});

test('143 mock 서비스 생성·수정도 같은 판정·같은 문구, 저장되는 이름은 trim 된 값', async () => {
    for (const [name, expected] of roomNameCases143()) {
        const r = createRuntime(); const room = r.load('src/services/room.ts');
        const created = room.createRoom({ name, appointmentAt: null }); r.advance(1000);
        if (expected) await assert.rejects(created, { code: 'VALIDATION_ERROR', message: expected }, JSON.stringify(name));
        else assert.equal((await created).name, name.trim());
        const updated = room.updateRoom('room-4', { name }); r.advance(1000);
        if (expected) await assert.rejects(updated, { code: 'VALIDATION_ERROR', message: expected }, JSON.stringify(name));
        else assert.equal((await updated).name, name.trim());
    }
});

test('143 서버 모드 생성·수정: 같은 판정·문구로 전송 전에 막고, 보내는 name 은 trim 된 값', async () => {
    for (const [name, expected] of roomNameCases143()) {
        const r = roomQueryRuntime(); const bodies = [];
        r.respond(async (url, options) => {
            if (options.method === 'POST') { bodies.push(['POST', JSON.parse(options.body)]); return jsonResponse({ success: true, data: { ...createdRoomData(), name: name.trim() || 'x' } }, 201); }
            if (options.method === 'PATCH') { bodies.push(['PATCH', JSON.parse(options.body)]); return jsonResponse({ success: true, data: null }); }
            return jsonResponse({ success: true, data: roomQueryDetail() });
        });
        const create = r.room.createRoom({ name, appointmentAt: null });
        const update = r.room.updateRoom(ROOM_QUERY_ID, { name });
        if (expected) {
            await assert.rejects(create, { code: 'VALIDATION_ERROR', message: expected });
            await assert.rejects(update, { code: 'VALIDATION_ERROR', message: expected });
            assert.deepEqual(bodies, []);
        } else {
            await create; await update.catch(() => {});
            assert.deepEqual(bodies.map(([method, body]) => [method, body.name]), [['POST', name.trim()], ['PATCH', name.trim()]], JSON.stringify(name));
        }
    }
});

/** 글자 수가 기본 색이 아닌 색(빨강)으로 바뀌었는지. 두 화면의 빨강 값은 원래 달라서 기본 색과 비교해요. */
function overColor143(counter) {
    const styles = [counter.props.style].flat().filter(Boolean);
    return Object.assign({}, ...styles).color !== styles[0].color;
}
test('143 생성·수정 화면: 수정 화면 maxLength 없음, 이모지 30자 기존 이름 그대로·저장 가능, 두 화면 같은 판정·문구', async () => {
    // 수정 화면: 이모지 30자 기존 이름
    const emojiName = '😀'.repeat(15) + '🚇'.repeat(15);
    const r = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID }); const patches = [];
    let detail = { ...roomQueryDetail(), name: emojiName };
    r.context.fetch = async (_url, options) => {
        if (options.method === 'PATCH') { patches.push(JSON.parse(options.body)); detail = { ...detail, ...JSON.parse(options.body) }; return jsonResponse({ success: true, data: null }); }
        return jsonResponse({ success: true, data: detail });
    };
    r.render(); await settle(); let view = r.render();
    const input = () => findElement(view, element => element.props?.accessibilityLabel === '약속 이름');
    assert.equal(input().props.maxLength, undefined);
    assert.equal(input().props.value, emojiName);
    assert.ok(findElement(view, element => element.type === 'Text' && textOf(element) === '30/30'));
    // 이름을 바꾸지 않으면 바뀐 것이 없어요(잘리지 않음). 한 글자 바꿔 저장하면 30자 이모지 이름이 그대로 가요.
    assert.equal(roomWriteButton(view, '저장').props.disabled, true);
    const changed = '🚇' + emojiName.slice(2);
    input().props.onChangeText(` ${changed} `); view = r.render();
    await roomWriteButton(view, '저장').props.onPress(); await settle();
    assert.deepEqual(patches, [{ name: changed }]);
    r.unmount();

    // 같은 입력에 두 화면이 같은 판정·같은 문구
    for (const [name, expected] of roomNameCases143()) {
        const create = roomQueryScreen('src/app/rooms/new.tsx'); let createCalls = 0;
        create.context.fetch = async () => { createCalls++; return jsonResponse({ success: true, data: { ...createdRoomData(), name: name.trim() } }, 201); };
        let createView = create.render();
        findElement(createView, element => element.type === 'TextInput').props.onChangeText(name); createView = create.render();
        // 성공하면 결과 화면으로 바뀌므로 글자 수는 누르기 전에 읽어요.
        const counter = findElement(createView, element => element.type === 'Text' && /^\d+\/30$/.test(textOf(element)));
        const createRed = overColor143(counter);
        await roomWriteButton(createView, '약속방 만들기').props.onPress(); createView = create.render();

        const edit = roomQueryScreen('src/app/rooms/[roomId]/edit.tsx', { roomId: ROOM_QUERY_ID }); let editCalls = 0;
        edit.context.fetch = async (_url, options) => {
            if (options.method === 'PATCH') { editCalls++; return jsonResponse({ success: true, data: null }); }
            return jsonResponse({ success: true, data: roomQueryDetail() });
        };
        edit.render(); await settle(); let editView = edit.render();
        findElement(editView, element => element.props?.accessibilityLabel === '약속 이름').props.onChangeText(name); editView = edit.render();
        const editCounter = findElement(editView, element => element.type === 'Text' && /^\d+\/30$/.test(textOf(element)));
        const editRed = overColor143(editCounter);
        await roomWriteButton(editView, '저장').props.onPress(); await settle(); editView = edit.render();

        const label = JSON.stringify(name);
        assert.equal(textOf(counter), textOf(editCounter), label);
        assert.equal(createRed, editRed, label); assert.equal(createRed, Array.from(name.trim()).length > 30, label);
        if (expected) {
            assert.ok(findElement(createView, element => element.type === 'Text' && textOf(element) === expected), label);
            assert.ok(findElement(editView, element => element.type === 'Text' && textOf(element) === expected), label);
            assert.equal(createCalls, 0, label); assert.equal(editCalls, 0, label);
        } else {
            assert.equal(createCalls, 1, label); assert.equal(editCalls, name.trim() === roomQueryDetail().name ? 0 : 1, label);
        }
        create.unmount(); edit.unmount();
    }
});

/* ---------- #144 방 생성 결과를 모를 때 중복 생성 방지 안내 ---------- */

const ROOM_CREATE_UNKNOWN144 = '방이 만들어졌을 수 있어요. 다시 만들기 전에 방 목록을 먼저 확인해 주세요.';
/** 생성 응답 시나리오. stored 면 서버는 방을 저장했어요. */
const create144 = {
    lost: { stored: true, respond: () => Promise.reject(new TypeError('Network request failed')) },
    timeout: { stored: true, respond: options => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))) },
    badBody: { stored: true, respond: () => Promise.resolve(jsonResponse({ success: true, data: { id: 'not-a-uuid' } }, 201)) },
    notJson: { stored: true, respond: () => Promise.resolve({ ok: true, status: 201, text: async () => '<html>ok</html>' }) },
    server500: { stored: false, respond: () => Promise.resolve(jsonResponse({ success: false, error: { code: 'INTERNAL_SERVER_ERROR' } }, 500)) },
    gateway504: { stored: true, respond: () => Promise.resolve({ ok: false, status: 504, text: async () => '<html>Gateway Timeout</html>' }) },
    validation: { stored: false, respond: () => Promise.resolve(jsonResponse({ success: false, error: { code: 'VALIDATION_ERROR' } }, 400)) },
    busy: { stored: false, respond: () => Promise.resolve(jsonResponse({ success: false, error: { code: 'ROOM_BUSY' } }, 409)) },
    proxy413: { stored: false, respond: () => Promise.resolve({ ok: false, status: 413, text: async () => 'too large' }) },
};
const UNKNOWN144 = ['lost', 'timeout', 'badBody', 'notJson', 'server500', 'gateway504'];

test('144 결과 불명 분류: 응답 유실·시간 초과·2xx 파싱 실패·5xx 는 결과 불명, 4xx·보내기 전 검사·인증 오류는 아님', async () => {
    for (const [kind, scenario] of Object.entries(create144)) {
        const r = roomQueryRuntime(); let posts = 0;
        r.respond((url, options) => { if (options.method === 'POST') { posts++; return scenario.respond(options); } return Promise.resolve(jsonResponse({ success: true, data: [] })); });
        const pending = r.room.createRoom({ name: '모임', appointmentAt: null }).catch(error => error);
        for (let i = 0; i < 5; i++) { await settle(); r.advance(5000); }
        const error = await pending;
        assert.equal(error instanceof r.load('src/types/room.ts').RoomError, true, kind);
        assert.equal(r.room.isRoomCreateOutcomeUnknown(error), UNKNOWN144.includes(kind), kind);
        assert.equal(posts, 1, kind); // 자동 재전송 없음
    }
    const r = roomQueryRuntime(); r.respond(() => { throw Error('보내면 안 돼요'); });
    const local = await r.room.createRoom({ name: ' ', appointmentAt: null }).catch(error => error);
    assert.equal(local.code, 'VALIDATION_ERROR'); assert.equal(r.room.isRoomCreateOutcomeUnknown(local), false);
    const { ApiError } = r.load('src/services/api/errors.ts');
    for (const [error, expected] of [[new ApiError('TOKEN_EXPIRED', null, null, 401), false], [new ApiError('AUTH_REQUIRED'), false], [new ApiError('NETWORK_ERROR'), true],
        [new ApiError('UNKNOWN_ERROR', null, null, 201), true], [new ApiError('UNKNOWN_ERROR', null, null, 502), true], [new ApiError('ROOM_FULL', null, null, 409), false]]) {
        assert.equal(r.room.isRoomCreateOutcomeUnknown(error), expected, `${error.code} ${error.status}`);
    }
    // 인증 오류는 RoomError 로 바꾸지 않고 그대로 던져요(기존 처리).
    const auth = roomQueryRuntime(); auth.respond((_url, options) => Promise.resolve(options.method === 'POST' ? jsonResponse({ success: false, error: { code: 'TOKEN_INVALID' } }, 401) : jsonResponse({ success: true, data: [] })));
    const authError = await auth.room.createRoom({ name: '모임', appointmentAt: null }).catch(error => error);
    assert.equal(authError.code, 'TOKEN_INVALID'); assert.equal(auth.room.isRoomCreateOutcomeUnknown(authError), false);
});

test('144 결과 불명 뒤 목록은 생성 전에 시작한 조회를 함께 쓰지 않고 서버에서 새로 조회해요', async () => {
    const r = roomQueryRuntime(); let gets = 0; let first; const created = roomQuerySummary({ id: ROOM_QUERY_ID, name: '모임' });
    r.respond((url, options) => {
        if (options.method === 'POST') return create144.lost.respond();
        gets++;
        if (gets === 1) return new Promise(resolve => { first = resolve; });
        return Promise.resolve(jsonResponse({ success: true, data: [created] }));
    });
    const before = r.room.fetchMyRooms(); await settle();
    const error = await r.room.createRoom({ name: '모임', appointmentAt: null }).catch(value => value);
    assert.equal(r.room.isRoomCreateOutcomeUnknown(error), true);
    const after = r.room.fetchMyRooms(); await settle();
    assert.equal(gets, 2);
    first(jsonResponse({ success: true, data: [] })); assert.deepEqual(plain(await before), []);
    assert.deepEqual(plain(await after).map(room => room.id), [ROOM_QUERY_ID]);
});

function createScreen144() {
    const r = roomQueryScreen('src/app/rooms/new.tsx'); r.posts = 0; r.moves = [];
    r.external['expo-router'].router.dismissTo = href => r.moves.push(['dismissTo', href]);
    r.external['expo-router'].router.replace = href => r.moves.push(['replace', href]);
    r.scenario = create144.lost;
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') { r.posts++; return r.scenario.respond(options); }
        return jsonResponse({ success: true, data: [] });
    };
    r.type = name => { findElement(r.render(), element => element.type === 'TextInput').props.onChangeText(name); return r.render(); };
    r.press = async label => {
        const pending = roomWriteButton(r.render(), label).props.onPress();
        for (let i = 0; i < 5; i++) { await settle(); r.advance(5000); }
        await pending; return r.render();
    };
    return r;
}

test('144 생성 화면: 응답 유실·시간 초과·파싱 실패는 결과 불명 안내와 "방 목록 확인", 요청은 한 번만, 확인 누르면 목록으로', async () => {
    for (const kind of UNKNOWN144) {
        const r = createScreen144(); r.scenario = create144[kind];
        r.type('금요 모임'); let view = await r.press('약속방 만들기');
        assert.ok(findText(view, ROOM_CREATE_UNKNOWN144), kind);
        assert.ok(findElement(view, element => element.props?.accessibilityRole === 'alert'), kind);
        assert.equal(findTextIncluding(view, '서버에 연결하지 못했어요'), null, kind);
        assert.equal(findTextIncluding(view, '서버의 방 정보를 확인하지 못했어요'), null, kind);
        assert.equal(findElement(view, element => element.type === 'TextInput').props.value, '금요 모임', kind);
        r.advance(60000); await settle(); assert.equal(r.posts, 1, kind); // 자동 재전송 없음
        roomWriteButton(view, '방 목록 확인').props.onPress();
        assert.deepEqual(r.moves, [['dismissTo', '/rooms']], kind);
        // 다시 만들기는 막지 않지만 버튼 문구로 한 번 더 확인해요.
        assert.equal(roomWriteButton(view, '약속방 만들기'), null); assert.ok(roomWriteButton(view, '그래도 새로 만들기'));
        r.scenario = { respond: () => Promise.resolve(jsonResponse({ success: true, data: createdRoomData({ name: '금요 모임' }) }, 201)) };
        view = await r.press('그래도 새로 만들기'); assert.equal(r.posts, 2, kind);
        assert.equal(view.props.room.roomCode, 'A3K9PZ', kind);
        r.unmount();
    }
});

test('144 "방 목록 확인" 뒤 목록 화면은 서버 목록을 다시 조회해 새 방을 보여줘요', async () => {
    const list = roomQueryScreen('src/app/rooms/index.tsx'); const gets = [];
    list.context.fetch = async (url, options) => { gets.push([options.method ?? 'GET', url]); return jsonResponse({ success: true, data: [roomQuerySummary({ name: '금요 모임' })] }); };
    list.render(); await settle(); const view = list.render();
    assert.deepEqual(gets.filter(([, url]) => url.endsWith('/rooms')).length, 1);
    assert.ok(findElement(view, element => element.props?.room?.id === ROOM_QUERY_ID && element.props.room.name === '금요 모임'));
    list.unmount();
});

test('144 4xx(VALIDATION_ERROR·ROOM_BUSY·본문 없는 413)는 기존 실패 안내 그대로, 결과 불명 안내 없음', async () => {
    for (const [kind, message] of [['validation', '요청한 방 정보를 확인해 주세요.'], ['busy', '다른 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.'], ['proxy413', '서버의 방 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.']]) {
        const r = createScreen144(); r.scenario = create144[kind];
        r.type('모임'); const view = await r.press('약속방 만들기');
        assert.ok(findText(view, message), kind);
        assert.equal(findText(view, ROOM_CREATE_UNKNOWN144), null, kind);
        assert.equal(roomWriteButton(view, '방 목록 확인'), null, kind); assert.ok(roomWriteButton(view, '약속방 만들기'), kind);
        assert.equal(r.posts, 1, kind); r.unmount();
    }
});

test('144 같은 이름의 방을 연속으로 만들 수 있어요(이름으로 막거나 단정하지 않음)', async () => {
    const r = roomQueryRuntime(); const bodies = []; let id = 0;
    r.respond((_url, options) => {
        if (options.method !== 'POST') return Promise.resolve(jsonResponse({ success: true, data: [] }));
        bodies.push(JSON.parse(options.body)); id++;
        return Promise.resolve(jsonResponse({ success: true, data: createdRoomData({ id: `${ROOM_QUERY_ID.slice(0, -1)}${id}`, name: '같은 이름', roomCode: `A3K9P${id}` }) }, 201));
    });
    const first = await r.room.createRoom({ name: '같은 이름', appointmentAt: null });
    const second = await r.room.createRoom({ name: '같은 이름', appointmentAt: null });
    assert.equal(bodies.length, 2); assert.notEqual(first.id, second.id); assert.equal(first.name, second.name);
    // 화면에서도: 결과 불명 뒤 같은 이름으로 다시 만들면 그대로 보내요.
    const s = createScreen144(); s.type('같은 이름'); await s.press('약속방 만들기');
    s.scenario = { respond: options => { bodies.push(JSON.parse(options.body)); return Promise.resolve(jsonResponse({ success: true, data: createdRoomData({ name: '같은 이름' }) }, 201)); } };
    await s.press('그래도 새로 만들기');
    assert.deepEqual(bodies.slice(2).map(body => body.name), ['같은 이름']); s.unmount();
});

test('144 mock 모드 생성 실패는 이전과 같은 안내이고 결과 불명 안내가 없어요', async () => {
    let calls = 0;
    const m = createScreenRuntime({}, 'src/app/rooms/new.tsx', runtime => {
        runtime.external['expo-clipboard'] = { setStringAsync: async () => {} }; runtime.native.ScrollView = 'ScrollView';
        runtime.external['expo-router'].useLocalSearchParams = () => ({ mock: 'error' });
    });
    m.context.fetch = async () => { calls++; throw Error(); };
    findElement(m.render(), element => element.type === 'TextInput').props.onChangeText('모임');
    const pending = roomWriteButton(m.render(), '약속방 만들기').props.onPress(); m.advance(1000); await pending; await settle();
    let view = m.render();
    assert.ok(findText(view, '약속방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'));
    assert.equal(findText(view, ROOM_CREATE_UNKNOWN144), null); assert.equal(roomWriteButton(view, '방 목록 확인'), null);
    assert.ok(roomWriteButton(view, '약속방 만들기'));
    const retry = roomWriteButton(view, '약속방 만들기').props.onPress(); m.advance(1000); await retry; await settle(); view = m.render();
    assert.ok(view.props.room); assert.equal(calls, 0); m.unmount();
});

/* ---------- #137 채팅 재연결 뒤 끊긴 동안 쌓인 메시지 빠짐없이 복구 ---------- */

const chat137Id = n => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const chat137Message = n => chat118Message({ id: chat137Id(n), senderId: ROOM_QUERY_OTHER, nickname: '상대', content: `메시지 ${n}`,
    createdAt: new Date(Date.UTC(2026, 10, 12, 10, 0, 0) + n * 1000).toISOString() });
/** 명세 10.2 처럼 최신순·cursor(이전 페이지 마지막 id) 페이지를 돌려주는 가짜 서버 */
function chat137Server(r, count) {
    const server = { count, gets: [], fail: null, hold: null };
    server.add = to => { server.count = to; };
    r.context.fetch = async (url) => {
        const query = new URL(url).searchParams;
        const cursor = query.get('cursor'); const size = Number(query.get('size') ?? 30);
        server.gets.push(cursor);
        if (server.hold) await server.hold(server.gets.length);
        if (server.fail?.(server.gets.length, cursor)) return jsonResponse({ success: false, error: { code: 'NETWORK_ERROR' } }, 503);
        const all = Array.from({ length: server.count }, (_, i) => server.count - i); // 최신 → 오래된
        const start = cursor ? all.indexOf(Number(cursor.slice(-12))) + 1 : 0;
        const items = all.slice(start, start + size);
        const hasMore = start + size < all.length;
        return ok({ items: items.map(chat137Message), hasMore, nextCursor: hasMore ? chat137Id(items.at(-1)) : null });
    };
    return server;
}
const chat137Numbers = view => plain(view.messages.map(message => Number(message.id.slice(-12))));
/** 여러 페이지를 이어 받는 복구가 끝날 때까지 기다려요. */
const drain137 = async () => { for (let i = 0; i < 40; i++) await settle(); };
const range137 = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
async function chat137Load(count) {
    const r = chat118Hook('open'); const server = chat137Server(r, count);
    r.render(); await drain137();
    return { r, server };
}
async function chat137LoadAll(r) {
    for (let i = 0; i < 40 && r.render().hasMore; i++) { r.render().loadOlder(); await drain137(); }
}

test('137 복구 함수: 겹침·처음까지·상한 세 경우와 결과 반영', async () => {
    const hook = createRuntime(serverEnv).load('src/hooks/use-room-chat.ts');
    const page = (numbers, hasMore) => ({ items: numbers.map(chat137Message), hasMore, nextCursor: hasMore ? chat137Id(numbers.at(-1)) : null });
    const pages = new Map([[null, page(range137(71, 100).reverse(), true)], [chat137Id(71), page(range137(41, 70).reverse(), true)], [chat137Id(41), page(range137(11, 40).reverse(), true)], [chat137Id(11), page(range137(1, 10).reverse(), false)]]);
    const fetch = async cursor => pages.get(cursor);
    const overlap = await hook.recoverChatGap(fetch, new Set([chat137Id(30)]), () => true);
    assert.equal(overlap.mode, 'overlap'); assert.equal(overlap.items.length, 90);
    const complete = await hook.recoverChatGap(fetch, new Set(), () => true);
    assert.deepEqual([complete.mode, complete.items.length, complete.cursor, complete.hasMore], ['complete', 100, null, false]);
    const capped = await hook.recoverChatGap(fetch, new Set(), () => true, 2);
    assert.deepEqual([capped.mode, capped.items.length, capped.cursor, capped.hasMore], ['replace', 60, chat137Id(41), true]);
    assert.equal(await hook.recoverChatGap(fetch, new Set(), () => false), null);
    assert.equal(hook.CHAT_RECOVERY_MAX_PAGES, 10);
    // 상한 결과 반영: 받은 범위보다 오래된 기존 메시지만 버리고 더 최신(WS) 메시지는 남겨요.
    const current = [...range137(1, 30), 101].map(chat137Message);
    assert.deepEqual(plain(hook.applyChatRecovery(current, capped).map(message => Number(message.id.slice(-12)))), [...range137(41, 100), 101]);
    assert.deepEqual(plain(hook.applyChatRecovery(current, overlap).map(message => Number(message.id.slice(-12)))), [...range137(1, 100), 101]);
});

test('137 이슈 시나리오: 30개 본 뒤 끊긴 동안 70개 추가 → 재연결 → 빈 구간 없이 표시, 이전 메시지 조회도 이어져요', async () => {
    const { r, server } = await chat137Load(60);
    assert.deepEqual(chat137Numbers(r.render()), range137(31, 60)); assert.equal(r.render().hasMore, true);
    server.add(130); server.gets.length = 0;
    r.reconnect(); await drain137();
    assert.deepEqual(chat137Numbers(r.render()), range137(31, 130));
    assert.deepEqual(server.gets, [null, chat137Id(101), chat137Id(71)]); // 31~60 과 겹치는 페이지까지만
    assert.equal(r.render().error, null);
    await chat137LoadAll(r);
    assert.deepEqual(chat137Numbers(r.render()), range137(1, 130)); assert.equal(r.render().hasMore, false);
    // 이슈 원래 모양(1~30 이 전부인 방)도 1~100 이 돼요.
    const small = await chat137Load(30); small.server.add(100);
    small.r.reconnect(); await drain137();
    assert.deepEqual(chat137Numbers(small.r.render()), range137(1, 100)); assert.equal(small.r.render().hasMore, false);
    r.unmount(); small.r.unmount();
});

test('137 누락이 30개 이하면 한 페이지로 복구하고 화면 복귀·reload 도 같은 방식이에요', async () => {
    const { r, server } = await chat137Load(60);
    server.add(75); server.gets.length = 0;
    r.reconnect(); await drain137();
    assert.deepEqual(chat137Numbers(r.render()), range137(31, 75)); assert.deepEqual(server.gets, [null]);
    server.add(120); r.blur(); r.focus(); await drain137();
    assert.deepEqual(chat137Numbers(r.render()), range137(31, 120));
    server.add(160); await r.render().reload(); await settle();
    assert.deepEqual(chat137Numbers(r.render()), range137(31, 160));
    r.unmount();
});

test('137 누락이 상한(300개)을 넘으면 받은 범위로 바꾸고 이전 메시지 조회로 빈 구간 없이 이어 받아요', async () => {
    const { r, server } = await chat137Load(60);
    server.add(460); server.gets.length = 0;
    r.reconnect(); await drain137();
    assert.equal(server.gets.length, 10);
    assert.deepEqual(chat137Numbers(r.render()), range137(161, 460)); assert.equal(r.render().hasMore, true);
    await chat137LoadAll(r);
    assert.deepEqual(chat137Numbers(r.render()), range137(1, 460));
    r.unmount();
});

test('137 복구 중 WS 로 받은 메시지는 한 번만, 목록을 바꿀 때도 사라지지 않아요', async () => {
    for (const added of [75, 460]) {
        const { r, server } = await chat137Load(60);
        server.add(added); let release; const gate = new Promise(resolve => { release = resolve; });
        server.hold = count => count === 2 ? gate : undefined; // 첫 복구 페이지 응답 직후 멈춰요
        r.reconnect(); await settle();
        const ws = chat137Message(added + 1); r.event(ws); r.event(chat137Message(added)); // 새 메시지와 이미 받을 메시지
        release(); await drain137();
        server.hold = null;
        const numbers = chat137Numbers(r.render());
        assert.equal(numbers.filter(n => n === added + 1).length, 1, String(added));
        assert.equal(new Set(numbers).size, numbers.length, String(added));
        assert.deepEqual(numbers, range137(added > 300 ? added - 299 : 31, added + 1), String(added));
        r.unmount();
    }
});

test('137 복구 중 화면 이탈·권한 상실·계정 전환이면 결과를 버리고 더 받지 않아요', async () => {
    for (const cause of ['blur', 'reject', 'account']) {
        const { r, server } = await chat137Load(60);
        server.add(200); let release; const gate = new Promise(resolve => { release = resolve; });
        server.hold = count => count === 3 ? gate : undefined; server.gets.length = 0;
        r.reconnect(); await settle();
        assert.equal(server.gets.length, 2);
        if (cause === 'blur') r.blur();
        if (cause === 'reject') r.reject('NOT_ROOM_MEMBER');
        if (cause === 'account') r.load('src/stores/auth-store.ts').signIn({ userId: 'other-user', nickname: '다른 사람' });
        release(); await drain137();
        assert.equal(server.gets.length, 2, cause); // 더 받지 않아요
        const view = r.render();
        if (cause === 'blur') assert.deepEqual(chat137Numbers(view), range137(31, 60));
        else assert.equal(view.messages.length, 0, cause);
        if (cause === 'reject') assert.equal(view.blocked, true);
        r.unmount();
    }
});

test('137 복구 중 두 번째 페이지 실패: 기존 목록 그대로·오류 표시, 다시 시도하면 빈 구간 없이 복구', async () => {
    const { r, server } = await chat137Load(60);
    server.add(130); server.gets.length = 0;
    server.fail = count => count === 2;
    r.reconnect(); await drain137();
    let view = r.render();
    assert.deepEqual(chat137Numbers(view), range137(31, 60)); // 받은 첫 페이지(101~130)를 합치지 않아요
    assert.ok(view.error); assert.equal(view.status, 'ready');
    server.fail = null;
    await view.reload(); await settle(); view = r.render();
    assert.deepEqual(chat137Numbers(view), range137(31, 130)); assert.equal(view.error, null);
    r.unmount();
});

test('137 AI 답변 대기 폴링의 최신 페이지가 목록과 이어지지 않으면 같은 복구로 채워요', async () => {
    const r = chat118Hook('closed'); const server = chat137Server(r, 60);
    r.render(); await drain137();
    server.add(130); server.gets.length = 0;
    r.prepared(); await drain137(); await settle(); // 구독 직후 최신 한 페이지 조회
    assert.deepEqual(chat137Numbers(r.render()), range137(31, 130));
    r.unmount();
});

/* ---------- #138 AI 답변 하나는 질문 하나만 해제 ---------- */

const ai138Id = n => `01900000-0000-7000-8000-${String(900000 + n).padStart(12, '0')}`;
const ai138At = second => new Date(Date.UTC(2026, 10, 12, 10, 0, second)).toISOString();
const ai138Question = (n, second, mine = true) => chat118Message({ id: ai138Id(n), senderId: mine ? ROOM_QUERY_ME : ROOM_QUERY_OTHER,
    nickname: mine ? '서버 나' : '상대', content: `@링크로 질문 ${n}`, createdAt: ai138At(second) });
const ai138Reply = (n, second, content = `답변 ${n}`, senderType = 'AI') => chat118Message({ id: ai138Id(n), senderType, senderId: null, nickname: null, content, createdAt: ai138At(second) });
/** 질문을 보내면 POST 응답으로 questions 를 차례로 돌려주는 채팅 훅. GET 은 items 를 돌려줘요. */
async function ai138Hook(questions, realtime = 'open') {
    const r = chat118Hook(realtime); r.items = []; let sent = 0; r.gets = 0;
    r.context.fetch = async (_url, options) => {
        if (options.method === 'POST') { const question = questions[sent++]; return ok({ message: question, aiPending: true }); }
        r.gets++;
        return ok({ items: [...r.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), hasMore: false, nextCursor: null });
    };
    r.render(); await settle();
    r.ask = async () => { r.render().setDraft('@링크로 질문'); r.render().send(); await settle(); };
    return r;
}

test('138 짝짓기 규칙: 답변 하나는 그보다 먼저 쓴 가장 오래된 미답 질문 하나만, 같은 id 는 한 번만, 순서와 무관', () => {
    const wait = createRuntime().load('src/services/chat-ai-wait.ts');
    const q1 = ai138Question(1, 1); const q2 = ai138Question(2, 2); const other = ai138Question(3, 0, false); // 다른 사람 질문이 가장 먼저
    const r1 = ai138Reply(11, 5); const r2 = ai138Reply(12, 6);
    assert.deepEqual([...wait.matchAiReplies([q1, q2], [r1])], [q1.id]);
    assert.deepEqual([...wait.matchAiReplies([q2, q1], [r2, r1])].sort(), [q1.id, q2.id].sort());
    // 답변보다 나중에 쓴 질문은 해제하지 않아요.
    assert.deepEqual([...wait.matchAiReplies([ai138Question(4, 9)], [r1])], []);
    // 같은 시각이면 id 순서
    const sameTime = ai138Question(5, 5);
    assert.deepEqual([...wait.matchAiReplies([sameTime], [ai138Reply(4, 5)])], []);
    assert.deepEqual([...wait.matchAiReplies([sameTime], [ai138Reply(6, 5)])], [sameTime.id]);
    // 추적기: 같은 답변을 여러 번 받아도 한 번, 받은 순서와 상관없이 같은 결과
    const tracker = wait.createAiReplyTracker();
    tracker.observe([r1]); tracker.observe([r1, r1]); tracker.addQuestion(q2); tracker.observe([other]); tracker.addQuestion(q1);
    assert.deepEqual([q1, q2, other].map(q => tracker.isAnswered(q.id)), [false, false, true]);
    // 답변·질문 판단
    assert.equal(wait.isAiQuestion(chat118Message({ content: '@LinkRo 안녕' })), true);
    assert.equal(wait.isAiQuestion(chat118Message({ content: '안녕' })), false);
    assert.equal(wait.isAiQuestion(ai138Reply(1, 0, '@링크로')), false);
    for (const [content, type, expected] of [['답변', 'AI', true], ['AI 사용 한도를 초과해 답변하지 못했어요.', 'SYSTEM', true], ['AI가 답변을 만들지 못했어요.', 'SYSTEM', true],
        ['AI링크로님이 참여했어요.', 'SYSTEM', false], ['상대님이 나갔어요.', 'SYSTEM', false], ['약속역이 강남역으로 정해졌어요.', 'SYSTEM', false]]) {
        assert.equal(wait.isAiReply(ai138Reply(1, 0, content, type)), expected, content);
    }
});

test('138 내 질문 2개 → 답변 1개: 대기 남음 → 두 번째 답변: 해제', async () => {
    const r = await ai138Hook([ai138Question(1, 0), ai138Question(2, 1)]);
    await r.ask(); await r.ask();
    assert.equal(r.render().aiPending, 1);
    r.event(ai138Reply(11, 5)); assert.equal(r.render().aiPending, 1);
    r.event(ai138Reply(12, 6)); assert.equal(r.render().aiPending, 0); assert.equal(r.timers.size, 0);
    r.unmount();
});

test('138 다른 사람 질문 + 내 질문 → 답변 1개: 다른 사람 질문이 먼저 소비돼 내 대기는 남아요', async () => {
    const r = await ai138Hook([ai138Question(2, 1)]);
    r.event(ai138Question(1, 0, false));
    await r.ask(); assert.equal(r.render().aiPending, 1);
    r.event(ai138Reply(11, 5)); assert.equal(r.render().aiPending, 1);
    r.event(ai138Reply(12, 6)); assert.equal(r.render().aiPending, 0);
    r.unmount();
});

test('138 답변이 질문 POST 응답보다 먼저 오면 질문 등록 즉시 해제', async () => {
    const r = chat118Hook('open'); let resolve;
    r.context.fetch = async (_url, options) => options.method === 'POST' ? await new Promise(done => { resolve = done; }) : ok({ items: [], hasMore: false, nextCursor: null });
    r.render(); await settle(); r.render().setDraft('@링크로 질문'); r.render().send(); await settle();
    r.event(ai138Reply(11, 5));
    resolve(ok({ message: ai138Question(1, 0), aiPending: true })); await settle();
    assert.equal(r.render().aiPending, 0); assert.equal(r.timers.size, 0); r.unmount();
});

test('138 같은 답변을 WS·REST(reload)·재연결 복구로 여러 번 받아도 한 번만 소비', async () => {
    const q1 = ai138Question(1, 0); const q2 = ai138Question(2, 1); const reply = ai138Reply(11, 5);
    const r = await ai138Hook([q1, q2]);
    await r.ask(); await r.ask(); r.items = [q1, q2, reply];
    r.event(reply); r.event(reply);
    await r.render().reload(); await settle();
    r.reconnect(); await settle(); await settle();
    assert.ok(r.gets >= 2);
    assert.equal(r.render().messages.filter(message => message.id === reply.id).length, 1);
    assert.equal(r.render().aiPending, 1);
    r.event(ai138Reply(12, 6)); assert.equal(r.render().aiPending, 0);
    r.unmount();
});

test('138 AI 실패 SYSTEM 안내도 답변으로 소비하고, 입장·퇴장·약속역 SYSTEM 은 소비하지 않아요', async () => {
    const r = await ai138Hook([ai138Question(1, 0), ai138Question(2, 1)]);
    await r.ask(); await r.ask();
    for (const [n, content] of [[21, 'AI링크로님이 참여했어요.'], [22, '상대님이 나갔어요.'], [23, '약속역이 강남역으로 정해졌어요.']]) r.event(ai138Reply(n, 4, content, 'SYSTEM'));
    assert.equal(r.render().aiPending, 1);
    r.event(ai138Reply(24, 5, 'AI 사용 한도를 초과해 답변하지 못했어요.', 'SYSTEM')); assert.equal(r.render().aiPending, 1);
    r.event(ai138Reply(25, 6, 'AI가 답변을 만들지 못했어요.', 'SYSTEM')); assert.equal(r.render().aiPending, 0);
    r.unmount();
});

test('138 답변이 오지 않으면 60초 뒤 대기가 해제돼요(질문마다)', async () => {
    const r = await ai138Hook([ai138Question(1, 0), ai138Question(2, 1)]);
    await r.ask(); r.advance(30000); await settle(); await r.ask();
    r.event(ai138Reply(11, 5)); // 첫 질문만 소비
    assert.equal(r.render().aiPending, 1);
    r.advance(30000); await settle(); await settle(); assert.equal(r.render().aiPending, 1); // 첫 질문 기한이지만 이미 답변됨
    r.advance(30000); await settle(); await settle(); assert.equal(r.render().aiPending, 0); // 두 번째 질문 60초
    assert.equal(r.timers.size, 0); r.unmount();
});

test('138 표시: 내 질문 여러 개가 대기여도 숫자가 아니라 "답변 작성 중" 한 줄', async () => {
    const r = await ai138Hook([ai138Question(1, 0), ai138Question(2, 1), ai138Question(3, 2)]);
    await r.ask(); await r.ask(); await r.ask();
    const controller = r.render(); assert.equal(controller.aiPending, 1);
    const panel = createScreenRuntime(serverEnv, 'src/components/rooms/chat-panel.tsx', runtime => {
        Object.assign(runtime.native, { ScrollView: 'ScrollView', Platform: { OS: 'ios', select: value => value.ios }, Keyboard: { dismiss() {}, addListener: () => ({ remove() {} }) } });
    });
    const view = panel.renderComponent({ type: panel.screen.default, props: { controller, myUserId: ROOM_QUERY_ME, members: [] } });
    const status = findAll125(view, element => element.type === 'Text').map(textOf).filter(text => text.includes('답변'));
    assert.deepEqual(status, ['링크로가 답변 중...']);
    assert.ok(!status.some(text => /\d/.test(text)));
    r.unmount();
});

/* #138 보완: 60초 시간 창 — 답이 오지 않은 옛 질문이 이후 답변을 가로채지 않아요 */

/** 초 단위 + 밀리초까지 정할 수 있는 시각 */
const ai138WindowAt = ms => new Date(Date.UTC(2026, 10, 12, 10, 0, 0) + ms).toISOString();
const ai138WindowQuestion = (n, ms, mine = true) => ({ ...ai138Question(n, 0, mine), createdAt: ai138WindowAt(ms) });
const ai138WindowReply = (n, ms) => ({ ...ai138Reply(n, 0), createdAt: ai138WindowAt(ms) });

test('138 시간 창: 60초 넘게 답이 없던 옛 질문 + 새 질문 + 답변 1개 → 새 질문만 해제, 옛 질문은 미답', () => {
    const wait = createRuntime().load('src/services/chat-ai-wait.ts');
    assert.equal(wait.AI_REPLY_WINDOW_MS, 60_000);
    const old = ai138WindowQuestion(1, 0, false); const fresh = ai138WindowQuestion(2, 120_000); const reply = ai138WindowReply(11, 125_000);
    assert.deepEqual([...wait.matchAiReplies([old, fresh], [reply])], [fresh.id]);
    const tracker = wait.createAiReplyTracker();
    tracker.observe([old, fresh, reply]);
    assert.deepEqual([tracker.isAnswered(old.id), tracker.isAnswered(fresh.id)], [false, true]);
    // 창 안의 질문이 여럿이면 기존대로 가장 오래된 하나만, 다른 사람 질문도 소비해요.
    const other = ai138WindowQuestion(3, 110_000, false);
    assert.deepEqual([...wait.matchAiReplies([old, other, fresh], [reply])], [other.id]);
});

test('138 시간 창 경계: 질문 60초 뒤 정각 답변은 짝지어지고 60.001초 뒤는 짝지어지지 않아요', () => {
    const wait = createRuntime().load('src/services/chat-ai-wait.ts');
    const question = ai138WindowQuestion(1, 0);
    assert.deepEqual([...wait.matchAiReplies([question], [ai138WindowReply(11, 60_000)])], [question.id]);
    assert.deepEqual([...wait.matchAiReplies([question], [ai138WindowReply(11, 60_001)])], []);
    // 질문보다 먼저 쓴 답변은 여전히 짝짓지 않아요.
    assert.deepEqual([...wait.matchAiReplies([ai138WindowQuestion(1, 5_000)], [ai138WindowReply(11, 4_999)])], []);
});

test('138 시간 창: 방 기록(옛 질문들)을 먼저 받은 뒤 새 질문·답변이 와도, 순서를 섞어도 같은 결과', () => {
    const wait = createRuntime().load('src/services/chat-ai-wait.ts');
    const history = [ai138WindowQuestion(1, 0, false), ai138WindowQuestion(2, 10_000), ai138WindowQuestion(3, 20_000, false)];
    const fresh = ai138WindowQuestion(4, 300_000); const reply = ai138WindowReply(11, 305_000);
    const expected = { [history[0].id]: false, [history[1].id]: false, [history[2].id]: false, [fresh.id]: true };
    const orders = [
        tracker => { tracker.observe(history); tracker.addQuestion(fresh); tracker.observe([reply]); }, // 기록 → 새 질문 → 답변
        tracker => { tracker.observe([reply]); tracker.observe(history.slice().reverse()); tracker.addQuestion(fresh); }, // 답변 먼저, 질문 나중
        tracker => { tracker.observe([fresh, reply, ...history]); tracker.observe([reply]); tracker.observe(history); }, // 섞어서·중복
    ];
    for (const order of orders) {
        const tracker = wait.createAiReplyTracker(); order(tracker);
        assert.deepEqual(Object.fromEntries(Object.keys(expected).map(id => [id, tracker.isAnswered(id)])), expected);
    }
});

test('138 시간 창: 화면에서도 옛 미답 질문이 답변을 가로채지 않아 내 대기가 바로 해제돼요', async () => {
    const r = await ai138Hook([ai138WindowQuestion(2, 120_000)]);
    r.event(ai138WindowQuestion(1, 0)); // 답이 오지 않은 옛 질문(기록)
    await r.ask(); assert.equal(r.render().aiPending, 1);
    r.event(ai138WindowReply(11, 125_000)); assert.equal(r.render().aiPending, 0); assert.equal(r.timers.size, 0);
    r.unmount();
});

/* ---------- #139 응답 유실 뒤 재시도의 중복 저장 방지 ---------- */

/** 명세 10.1·10.2 를 흉내 내는 가짜 서버. post: 'ok' | 'saveLose'(저장 후 응답 유실) | 'lose'(저장 안 됨, 응답 실패) */
function chat139Server(r, initial = 10) {
    const server = { messages: [], seq: 0, post: 'ok', posts: 0, gets: 0, hold: null };
    server.make = (senderId, content) => {
        const n = ++server.seq;
        return chat118Message({ id: `01900000-0000-7000-8000-${String(500000 + n).padStart(12, '0')}`, senderId,
            nickname: senderId === ROOM_QUERY_ME ? '서버 나' : '상대', content, createdAt: new Date(Date.UTC(2026, 10, 12, 9, 0, 0) + n * 1000).toISOString() });
    };
    server.addOthers = count => { for (let i = 0; i < count; i++) server.messages.push(server.make(ROOM_QUERY_OTHER, `상대 ${server.seq + 1}`)); };
    server.mine = content => server.messages.filter(message => message.senderId === ROOM_QUERY_ME && message.content === content);
    server.addOthers(initial);
    r.context.fetch = async (url, options) => {
        if (options.method === 'POST') {
            server.posts++;
            const mode = server.post; const message = server.make(ROOM_QUERY_ME, JSON.parse(options.body).content);
            if (mode !== 'lose') server.messages.push(message);
            if (mode !== 'ok') throw new TypeError('응답 유실');
            return ok({ message, aiPending: false });
        }
        server.gets++;
        if (server.hold) await server.hold(server.gets);
        const cursor = new URL(url).searchParams.get('cursor'); const size = 30;
        const all = [...server.messages].reverse();
        const start = cursor ? all.findIndex(message => message.id === cursor) + 1 : 0;
        const items = all.slice(start, start + size); const hasMore = start + size < all.length;
        return ok({ items, hasMore, nextCursor: hasMore ? items.at(-1).id : null });
    };
    return server;
}
async function chat139Hook(initial = 10, realtime = 'open') {
    const r = chat118Hook(realtime); const server = chat139Server(r, initial);
    r.render(); await drain137();
    r.sendText = async (content, mode) => { server.post = mode; r.render().setDraft(content); r.render().send(); await drain137(); return r.render().pending.at(-1); };
    r.retry = async entry => { r.render().retrySend(r.render().pending.find(item => item.clientId === entry.clientId)); await drain137(); };
    return { r, server };
}
const mineIn139 = (view, content) => view.messages.filter(message => message.senderId === ROOM_QUERY_ME && message.content === content);

test('139 저장됐는데 응답 유실 → 이후 40개 추가(최신 30개 밖) → 재시도: 원본을 찾아 저장 처리, POST 추가 없음', async () => {
    const { r, server } = await chat139Hook();
    const entry = await r.sendText('안녕하세요', 'saveLose');
    assert.equal(entry.status, 'failed'); assert.equal(server.posts, 1);
    server.addOthers(40); server.post = 'ok';
    await r.retry(entry);
    assert.equal(server.posts, 1); assert.equal(server.mine('안녕하세요').length, 1);
    assert.equal(r.render().pending.length, 0);
    assert.deepEqual(plain(mineIn139(r.render(), '안녕하세요')).map(message => message.id), server.mine('안녕하세요').map(message => message.id));
    r.unmount();
});

test('139 응답 유실이지만 실제로 저장 안 됨 → 재시도: 기준점까지 확인 후 POST 1번', async () => {
    const { r, server } = await chat139Hook();
    const entry = await r.sendText('저장 안 된 메시지', 'lose');
    server.addOthers(40); server.post = 'ok'; server.gets = 0;
    await r.retry(entry);
    assert.equal(server.posts, 2); assert.ok(server.gets >= 2); // 최신 30개를 넘어 기준점까지 확인했어요
    assert.equal(server.mine('저장 안 된 메시지').length, 1); assert.equal(r.render().pending.length, 0);
    r.unmount();
});

test('139 같은 본문 두 번 전송·둘 다 저장 후 응답 유실 → 각각 다른 메시지로 확인, POST 추가 없음', async () => {
    const { r, server } = await chat139Hook();
    const first = await r.sendText('같은 본문', 'saveLose'); const second = await r.sendText('같은 본문', 'saveLose');
    server.addOthers(35); server.post = 'ok';
    await r.retry(first); await r.retry(second);
    assert.equal(server.posts, 2); assert.equal(r.render().pending.length, 0);
    const shown = plain(mineIn139(r.render(), '같은 본문')).map(message => message.id);
    assert.equal(shown.length, 2); assert.equal(new Set(shown).size, 2);
    r.unmount();
});

test('139 같은 본문 두 번 전송·하나만 저장 → 하나는 확인, 하나는 다시 보내요', async () => {
    const { r, server } = await chat139Hook();
    const first = await r.sendText('하나만 저장', 'saveLose'); const second = await r.sendText('하나만 저장', 'lose');
    server.addOthers(35); server.post = 'ok';
    await r.retry(first); assert.equal(server.posts, 2);
    await r.retry(second); assert.equal(server.posts, 3);
    assert.equal(server.mine('하나만 저장').length, 2); assert.equal(r.render().pending.length, 0);
    assert.equal(mineIn139(r.render(), '하나만 저장').length, 2);
    r.unmount();
});

test('139 상한까지 기준점을 못 만나면 자동 전송 없이 불명 안내, 한 번 더 누르면 POST 1번', async () => {
    const { r, server } = await chat139Hook(5);
    const entry = await r.sendText('너무 오래전 메시지', 'lose');
    server.addOthers(400); server.post = 'ok';
    await r.retry(entry);
    let pending = r.render().pending[0];
    assert.equal(server.posts, 1);
    assert.equal(pending.status, 'failed'); assert.equal(pending.unconfirmed, true);
    assert.equal(pending.errorMessage, '저장됐는지 확인하지 못했어요. 다시 보내면 같은 메시지가 두 번 저장될 수 있어요.');
    assert.equal(pending.clientId, entry.clientId); // 재시도에도 같은 clientId(나중의 멱등 키)
    // 화면 버튼은 "그래도 다시 보내기"
    const panel = createScreenRuntime(serverEnv, 'src/components/rooms/chat-panel.tsx', runtime => {
        Object.assign(runtime.native, { ScrollView: 'ScrollView', Platform: { OS: 'ios', select: value => value.ios }, Keyboard: { dismiss() {}, addListener: () => ({ remove() {} }) } });
    });
    const panelView = panel.renderComponent({ type: panel.screen.default, props: { controller: r.render(), myUserId: ROOM_QUERY_ME, members: [] } });
    assert.ok(findElement(panelView, element => element.props?.label === '그래도 다시 보내기'));
    server.gets = 0;
    await r.retry(pending);
    assert.equal(server.posts, 2); assert.equal(server.gets, 0); // 확인 없이 보내요
    assert.equal(r.render().pending.length, 0);
    r.unmount();
});

test('139 기준점을 알 수 없으면(유실) 확인하지 않고 불명이에요', async () => {
    const hook = createRuntime(serverEnv).load('src/hooks/use-room-chat.ts'); let fetched = 0;
    const result = await hook.checkChatSend(async () => { fetched++; return { items: [], hasMore: false, nextCursor: null }; }, undefined, () => true, () => true);
    assert.equal(result.status, 'unknown'); assert.equal(fetched, 0);
    // 빈 방에서 처음까지 다 봤으면 확실히 저장 안 됨이에요.
    const empty = await hook.checkChatSend(async () => ({ items: [], hasMore: false, nextCursor: null }), new Set(), () => true, () => true);
    assert.equal(empty.status, 'notSaved');
});

test('139 WS 로 내 메시지가 늦게 도착: 오래된 전송부터 하나씩 확인, 이후 재시도에 중복 POST 없음', async () => {
    const { r, server } = await chat139Hook();
    const first = await r.sendText('늦게 온 메시지', 'saveLose'); const second = await r.sendText('늦게 온 메시지', 'saveLose');
    const [savedFirst] = server.mine('늦게 온 메시지');
    r.event(savedFirst); r.event(savedFirst); // 같은 WS 를 두 번 받아도 한 전송만 확인돼요
    assert.deepEqual(plain(r.render().pending.map(item => item.clientId)), [second.clientId]);
    server.addOthers(35); server.post = 'ok';
    await r.retry(second);
    assert.equal(server.posts, 2); assert.equal(r.render().pending.length, 0);
    assert.equal(new Set(plain(mineIn139(r.render(), '늦게 온 메시지')).map(message => message.id)).size, 2);
    assert.equal(first.content, '늦게 온 메시지');
    r.unmount();
});

test('139 확인 중 화면 이탈·권한 상실이면 결과를 버리고 POST 하지 않아요', async () => {
    for (const cause of ['blur', 'reject']) {
        const { r, server } = await chat139Hook();
        const entry = await r.sendText('확인 중 이탈', 'lose');
        server.addOthers(40); server.post = 'ok';
        let release; const gate = new Promise(resolve => { release = resolve; });
        const start = server.gets; server.hold = count => count === start + 2 ? gate : undefined;
        r.render().retrySend(r.render().pending[0]); await settle(); await settle();
        if (cause === 'blur') r.blur(); else r.reject('NOT_ROOM_MEMBER');
        release(); await drain137();
        assert.equal(server.posts, 1, cause);
        if (cause === 'reject') { assert.equal(r.render().blocked, true); assert.equal(r.render().pending.length, 0); }
        else assert.equal(r.render().pending[0].clientId, entry.clientId);
        r.unmount();
    }
});
