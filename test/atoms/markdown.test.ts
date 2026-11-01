import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');

/** The ways of turning a string into markup; none may appear in what renders Markdown (the template parser of StateUI uses `DOMParser`, so the whole bundle is not checked) */
const FORBIDDEN = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'DOMParser'] as const;

async function filesOf(folder: string, keep: (name: string) => boolean): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && keep(entry.name)).map((entry) => join(folder, entry.name));
}

const isSource = (name: string): boolean => !name.endsWith('.test.ts') && !name.endsWith('.browser.test.ts');

async function offenders(files: readonly string[]): Promise<string[]> {
    const found: string[] = [];
    for (const file of files) {
        const text = await readFile(file, 'utf8');
        for (const word of FORBIDDEN) if (text.includes(word)) found.push(`${file}: ${word}`);
    }
    return found;
}

describe('the markdown sources and build', () => {
    it('should have no innerHTML, outerHTML, insertAdjacentHTML or DOMParser in src/shared/markdown/ or components/atoms/markdown/', async () => {
        // Arrange
        const files = [...(await filesOf(resolve(root, 'src/shared/markdown'), isSource)), ...(await filesOf(resolve(root, 'components/atoms/markdown'), () => true))];

        // Act
        const found = await offenders(files);

        // Assert
        expect(files.length).toBeGreaterThanOrEqual(12);
        expect(found).toEqual([]);
    });

    it('should have none of them in the markdown chunk of the build', async () => {
        // Arrange
        const built = resolve(root, '.test-build/real');
        const files = [
            ...(await filesOf(join(built, 'components'), (name) => name.startsWith('markdown.') && name.endsWith('.js'))),
            ...(await filesOf(join(built, 'shared/markdown'), (name) => name.endsWith('.js')))
        ];

        // Act
        const found = await offenders(files);

        // Assert
        expect(files.map((file) => file.slice(built.length + 1).replaceAll('\\', '/')).sort()).toEqual(
            expect.arrayContaining(['components/markdown.controller.js', 'components/markdown.js', 'shared/markdown/blocks.js', 'shared/markdown/inlines.js', 'shared/markdown/markdown.js', 'shared/markdown/render.js'])
        );
        expect(found).toEqual([]);
    });

    it('should not set an href or a navigation in the renderer', async () => {
        // Arrange
        const text = await readFile(resolve(root, 'src/shared/markdown/render.ts'), 'utf8');

        // Assert
        expect(text).not.toMatch(/createElement\(\s*'a'/);
        expect(text).not.toMatch(/setAttribute\(\s*'href'/);
        expect(text).not.toContain('location');
    });
});
