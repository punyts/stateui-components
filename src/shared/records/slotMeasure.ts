/** What a slot observer reports and where */
export interface SlotMeasureOptions {
    /**
     * Called with the entries of one `ResizeObserver` delivery that came from slots still in the document: the slot's index (its
     * `data-slot`) and its border-box height. A slot that is hidden reports 0
     */
    onMeasure: (measures: { slot: number; height: number }[]) => void;
}

/** The `ResizeObserver` of the slots of a record grid */
export interface SlotMeasure {
    /** Starts watching a slot element; the observer reports its size at the next frame */
    observe(element: HTMLElement): void;
    /** Asks for the size of a slot again, as the slot now shows another record: observing an element again reports it even when its size is unchanged */
    refresh(element: HTMLElement): void;
    /** Stops watching a slot element */
    unobserve(element: HTMLElement): void;
    /** Stops watching everything */
    dispose(): void;
}

/** Observes the slot elements of a record grid and reports their heights from the resize entries, so no layout is read */
export function createSlotMeasure(options: SlotMeasureOptions): SlotMeasure {
    const { onMeasure } = options;
    let disposed = false;
    const observer = new ResizeObserver((entries) => {
        if (disposed) return;
        const measures: { slot: number; height: number }[] = [];
        for (const entry of entries) {
            const target = entry.target;
            if (!(target instanceof HTMLElement)) continue;
            if (!target.isConnected) {
                observer.unobserve(target);
                continue;
            }
            const slot = Number(target.dataset['slot']);
            if (!Number.isInteger(slot)) continue;
            const box = entry.borderBoxSize[0];
            measures.push({ slot, height: box === undefined ? entry.contentRect.height : box.blockSize });
        }
        if (measures.length > 0) onMeasure(measures);
    });
    return {
        observe: (element) => observer.observe(element),
        refresh(element) {
            observer.unobserve(element);
            observer.observe(element);
        },
        unobserve: (element) => observer.unobserve(element),
        dispose() {
            if (disposed) return;
            disposed = true;
            observer.disconnect();
        }
    };
}
