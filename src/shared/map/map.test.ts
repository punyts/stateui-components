import { clampMapZoom, coverTiles, isTileTemplate, normalizeCenter, panBy, placeInView, placeMarkers, project, tileUrl, unproject, wrapLng, zoomAround } from './map.js';

const TEMPLATE = '/paths/maps/city/{z}/{x}/{y}.png';

describe('map', () => {
    it('should take https and own-origin tile templates naming z, x and y and nothing else', () => {
        // Assert
        expect(isTileTemplate('https://tiles.example.com/{z}/{x}/{y}.png')).toBe(true);
        expect(isTileTemplate(TEMPLATE)).toBe(true);
        expect(isTileTemplate('/tiles/{z}/{x}.png')).toBe(false);
        expect(isTileTemplate('http://tiles.example.com/{z}/{x}/{y}.png')).toBe(false);
        expect(isTileTemplate('//tiles.example.com/{z}/{x}/{y}.png')).toBe(false);
        expect(isTileTemplate('javascript:{z}{x}{y}')).toBe(false);
        expect(isTileTemplate('https://user@tiles.example.com/{z}/{x}/{y}')).toBe(false);
        expect(isTileTemplate(7)).toBe(false);
        expect(tileUrl(TEMPLATE, 3, 4, 5)).toBe('/paths/maps/city/3/4/5.png');
    });

    it('should project and unproject a place at a zoom', () => {
        // Act
        const origin = project({ lat: 0, lng: 0 }, 0);
        const corner = project({ lat: 90, lng: -180 }, 1);
        const back = unproject(project({ lat: 51.5, lng: -0.12 }, 12), 12);

        // Assert
        expect(origin).toEqual({ x: 128, y: 128 });
        expect(corner.x).toBe(0);
        expect(corner.y).toBeCloseTo(0, 6);
        expect(back.lat).toBeCloseTo(51.5, 9);
        expect(back.lng).toBeCloseTo(-0.12, 9);
    });

    it('should wrap longitudes, clamp latitudes and zooms', () => {
        // Assert
        expect(wrapLng(190)).toBe(-170);
        expect(wrapLng(-540)).toBe(-180);
        expect(wrapLng(180)).toBe(180);
        expect(normalizeCenter(89, 'x')).toEqual({ lat: 85.0511287798, lng: 0 });
        expect(clampMapZoom(30)).toBe(22);
        expect(clampMapZoom(Number.NaN, 2, 10)).toBe(2);
        expect(clampMapZoom(1, 3, 2)).toBe(3);
    });

    it('should cover the view with the tiles of the nearest whole zoom, scaled and wrapped', () => {
        // Act
        const whole = coverTiles({ center: { lat: 0, lng: 0 }, zoom: 1, width: 512, height: 512 }, TEMPLATE);
        const scaled = coverTiles({ center: { lat: 0, lng: 0 }, zoom: 1.25, width: 100, height: 100 }, TEMPLATE);
        const wrapped = coverTiles({ center: { lat: 0, lng: 180 }, zoom: 1, width: 256, height: 256 }, TEMPLATE);

        // Assert
        expect(Object.keys(whole).sort()).toEqual(['t1_0_0', 't1_0_1', 't1_1_0', 't1_1_1']);
        expect(whole['t1_0_0']).toEqual({ src: '/paths/maps/city/1/0/0.png', left: 0, top: 0, size: 256 });
        expect(whole['t1_1_1']).toEqual({ src: '/paths/maps/city/1/1/1.png', left: 256, top: 256, size: 256 });
        expect(scaled['t1_0_0']?.size).toBeCloseTo(256 * 2 ** 0.25, 1);
        expect(Object.keys(wrapped).sort()).toEqual(['t1_1_0', 't1_1_1', 't1_2_0', 't1_2_1']);
        expect(wrapped['t1_2_0']?.src).toBe('/paths/maps/city/1/0/0.png');
        expect(coverTiles({ center: { lat: 0, lng: 0 }, zoom: 1, width: 512, height: 512 }, 'http://x/{z}/{x}/{y}')).toEqual({});
    });

    it('should place no more tiles than the limit, nearest the middle first', () => {
        // Act
        const tiles = coverTiles({ center: { lat: 0, lng: 0 }, zoom: 3, width: 1024, height: 1024 }, TEMPLATE, 4);

        // Assert
        expect(Object.keys(tiles).sort()).toEqual(['t3_3_3', 't3_3_4', 't3_4_3', 't3_4_4']);
    });

    it('should place a place in the view, taking the copy of the world nearest the middle', () => {
        // Act
        const middle = placeInView({ lat: 0, lng: 0 }, { center: { lat: 0, lng: 0 }, zoom: 2, width: 400, height: 300 });
        const across = placeInView({ lat: 0, lng: -170 }, { center: { lat: 0, lng: 170 }, zoom: 2, width: 400, height: 300 });

        // Assert
        expect(middle).toEqual({ left: 200, top: 150 });
        expect(across.left).toBeCloseTo(200 + (20 / 360) * 1024, 1);
    });

    it('should pan with the pointer and zoom around a point that keeps its place', () => {
        // Arrange
        const view = { center: { lat: 0, lng: 0 }, zoom: 2, width: 400, height: 300 };

        // Act
        const panned = panBy(view, 1024 / 4, 0);
        const zoomed = zoomAround(view, 3, { left: 300, top: 150 });
        const point = placeInView(unproject(project({ lat: 0, lng: 0 }, 2), 2), view);
        const anchorBefore = unproject({ x: project(view.center, 2).x + 100, y: project(view.center, 2).y }, 2);
        const anchorAfter = placeInView(anchorBefore, { ...view, center: zoomed, zoom: 3 });

        // Assert
        expect(panned.lng).toBeCloseTo(-90, 9);
        expect(panned.lat).toBeCloseTo(0, 9);
        expect(point).toEqual({ left: 200, top: 150 });
        expect(anchorAfter.left).toBeCloseTo(300, 1);
        expect(anchorAfter.top).toBeCloseTo(150, 1);
    });

    it('should place keyed and listed markers, leaving out those without a place or far outside', () => {
        // Arrange
        const view = { center: { lat: 0, lng: 0 }, zoom: 2, width: 400, height: 300 };

        // Act
        const keyed = placeMarkers({ depot: { lat: 0, lng: 0, _label: 'Depot' }, far: { lat: 60, lng: 120 }, broken: { lat: 'x', lng: 0 } }, view, 'depot');
        const listed = placeMarkers([{ id: 'shop', lat: 0, lng: 1, label: 'Shop' }, { id: '7', lat: 0, lng: 0 }], view, '');

        // Assert
        expect(keyed).toEqual({ depot: { label: 'Depot', left: 200, top: 150, selected: true } });
        expect(Object.keys(listed)).toEqual(['shop', 'm1']);
        expect(listed['shop']?.label).toBe('Shop');
        expect(listed['m1']?.label).toBe('m1');
    });
});
