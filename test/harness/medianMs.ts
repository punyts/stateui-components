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

/**
 * The median wall time, in milliseconds, of an asynchronous `run` (a first draw that ends in a later frame) over
 * `samples` runs after `warmups` runs that are not timed. `prepare` runs before each run and is not timed
 */
export async function medianMsAsync(run: () => Promise<void>, samples = 5, warmups = 1, prepare: () => Promise<void> | void = () => undefined): Promise<number> {
    for (let at = 0; at < warmups; at++) {
        await prepare();
        await run();
    }
    const times: number[] = [];
    for (let at = 0; at < samples; at++) {
        await prepare();
        const start = performance.now();
        await run();
        times.push(performance.now() - start);
    }
    times.sort((left, right) => left - right);
    return times[Math.floor(times.length / 2)] as number;
}
