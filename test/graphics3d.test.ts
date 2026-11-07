import { describe, expect, it } from 'vitest';
import { themeTokenLookup, libraryFromCatalog, validateDocument } from '@punyts/stateui-app/core';
import { formatError } from '@punyts/stateui-app/build';
import type { Catalog, RootCatalogEntry, ShapeCatalogEntry } from '@punyts/stateui-app/build';
import catalogJson from '../.test-build/real/components/catalog.json';
import { NODE3D_KINDS, NODE3D_PROPERTIES } from '../src/shared/scene3d/tree.js';

const catalog = catalogJson as unknown as Catalog;
const hasToken = themeTokenLookup(libraryFromCatalog(catalog));

/** The 3D nodes of release 3A (G3.4 of the graphics epic 3) and the group folders they sit in; `repeat3d` and `label3d` come with their renderers (G3.6, G3.6b) */
const NODES = {
    camera: 'atom',
    light: 'atom',
    mesh: 'atom',
    model: 'atom',
    group3d: 'molecule'
} as const;

/** The properties every 3D node has: the partials `transform3d`, `interaction3d` and `motion3d` */
const COMMON = ['position', 'rotation', 'scale', 'visible', 'interactive', '_label', 'transition', 'animate'];

const GLB = { id: '0b5e3c1a-4d2f-4e8a-9c7b-1f2e3d4c5b6a', name: 'chair.glb', size: 18_000, type: 'model/gltf-binary' };
const PNG = { id: '7c6d5e4f-3a2b-4c1d-8e9f-0a1b2c3d4e5f', name: 'wood.png', size: 2_000, type: 'image/png' };

/** One node of each kind, with the properties that make it draw something */
const ONE_OF_EACH: Record<string, Record<string, unknown>> = {
    eye: { component: 'camera', kind: 'perspective', position: [0, 2, 6], target: [0, 0, 0], fov: 45, active: true },
    sun: { component: 'light', kind: 'directional', color: '{color.surface.raised}', intensity: 2.5, position: [5, 10, 5], shadows: true },
    fill: { component: 'light', kind: 'ambient', color: '#ffffff', intensity: 0.4 },
    box: {
        component: 'mesh',
        geometry: { kind: 'box', width: 1, height: 1, depth: 1 },
        material: { color: '{color.accent.base}', metalness: 0.2, roughness: 0.6, opacity: 1, emissive: '#000000', map: PNG },
        castShadow: true,
        rotation: [0, 45, 0],
        interactive: true,
        _label: 'Box',
        transition: { duration: 300, easing: 'standard' }
    },
    chair: { component: 'model', src: GLB, animation: 'Idle', playing: true, scale: [2, 2, 2] },
    rig: {
        component: 'group3d',
        position: [1, 0, 0],
        children: {
            ball: { component: 'mesh', geometry: { kind: 'sphere', radius: 0.5, segments: 32 }, animate: { name: 'bob', duration: 2000, loop: true } },
            ring: { component: 'mesh', geometry: { kind: 'torus', radius: 1, tube: 0.1 }, animate: { name: 'spin' } },
            nested: { component: 'group3d', children: { cap: { component: 'mesh', geometry: { kind: 'capsule', radius: 0.2, height: 1 }, animate: { name: 'pulse' } } } }
        }
    }
};

function sceneDocument(children: Record<string, unknown>, own: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        locale: 'en',
        app: { component: 'scene3d', _title: 'Chair', background: '{scene3d.background}', environment: 'studio', fog: { color: '#cccccc', near: 5, far: 30 }, controls: 'orbit', ...own, children }
    };
}

const validate = (document: Record<string, unknown>) => validateDocument(document, catalog, { hasToken });
const codesAt = (document: Record<string, unknown>): string[][] => validate(document).errors.map((error) => [error.code, error.statePath ?? '']);

