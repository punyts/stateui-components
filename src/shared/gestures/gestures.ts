/**
 * Presses that content marked `data-own-gestures` leaves to a `viewport` around it: the content's own listener runs
 * first, sees that the press is not on anything it moves (a `board`'s empty column, or the room a row leaves under its
 * card), and leaves it, so the viewport pans.
 */
const leftToViewport = new WeakSet<Event>();

/** Leaves a press on marked content to the viewport around it */
export function leaveToViewport(event: Event): void {
    leftToViewport.add(event);
}

/** Whether marked content left this press to the viewport */
export function isLeftToViewport(event: Event): boolean {
    return leftToViewport.has(event);
}
