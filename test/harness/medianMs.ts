/**
 * The median wall time, in milliseconds, of `run` over `samples` runs after `warmups` runs that are not timed. The median
 * ignores the few runs a busy machine or a garbage collection slows down, which keeps a time budget test steady
 */
export function medianMs(run: () => void, samples = 9, warmups = 3): number {
    for (let at = 0; at < warmups; at++) run();
    const times: number[] = [];
    for (let at = 0; at < samples; at++) {
        const start = performance.now();
        run();
        times.push(performance.now() - start);
    }
    times.sort((left, right) => left - right);
    return times[Math.floor(times.length / 2)] as number;
}