describe('scene3d and the 3D nodes in the catalog', () => {
    it('should hold scene3d as a root composite with its properties, tokens and German title', () => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === 'scene3d') as RootCatalogEntry;

        // Assert
        expect(entry.tier).toBe('root');
        expect(entry.tag).toBe('ui-scene3d');
        expect(entry.size).toBe('composite');
        expect(entry.category).toBe('graphics');
        expect(entry.purposes?.length).toBeGreaterThanOrEqual(3);
        expect(entry.own).toEqual(['background', 'environment', 'fog', 'controls', '_title', '_description', '_fallback']);
        expect(entry.shape.properties.environment?.values).toEqual(['none', 'studio', 'daylight', 'neutral']);
        expect(entry.shape.properties.controls?.values).toEqual(['none', 'orbit', 'pan']);
        expect(entry.shape.properties.controls?.default).toBe('none');
        expect(Object.keys(entry.shape.properties.fog?.validators.fields ?? {})).toEqual(['color', 'near', 'far']);
        expect(entry.shape.childComponents).toEqual(Object.keys(NODES));
        expect((entry.tokens ?? []).map((token) => token.path)).toEqual(['scene3d.background', 'scene3d.ambient', 'scene3d.height']);
        expect(entry.locales).toEqual(['de']);
    });

    it.each(Object.entries(NODES))('should hold %s as a shape of size %s with the shared 3D properties and the events press and hover', (name, size) => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === name) as ShapeCatalogEntry;

        // Assert
        expect(entry.tier).toBe('shape');
        expect(entry.size).toBe(size);
        expect(entry.category).toBe('graphics');
        expect(entry.purposes?.length).toBeGreaterThanOrEqual(3);
        expect(entry.events).toEqual(['press', 'hover']);
        expect(Object.keys(entry.shape.properties)).toEqual(expect.arrayContaining(COMMON));
        expect(entry.shape.properties.position?.validators).toEqual({ vector: 3 });
        expect(entry.shape.properties.animate?.validators.fields?.name?.values).toEqual(['spin', 'bob', 'pulse']);
    });

    it('should give each node its own properties, with the vector, range, fields and fileRef validators', () => {
        // Arrange
        const shape = (name: string) => (catalog.components.find((candidate) => candidate.name === name) as ShapeCatalogEntry).shape;

        // Assert
        expect(shape('camera').properties.fov?.validators).toEqual({ range: { min: 1, max: 179 } });
        expect(shape('camera').properties.target?.validators).toEqual({ vector: 3 });
        expect(shape('light').properties.intensity?.validators).toEqual({ range: { min: 0, max: 100 } });
        expect(shape('light').properties.kind?.values).toEqual(['ambient', 'directional', 'point', 'spot']);
        expect(shape('mesh').properties.geometry?.validators.fields?.kind?.values).toEqual(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'capsule']);
        expect(Object.keys(shape('mesh').properties.material?.validators.fields ?? {})).toEqual(['color', 'metalness', 'roughness', 'opacity', 'emissive', 'map']);
        expect(shape('mesh').properties.material?.validators.fields?.map?.validators?.fileRef).toEqual({ types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] });
        expect(shape('model').properties.src?.validators).toEqual({ fileRef: { types: ['model/gltf-binary'] } });
        expect(Object.keys(shape('model').properties)).toEqual(expect.arrayContaining(['src', 'animation', 'playing']));
        expect(shape('group3d').childComponents).toEqual(Object.keys(NODES));
    });

    it('should not yet list repeat3d and label3d, whose renderers come later', () => {
        // Assert
        expect(catalog.components.map((entry) => entry.name)).not.toContain('repeat3d');
        expect(catalog.components.map((entry) => entry.name)).not.toContain('label3d');
    });

    it('should read the nodes the catalog has, and no other (G3.5)', () => {
        // Assert
        expect([...NODE3D_KINDS].sort()).toEqual(Object.keys(NODES).sort());
    });

    it.each(Object.keys(NODES))('should list the properties of %s in NODE3D_PROPERTIES, which the scene reads linked values by (G3.5)', (name) => {
        // Arrange
        const entry = catalog.components.find((candidate) => candidate.name === name) as ShapeCatalogEntry;
        const declared = Object.entries(entry.shape.properties)
            .filter(([, property]) => property.type !== 'node')
            .map(([key]) => key);

        // Assert
        expect([...NODE3D_PROPERTIES[name as keyof typeof NODES]].sort()).toEqual(declared.sort());
    });
});

