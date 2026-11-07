// Usage (from stateui-components): node test/fixtures/gen-scheduler-fixture.mjs src/shared/drawing/scheduler.ts test/fixtures/scheduler.fixture.json
// then copy the JSON to ../stateui-3d/test/fixtures/scheduler.fixture.json. Node strips the TypeScript types itself. It gives the
// committed data (the committed file lays short arrays out on one line; the tests compare data, not layout).
// Generates the shared scheduler fixture from the component library's scheduler (run once; the output is committed in both repositories)
import { pathToFileURL } from 'node:url';
const [source, out] = process.argv.slice(2);
const m = await import(pathToFileURL(source).href);
import { writeFileSync } from 'node:fs';
const round = (v) => (typeof v === 'number' ? Number(v.toFixed(9)) + 0 : v.map(round));
const durations = ['200ms', '0.2s', '1.5s', ' 100ms ', '0ms', '0s', '0', '250', '60000ms', '-1ms', 'fast', '1min', '', 'ms'].map((text) => ({ text, ms: m.parseDuration(text) ?? null }));
const reduced = ['0ms', '0s', '0', '200ms', '0.01s', null].map((base) => ({ base, reduced: m.isReducedMotion(() => base ?? undefined) }));
const times = [0, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.99, 1];
const easingTexts = ['cubic-bezier(0.4, 0, 0.2, 1)', 'cubic-bezier(0, 0, 0.2, 1)', 'cubic-bezier(0.4, 0, 1, 1)', 'cubic-bezier(0.34, 1.56, 0.64, 1)', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
const easings = easingTexts.map((easing) => {
    const f = m.parseEasing(easing);
    return { easing, times, values: times.map((t) => round(f(t))) };
});
const refused = ['cubic-bezier(1.2, 0, 0.2, 1)', 'cubic-bezier(0.4, 0, 0.2)', 'steps(4)', 'bounce'];
function run(c) {
    let time = 0;
    let pending;
    const s = m.createScheduler({ now: () => time, requestFrame: (cb) => ((pending = cb), 1), cancelFrame: () => (pending = undefined), onFrame: () => undefined });
    const timing = { duration: m.parseDuration(c.duration), easing: m.parseEasing(c.easing) };
    s.tween('k', c.from, c.to, timing);
    const values = [];
    let to = c.to;
    for (const at of c.times) {
        time = at;
        const p = pending;
        pending = undefined;
        p?.();
        if (c.retarget && at === c.retarget.at) {
            s.tween('k', to, c.retarget.to, timing);
            to = c.retarget.to;
        }
        values.push(round(s.valueOf('k') ?? to));
    }
    return { ...c, values };
}
const tweens = [
    { easing: 'cubic-bezier(0.4, 0, 0.2, 1)', duration: '200ms', from: 0, to: 100, times: [0, 16, 50, 100, 150, 199, 200, 250] },
    { easing: 'cubic-bezier(0, 0, 0.2, 1)', duration: '0.4s', from: [0, 0, 0], to: [4, -2, 10], times: [0, 40, 100, 200, 300, 400] },
    { easing: 'cubic-bezier(0.4, 0, 1, 1)', duration: '100', from: [255, 0, 0], to: [0, 0, 255], times: [0, 25, 50, 75, 100] },
    { easing: 'linear', duration: '1s', from: 10, to: 90, times: [0, 250, 500, 750, 1000] },
    { easing: 'cubic-bezier(0.4, 0, 0.2, 1)', duration: '200ms', from: 0, to: 100, times: [0, 100, 150, 200, 300], retarget: { at: 100, to: 0 } },
    { easing: 'cubic-bezier(0.4, 0, 0.2, 1)', duration: '0ms', from: 0, to: 100, times: [0, 16] }
].map(run);
const fixture = {
    about: 'The shared fixture of the motion scheduler (G3.9 of the graphics epic 3). The same file is committed in @punyts/stateui-components and @punyts/stateui-3d (test/fixtures/scheduler.fixture.json in both); each asserts these outputs from its own scheduler.ts in test/scheduler.fixture.test.ts. Durations are CSS durations in ms; tween times are milliseconds after the tween started, and a value is the tween value then, or the end value once the tween has ended (a retarget at a time tweens from there to its value). Numbers are rounded to 9 decimals.',
    durations,
    reduced,
    easings,
    refusedEasings: refused,
    tweens
};
writeFileSync(out, JSON.stringify(fixture, null, 4) + '\n');
