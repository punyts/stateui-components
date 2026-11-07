import { it } from 'vitest';
it('style', () => {
    for (let k = 0; k < 3; k++) {
        const host = document.createElement('div'); host.style.position = 'relative'; document.body.append(host);
        const t = document.createElement('button'); t.style.position = 'absolute'; t.style.opacity = '0'; t.style.pointerEvents = 'none';
        const els = Array.from({ length: 50000 }, () => { const e = t.cloneNode() as HTMLButtonElement; host.append(e); return e; });
        let a = performance.now();
        els.forEach((e, i) => { const s = e.style; s.left = `${i % 900}px`; s.top = `${i % 300}px`; s.width = '6px'; s.height = '6px'; });
        let b = performance.now();
        void host.offsetHeight; const c = performance.now();
        host.remove();
        const host2 = document.createElement('div'); host2.style.position = 'relative'; document.body.append(host2);
        const els2 = Array.from({ length: 50000 }, () => { const e = t.cloneNode() as HTMLButtonElement; host2.append(e); return e; });
        const d = performance.now();
        els2.forEach((e, i) => { e.style.cssText = `position:absolute;opacity:0;pointer-events:none;left:${i % 900}px;top:${i % 300}px;width:6px;height:6px`; });
        const f = performance.now();
        void host2.offsetHeight; const g = performance.now();
        host2.remove();
        console.log(`four ${(b - a) | 0} layout ${(c - b) | 0} | cssText ${(f - d) | 0} layout ${(g - f) | 0}`);
    }
});