describe('a 3D scene document', () => {
    it('should validate with one of each node, tokens, file references and nested groups', () => {
        // Act
        const result = validate(sceneDocument(ONE_OF_EACH));

        // Assert
        expect(result.errors.map(formatError)).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('should refuse a position, rotation, scale and target that are not three numbers', () => {
        // Act
        const found = codesAt(
            sceneDocument({
                a: { component: 'mesh', position: [0, 0] },
                b: { component: 'mesh', rotation: [0, 0, 0, 0] },
                c: { component: 'mesh', scale: [1, 'x', 1] },
                d: { component: 'camera', target: [0, 0] }
            })
        );

        // Assert
        expect(found).toEqual([
            ['SUI-STATE-INVALID', '$.app.children.a.position'],
            ['SUI-STATE-INVALID', '$.app.children.b.rotation'],
            ['SUI-STATE-INVALID', '$.app.children.c.scale'],
            ['SUI-STATE-INVALID', '$.app.children.d.target']
        ]);
    });

    it('should refuse an fov or intensity out of range and a material value out of 0..1', () => {
        // Act
        const found = codesAt(
            sceneDocument({
                wide: { component: 'camera', fov: 180 },
                narrow: { component: 'camera', fov: 0 },
                blinding: { component: 'light', intensity: 101 },
                shiny: { component: 'mesh', material: { metalness: 1.5 } },
                ghost: { component: 'mesh', material: { opacity: -0.1 } }
            })
        );

        // Assert
        expect(found).toEqual([
            ['SUI-STATE-INVALID', '$.app.children.wide.fov'],
            ['SUI-STATE-INVALID', '$.app.children.narrow.fov'],
            ['SUI-STATE-INVALID', '$.app.children.blinding.intensity'],
            ['SUI-STATE-INVALID', '$.app.children.shiny.material'],
            ['SUI-STATE-INVALID', '$.app.children.ghost.material']
        ]);
    });

    it('should refuse an unknown geometry, a material colour that is not one, a fog field it does not know and a 2D animate name', () => {
        // Act
        const found = codesAt(
            sceneDocument(
                {
                    blob: { component: 'mesh', geometry: { kind: 'blob' } },
                    sizeless: { component: 'mesh', geometry: { width: 1 } },
                    muddy: { component: 'mesh', material: { color: 'rgb(1, 2' } },
                    fader: { component: 'mesh', animate: { name: 'fade' } }
                },
                { fog: { color: '#cccccc', density: 0.1 } }
            )
        );

        // Assert
        expect(found).toEqual([
            ['SUI-STATE-INVALID', '$.app.fog'],
            ['SUI-STATE-INVALID', '$.app.children.blob.geometry'],
            ['SUI-STATE-INVALID', '$.app.children.sizeless.geometry'],
            ['SUI-STATE-INVALID', '$.app.children.muddy.material'],
            ['SUI-STATE-INVALID', '$.app.children.fader.animate']
        ]);
    });

    it('should take a GLB file for model.src and an image file for material.map, and refuse the other way round', () => {
        // Act
        const found = codesAt(
            sceneDocument({
                picture: { component: 'model', src: PNG },
                url: { component: 'model', src: 'chair.glb' },
                wrapped: { component: 'mesh', material: { map: GLB } },
                inline: { component: 'mesh', material: { map: 'data:image/png;base64,iVBORw0KGgo=' } }
            })
        );

        // Assert
        expect(found).toEqual([
            ['SUI-STATE-INVALID', '$.app.children.picture.src'],
            ['SUI-STATE-INVALID', '$.app.children.url.src'],
            ['SUI-STATE-INVALID', '$.app.children.wrapped.material'],
            ['SUI-STATE-INVALID', '$.app.children.inline.material']
        ]);
    });

    it('should refuse an environment and controls it does not know', () => {
        // Act
        const found = codesAt(sceneDocument({}, { environment: 'sunset', controls: 'fly' }));

        // Assert
        expect(found).toEqual([
            ['SUI-STATE-INVALID', '$.app.environment'],
            ['SUI-STATE-INVALID', '$.app.controls']
        ]);
    });

    it('should refuse a 2D shape and another component inside a scene, and in a group3d', () => {
        // Act
        const found = codesAt(
            sceneDocument({
                box: { component: 'rect', width: 1, height: 1 },
                words: { component: 'text', _text: 'Hi' },
                rig: { component: 'group3d', children: { dot: { component: 'circle', r: 1 } } }
            })
        );

        // Assert
        expect(found).toEqual([
            ['SUI-NODE-CHILD', '$.app.children.box'],
            ['SUI-NODE-CHILD', '$.app.children.words'],
            ['SUI-NODE-CHILD', '$.app.children.rig.children.dot']
        ]);
    });

    it('should refuse group3d and the other 3D nodes outside a scene, under a panel and inside a drawing', () => {
        // Act
        const outside = codesAt({ locale: 'en', app: { component: 'panel', children: ONE_OF_EACH } });
        const inDrawing = codesAt({
            locale: 'en',
            app: { component: 'drawing', children: { box: { component: 'mesh' }, rig: { component: 'group3d' } } }
        });

        // Assert
        expect(outside).toEqual(Object.keys(ONE_OF_EACH).map((key) => ['SUI-NODE-CHILD', `$.app.children.${key}`]));
        expect(inDrawing).toEqual([
            ['SUI-NODE-CHILD', '$.app.children.box'],
            ['SUI-NODE-CHILD', '$.app.children.rig']
        ]);
    });

    it('should warn for an interactive 3D node without a _label', () => {
        // Act
        const result = validate(sceneDocument({ hotspot: { component: 'mesh', interactive: true } }));

        // Assert
        expect(result.valid).toBe(true);
        expect(result.errors.map((error) => [error.code, error.severity, error.statePath])).toEqual([['SUI-STATE-LABEL', 'warning', '$.app.children.hotspot']]);
    });

    it('should warn past 16 scenes on one page, and say nothing for 16', () => {
        // Arrange
        const scenes = (count: number): Record<string, unknown> =>
            Object.fromEntries(Array.from({ length: count }, (_, index) => [`s${index}`, { component: 'scene3d', children: { box: { component: 'mesh' } } }]));

        // Act
        const sixteen = validate({ locale: 'en', app: { component: 'panel', children: scenes(16) } });
        const seventeen = validate({ locale: 'en', app: { component: 'panel', children: scenes(17) } });

        // Assert
        expect(sixteen.errors.map(formatError)).toEqual([]);
        expect(seventeen.valid).toBe(true);
        expect(seventeen.errors.map((error) => [error.code, error.severity, error.statePath])).toEqual([['SUI-DOC-LIMIT-SCENES', 'warning', '$.app']]);
        expect(seventeen.errors[0]?.message).toContain('17 scene3d nodes');
    });
});
