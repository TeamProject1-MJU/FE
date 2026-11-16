// Run: node --test scripts/verify-home-congestion.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.dirname(require.resolve('../package.json'));

// Small hook runtime with explicit focus, session, clock and network control.
function runtime() {
    const modules = new Map();
    const slots = [];
    let cursor = 0;
    let generation = 1;
    let now = Date.parse('2026-11-16T03:14:00Z');
    let focused = true;
    const effects = [];
    const focusEffects = new Set();
    const timers = new Map();
    let timerId = 0;
    let fetch = async () => { throw Error('Unexpected congestion request'); };
    const memo = (fn, deps) => {
        const index = cursor++;
        const old = slots[index];
        if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) slots[index] = { deps, value: fn() };
        return slots[index].value;
    };
    const react = {
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useMemo: memo,
        useCallback: (fn, deps) => memo(() => fn, deps),
        useEffect(fn, deps) {
            const index = cursor++;
            const old = slots[index];
            if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) effects.push(() => {
                old?.cleanup?.(); slots[index] = { deps, cleanup: fn() };
            });
        },
    };
    const external = {
        react, 'react/jsx-runtime': require('react/jsx-runtime'),
        'react-native': { StyleSheet: { create: x => x }, View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, Alert: { alert() {} }, Linking: { openSettings: async () => {} } },
        'expo-location': { Accuracy: { Balanced: 3 }, getForegroundPermissionsAsync: async () => ({ granted: false }), requestForegroundPermissionsAsync: async () => ({ granted: false }) },
        '@/services/station': { fetchStationsInBounds: async () => ({ items: [], totalElements: 0 }) },
        '@expo/vector-icons/Ionicons': 'Ionicons',
        '@/components/app-text': { Text: 'Text' },
        '@/components/train-block': { default: 'TrainBlock', __esModule: true },
        '@/components/congestion-blocks': { default: 'CongestionBlocks', __esModule: true },
        '@/services/auth': { getSessionGeneration: () => generation },
        '@/services/congestion': { fetchCongestion: query => fetch(query) },
        'expo-router': { useFocusEffect(fn) {
            react.useEffect(() => {
                const item = { fn, cleanup: focused ? fn() : null };
                focusEffects.add(item);
                return () => { item.cleanup?.(); focusEffects.delete(item); };
            }, [fn]);
        } },
    };
    const context = vm.createContext({ Date: class extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }, console, setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } });
    function load(relative) {
        if (modules.has(relative)) return modules.get(relative).exports;
        const file = ['', '.ts', '.tsx'].map(ext => path.resolve(root, relative + ext)).find(f => fs.existsSync(f));
        assert.ok(file, relative);
        const module = { exports: {} };
        modules.set(relative, module);
        const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
        } }).outputText;
        const run = new vm.Script(`(function(require,module,exports){${code}\n})`, { filename: file }).runInContext(context);
        run(id => {
            if (Object.hasOwn(external, id)) return external[id];
            assert.ok(id.startsWith('@/'), id);
            return load(`src/${id.slice(2)}`);
        }, module, module.exports);
        return module.exports;
    }
    return {
        load, external,
        advance(ms) { for (const [id, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(id); timer.fn(); } },
        render(fn, options) { cursor = 0; const result = fn(options); effects.splice(0).forEach(effect => effect()); return result; },
        fetch(fn) { fetch = fn; },
        session() { generation++; },
        time(iso) { now = Date.parse(iso); },
        blur() { focused = false; for (const effect of focusEffects) { effect.cleanup?.(); effect.cleanup = null; } },
        focus() { focused = true; for (const effect of focusEffects) effect.cleanup = effect.fn(); },
    };
}
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const line = { lineId: 22, lineName: '2호선', color: '#00A84D', stationCode: '201' };
const station = (id, latitude, extra = {}) => ({ id, latitude, longitude: 127, name: `역 ${id}`, isSupported: true, lines: [line], ...extra });
const response = (direction, level = 'RELAXED', supported = true) => ({
    stationId: 1, lineId: 22, direction, supported, level: supported ? level : null,
    levelLabel: supported ? '서버 라벨' : null, pct: supported ? 42 : null, source: supported ? 'ESTIMATED' : null,
    dayType: 'WEEKDAY', slotStart: '12:00', slotDate: '2026-11-16', firstTrain: false,
});
function hookFixture(extra = {}) {
    const r = runtime();
    const hook = r.load('src/hooks/use-home-congestion').useHomeCongestion;
    const options = { serverMode: true, account: '1:a', location: { latitude: 37.5, longitude: 127 }, locationLoading: false, stations: [station(1, 37.5)], ...extra };
    return { r, options, view: () => r.render(hook, options) };
}

