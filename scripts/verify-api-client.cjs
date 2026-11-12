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
        AbortController,
        console,
        fetch: async () => { throw new Error('검사에서 지정하지 않은 요청입니다.'); },
        setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms, due: now + ms }); return id; },
        clearTimeout: id => timers.delete(id),
        // 도착정보 폴링 검사용 반복 타이머예요. 같은 가상 시계(advance)로 움직여요.
        setInterval: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms, due: now + ms, repeat: true }); return id; },
        clearInterval: id => timers.delete(id),
    });
    const native = {
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
    };

    function load(relative) {
        const base = path.resolve(root, relative);
        const filename = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        assert.ok(filename, `검사할 파일을 찾지 못했어요: ${relative}`);
        if (cache.has(filename)) return cache.get(filename).exports;
        const module = { exports: {} };
        cache.set(filename, module);
        const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
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

async function myScreenRuntime() {
    const r = createScreenRuntime(serverEnv, 'src/app/my.tsx');
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
    assert.deepEqual(result.routes[0].summary, data.routes[0].summary);
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
    for (const message of ['2분 50초 후', '전역 출발', '[2]번째 전역', '성수행 전역 도착', '', null]) {
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
    assert.equal(formatNextTrain(train(null, '[2]번째 전역'), 0), '성수행 · [2]번째 전역');
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
    assert.equal(r.text(), '다음 열차 · 성수행 · [2]번째 전역 · 성수행 3분 20초');
    r.advance(1000);
    assert.equal(r.text(), '다음 열차 · 성수행 · [2]번째 전역 · 성수행 3분 19초');
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

test('서버 방에서 채팅은 서버 UUID와 캐시를 사용하고 메시지 API는 부르지 않아요(후보는 #101 부터 서버)', async () => {
    const r = roomQueryRuntime();
    r.respond(async url => jsonResponse({ success: true, data: url.includes('/stations/')
            ? { ...roomQueryStation(), latitude: 37.5, longitude: 127, lines: [{ ...roomQueryStation().lines[0], stationCode: 'S1' }] }
            : roomQueryDetail() }));
    await r.room.fetchRoomDetail(ROOM_QUERY_ID);
    const chat = r.load('src/services/chat.ts');
    const sent = await finishRoomMock(r, chat.sendChatMessage(ROOM_QUERY_ID, { content: '서버 방의 임시 대화', clientMessageId: 'test-client' }));
    assert.equal(sent.message.senderId, ROOM_QUERY_ME); assert.equal(sent.message.nickname, '서버 나');
    const listed = await finishRoomMock(r, chat.fetchChatMessages(ROOM_QUERY_ID));
    assert.ok(listed.items.some(message => message.content === '서버 방의 임시 대화'));
    assert.equal(r.calls.filter(call => call.url.endsWith(`/${ROOM_QUERY_ID}`)).length, 1);
    assert.ok(r.calls.every(call => call.options.method === 'GET'));
    assert.ok(!r.calls.some(call => /messages|station-proposals|recommendations/.test(call.url)));
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
    await finishRoomMock(r, chat.sendChatMessage(ROOM_QUERY_ID, { content: '이전 계정 임시 메시지', clientMessageId: 'old-client' }));
    await r.load('src/services/auth.ts').clearLocalSession();
    me = '33333333-3333-4333-8333-333333333333';
    r.load('src/stores/auth-store.ts').signIn({ userId: me, nickname: '다음 사용자' });
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
