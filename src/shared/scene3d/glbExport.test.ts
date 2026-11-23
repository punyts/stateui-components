import type { JsonValue } from '@punyts/stateui-app/core';
import { exportFileName, GLB_FILE_TYPE, requestToken, SceneExport } from './glbExport.js';
import type { ExportedScene, SceneExportHost } from './glbExport.js';

/** A host over plain values; `hand` answers with a reference to the file it got, or with `answer` */
function makeHost(values: { request?: JsonValue; exported?: JsonValue; title?: JsonValue; answer?: () => Promise<unknown>; bytes?: number }) {
    const handed: File[] = [];
    const written: JsonValue[] = [];
    const raised: unknown[] = [];
    let exports = 0;
    const scene: ExportedScene = {
        drawn: () => Promise.resolve(),
        exportGlb: () => {
            exports += 1;
            return new ArrayBuffer(values.bytes ?? 16);
        }
    };
    const host: SceneExportHost = {
        request: () => values.request,
        exported: () => values.exported,
        title: () => values.title,
        scene: () => scene,
        hand: (file) => {
            handed.push(file);
            return values.answer?.() ?? Promise.resolve({ id: 'file-1', name: file.name, size: file.size, type: file.type });
        },
        write: (value) => {
            written.push(value);
            values.exported = value;
        },
        raise: (file) => raised.push(file)
    };
    return { host, handed, written, raised, values, exportCount: () => exports };
}

/** Waits for the export's task and promises to settle */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('glbExport', () => {
    describe('exportFileName', () => {
        it('should name the file after the title, made safe', () => {
            // Arrange
            const title = 'Room: plan/2 ';

            // Act
            const name = exportFileName(title);

            // Assert
            expect(name).toBe('Room  plan 2.glb');
        });

        it('should name a scene without a title scene.glb', () => {
            // Arrange, Act, Assert
            expect(exportFileName(undefined)).toBe('scene.glb');
            expect(exportFileName('  ')).toBe('scene.glb');
        });
    });

    describe('requestToken', () => {
        it('should give no token to a request that is not set', () => {
            // Arrange, Act, Assert
            expect(requestToken(undefined)).toBeUndefined();
            expect(requestToken(null)).toBeUndefined();
            expect(requestToken('')).toBeUndefined();
            expect(requestToken(0)).toBe('0');
        });
    });

    describe('SceneExport', () => {
        it('should export a new request, write exported and raise the event', async () => {
            // Arrange
            const { host, handed, written, raised } = makeHost({ request: 1, title: 'Board' });
            const exporter = new SceneExport(host);

            // Act
            exporter.sync();
            await settle();

            // Assert
            expect(handed).toHaveLength(1);
            expect(handed[0]?.name).toBe('Board.glb');
            expect(handed[0]?.type).toBe(GLB_FILE_TYPE);
            const file = { id: 'file-1', name: 'Board.glb', size: 16, type: GLB_FILE_TYPE };
            expect(written).toEqual([{ request: 1, file }]);
            expect(raised).toEqual([file]);
        });

        it('should not export a request that is not set or already exported', async () => {
            // Arrange
            const { host, handed } = makeHost({ request: { turn: 2 }, exported: { request: { turn: 2 }, file: {} } });
            const exporter = new SceneExport(host);
            const empty = makeHost({ request: '' });

            // Act
            exporter.sync();
            new SceneExport(empty.host).sync();
            await settle();

            // Assert
            expect(handed).toHaveLength(0);
            expect(empty.handed).toHaveLength(0);
        });

        it('should export once while the same request syncs again', async () => {
            // Arrange
            const { host, exportCount, written } = makeHost({ request: 'a' });
            const exporter = new SceneExport(host);

            // Act
            exporter.sync();
            exporter.sync();
            await settle();
            exporter.sync();
            await settle();

            // Assert
            expect(exportCount()).toBe(1);
            expect(written).toHaveLength(1);
        });

        it('should write the transfer code of a failed save and not retry it', async () => {
            // Arrange
            const { host, written, raised, exportCount } = makeHost({ request: 3, answer: () => Promise.reject({ code: 'offline' }) });
            const exporter = new SceneExport(host);

            // Act
            exporter.sync();
            await settle();
            exporter.sync();
            await settle();

            // Assert
            expect(written).toEqual([{ request: 3, error: 'offline' }]);
            expect(raised).toHaveLength(0);
            expect(exportCount()).toBe(1);
        });

        it('should refuse a file over 10 MiB as too_large without handing it', async () => {
            // Arrange
            const { host, handed, written } = makeHost({ request: 1, bytes: 10 * 1024 * 1024 + 1 });

            // Act
            new SceneExport(host).sync();
            await settle();

            // Assert
            expect(handed).toHaveLength(0);
            expect(written).toEqual([{ request: 1, error: 'too_large' }]);
        });

        it('should stop an export when the request changes and export the new one', async () => {
            // Arrange
            let answer: (value: unknown) => void = () => undefined;
            const values: { request?: JsonValue } = { request: 1 };
            const made = makeHost(Object.assign(values, { answer: () => new Promise((resolve) => (answer = resolve)) }));
            const exporter = new SceneExport(made.host);
            exporter.sync();
            await settle();

            // Act
            made.values.request = 2;
            exporter.sync();
            answer({ id: 'old', name: 'scene.glb', size: 16, type: GLB_FILE_TYPE });
            await settle();
            answer({ id: 'new', name: 'scene.glb', size: 16, type: GLB_FILE_TYPE });
            await settle();

            // Assert
            expect(made.handed).toHaveLength(2);
            expect(made.handed[0]?.size).toBe(16);
            expect(made.written).toEqual([{ request: 2, file: { id: 'new', name: 'scene.glb', size: 16, type: GLB_FILE_TYPE } }]);
        });

        it('should write nothing after dispose', async () => {
            // Arrange
            const { host, written } = makeHost({ request: 1 });
            const exporter = new SceneExport(host);

            // Act
            exporter.sync();
            exporter.dispose();
            await settle();

            // Assert
            expect(written).toHaveLength(0);
        });
    });
});