test('230 nearest station: no location, unsupported excluded, nearest, empty and stable ties', () => {
    const pick = runtime().load('src/utils/home-congestion').nearestHomeStation;
    const location = { latitude: 37.5, longitude: 127 };
    const stations = [station(1, 37.7), station(2, 37.5, { isSupported: false }), station(3, 37.51)];
    assert.equal(pick(null, stations), null);
    assert.equal(pick(location, []), null);
    assert.equal(pick(location, [stations[1]]), null);
    assert.equal(pick(location, stations).id, 3);
    assert.equal(pick(location, [stations[2], { ...stations[2], id: 4 }]).id, 3);
});

test('230 direction candidates use line name, highest supported stage wins and ties keep first', () => {
    const utils = runtime().load('src/utils/home-congestion');
    assert.deepEqual(plain(utils.homeCongestionDirections('2호선')), ['INNER', 'OUTER']);
    assert.deepEqual(plain(utils.homeCongestionDirections('1호선')), ['UP', 'DOWN']);
    assert.deepEqual(plain(utils.homeCongestionDirections('7호선')), ['UP', 'DOWN']);
    const { LEVEL_ORDER, blockLevel } = runtime().load('src/utils/congestion-level');
    LEVEL_ORDER.forEach((level, index) => {
        assert.equal(blockLevel(response('UP', level)), index + 1);
        assert.equal(blockLevel(response('UP', level, false)), 0);
        if (index) assert.equal(utils.highestHomeCongestion([response('UP', LEVEL_ORDER[index - 1]), response('DOWN', level)]).direction, 'DOWN');
    });
    assert.equal(blockLevel(null), 0);
    assert.equal(utils.highestHomeCongestion([response('UP'), response('DOWN')]).direction, 'UP');
    assert.equal(utils.highestHomeCongestion([response('UP', 'VERY_CROWDED', false), response('DOWN')]).direction, 'DOWN');
    assert.equal(utils.highestHomeCongestion([response('UP', null, false)]), null);
});

test('230 Seoul date/time and 30-minute cache slots cross midnight independently of device timezone', () => {
    const time = runtime().load('src/utils/home-congestion').homeCongestionTime;
    for (const [iso, expected] of [
        ['2026-11-16T14:59:00Z', { date: '2026-11-16', time: '23:59', slot: '23:30' }],
        ['2026-11-16T15:00:00Z', { date: '2026-11-17', time: '00:00', slot: '00:00' }],
        ['2026-12-31T15:30:00Z', { date: '2027-01-01', time: '00:30', slot: '00:30' }],
    ]) assert.deepEqual(plain(time(new Date(iso))), expected);
});

test('230 mock query previews only in mock mode; server mode ignores the same query', async () => {
    const preview = runtime().load('src/utils/home-congestion').homeCongestionPreview;
    assert.equal(preview(true, 'congestion'), null);
    assert.equal(preview(false, undefined), null);
    assert.equal(preview(false, 'congestion').congestion.levelLabel, '여유');
    const location = { get latitude() { throw Error('Mock preview must not inspect coordinates'); }, longitude: 127 };
    const mock = hookFixture({ serverMode: false, mock: 'congestion', location });
    assert.equal(mock.view().kind, 'ready');
    assert.equal(mock.view().data.direction, 'INNER');
    const server = hookFixture({ mock: 'congestion', location: null });
    server.view(); assert.equal(server.view().kind, 'off');
    const off = hookFixture({ serverMode: false, location: null });
    assert.equal(off.view().kind, 'off');
});

test('230 parallel requests contain IDs/date/time only; same station/slot is cached across refocus', async () => {
    const { r, options, view } = hookFixture();
    const calls = []; const resolve = [];
    r.fetch(query => { calls.push(query); return new Promise(done => resolve.push(done)); });
    view(); assert.equal(view().kind, 'loading');
    assert.equal(calls.length, 2, 'both directions started before either resolves');
    assert.deepEqual(plain(calls), ['INNER', 'OUTER'].map(direction => ({ stationId: 1, lineId: 22, direction, date: '2026-11-16', time: '12:14' })));
    resolve[1](response('OUTER', 'CROWDED')); resolve[0](response('INNER')); await flush();
    assert.equal(view().data.direction, 'OUTER');
    assert.equal(view().data.congestion.kind, 'ESTIMATED');
    assert.equal(view().data.congestion.levelLabel, '서버 라벨');
    options.location = { latitude: 37.5001, longitude: 127 }; view();
    options.stations = [station(1, 37.5)]; view();
    assert.equal(calls.length, 2, 'same nearest station does not refetch on marker/location updates');
    r.blur(); r.focus(); await flush(); view(); assert.equal(calls.length, 2);
    r.time('2026-11-16T03:30:00Z'); r.blur(); r.focus();
    assert.equal(calls.length, 4, 'next slot refreshes on focus');
    r.blur();
});

