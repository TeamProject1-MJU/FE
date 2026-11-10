// 실행: node scripts/verify-api-client.cjs
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
    });
    const native = {
        StyleSheet: { create: value => value },
        Platform: { OS: 'web', select: value => value.web },
        Keyboard: { dismiss() {} },
    };
    for (const name of ['FlatList', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'Text', 'TextInput', 'View']) native[name] = name;
    const external = {
        react,
        'react/jsx-runtime': require('react/jsx-runtime'),
        'react-native': native,
        'expo-router': { router: { canGoBack: () => false, replace() {}, push() {} }, useLocalSearchParams: () => ({}) },
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
            now = next[1].due;
            next[1].callback();
        }
        now = target;
    }
    return { load, context, timers, advance };
}

const serverEnv = { EXPO_PUBLIC_API_BASE_URL: ' https://example.test/api/v1/// ', EXPO_PUBLIC_USE_MOCK: 'false' };
const jsonResponse = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) });
const plain = value => JSON.parse(JSON.stringify(value));

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
function createScreenRuntime(env = {}) {
    let cursor = 0;
    const slots = [];
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
    const screen = runtime.load('src/app/station-search.tsx');
    return {
        ...runtime,
        screen,
        render() { cursor = 0; const view = screen.default(); effects.splice(0).forEach(effect => effect()); return view; },
        unmount() { slots.forEach(slot => slot?.cleanup?.()); },
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