test('230 denied/unreadable location is off, reading location is loading; no station/line is hidden', () => {
    for (const extra of [{ location: null }, { location: null, locationLoading: true }, { stations: [] }, { stations: [station(1, 37.5, { lines: [] })] }]) {
        const fixture = hookFixture(extra); fixture.view();
        assert.equal(fixture.view().kind, extra.locationLoading ? 'loading' : extra.location === null ? 'off' : 'hidden');
    }
});

test('230 unavailable directions or request failure hides the card without alerts', async () => {
    for (const failure of [false, true]) {
        const { r, view } = hookFixture();
        r.fetch(async query => { if (failure) throw Error('offline'); return response(query.direction, null, false); });
        view(); await flush(); assert.equal(view().kind, 'hidden');
    }
});

test('230 late responses after blur/session/station change never replace the current result', async () => {
    for (const mode of ['blur', 'session', 'station']) {
        const { r, options, view } = hookFixture(); const pending = [];
        r.fetch(query => new Promise(done => pending.push({ query, done })));
        view();
        if (mode === 'blur') r.blur();
        if (mode === 'session') r.session();
        if (mode === 'station') { options.stations = [station(2, 37.5)]; view(); }
        pending[0].done(response('INNER')); pending[1].done(response('OUTER')); await flush();
        assert.notEqual(view().kind, 'ready', mode);
        if (mode === 'session') assert.equal(view().kind, 'hidden');
        if (mode === 'station') {
            assert.equal(pending[2].query.stationId, 2);
            pending[2].done(response('INNER')); pending[3].done(response('OUTER')); await flush();
            assert.equal(view().data.station.id, 2);
        }
        r.blur();
    }
});

test('230 leaving while a request is pending discards it even after refocusing in the same slot', async () => {
    const { r, view } = hookFixture(); const pending = [];
    r.fetch(query => new Promise(done => pending.push({ query, done })));
    view(); r.blur(); r.focus();
    assert.equal(pending.length, 4);
    pending[0].done(response('INNER')); pending[1].done(response('OUTER')); await flush();
    assert.equal(view().kind, 'loading');
    pending[2].done(response('INNER')); pending[3].done(response('OUTER')); await flush();
    assert.equal(view().kind, 'ready');
    r.blur();
});

test('230 home map exposes full fetched stations without changing markers; denied location yields off card', async () => {
    const r = runtime();
    const useMap = r.load('src/hooks/use-home-map').useHomeMap;
    const useCongestion = r.load('src/hooks/use-home-congestion').useHomeCongestion;
    const items = [station(1, 37.5)];
    r.external['@/services/station'].fetchStationsInBounds = async () => ({ items, totalElements: 1 });
    let map;
    const Component = () => {
        map = useMap(true, '1:a');
        return useCongestion({ serverMode: true, account: '1:a', location: map.myLocation, locationLoading: map.locationLoading, stations: map.stations });
    };
    r.render(Component); await flush();
    assert.equal(r.render(Component).kind, 'off');
    assert.equal(map.myLocation, null); assert.equal(map.locationLoading, false);
    map.onRegionChange({ minLng: 126, minLat: 37, maxLng: 128, maxLat: 38 });
    r.advance(400); await flush(); r.render(Component);
    assert.equal(map.stations, items); assert.equal(map.markers, items);
    assert.equal(map.stations[0].lines[0].lineId, 22);
    r.blur();
});

function elements(node, predicate) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(child => elements(child, predicate));
    return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}
test('230 card geometry is identical for off/loading/ready, hidden removes space, only off button is interactive', () => {
    const r = runtime(); const Card = r.load('src/components/home-congestion-card').default;
    let presses = 0;
    const draw = state => Card({ state, onLocate: () => presses++ });
    const off = draw({ kind: 'off' });
    const loading = draw({ kind: 'loading' });
    const ready = draw({ kind: 'ready', data: r.load('src/utils/home-congestion').homeCongestionPreview(false, 'congestion') });
    assert.equal(off.props.style, loading.props.style); assert.equal(off.props.style, ready.props.style);
    assert.equal(off.props.style.height, 68); assert.equal(off.props.style.marginBottom, 16); assert.equal(off.props.style.paddingHorizontal, 14);
    assert.equal(draw({ kind: 'hidden' }), null);
    assert.equal(off.type, 'View'); assert.equal(off.props.onPress, undefined);
    const buttons = elements(off, el => el.type === 'Pressable'); assert.equal(buttons.length, 1);
    buttons[0].props.onPress(); assert.equal(presses, 1);
    assert.match(ready.props.accessibilityLabel, /지금 시청역 2호선 내선순환 혼잡도 여유, 추정 데이터/);
    assert.equal(elements(ready, el => el.type === 'TrainBlock')[0].props.color, '#00A84D');
    assert.equal(elements(ready, el => el.type === 'CongestionBlocks')[0].props.level, 2);
});
