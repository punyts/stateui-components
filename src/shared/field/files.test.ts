import { describe, expect, it } from 'vitest';
import {
    ALLOWED_FILE_TYPES,
    MAX_FILE_SIZE,
    acceptAttribute,
    effectiveAccept,
    effectiveMaxFiles,
    effectiveMaxSize,
    formatBytes,
    isFileRef,
    mediaTypeOf,
    percentOf,
    transferCode,
    typeFromName
} from './files.js';

describe('file field helpers', () => {
    it('should list exactly the ADR-0017 types and a 10 MiB limit', () => {
        // Assert
        expect(ALLOWED_FILE_TYPES).toEqual([
            'image/png',
            'image/jpeg',
            'image/gif',
            'image/webp',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain',
            'text/csv',
            'text/markdown',
            'application/json'
        ]);
        expect(ALLOWED_FILE_TYPES).not.toContain('text/html');
        expect(ALLOWED_FILE_TYPES).not.toContain('image/svg+xml');
        expect(MAX_FILE_SIZE).toBe(10485760);
    });

    it('should narrow accept to the allowed list and never widen it', () => {
        // Assert
        expect(effectiveAccept([])).toEqual(ALLOWED_FILE_TYPES);
        expect(effectiveAccept(undefined)).toEqual(ALLOWED_FILE_TYPES);
        expect(effectiveAccept(['image/png', 'application/pdf'])).toEqual(['image/png', 'application/pdf']);
        expect(effectiveAccept(['image/png', 'text/html', 'image/svg+xml'])).toEqual(['image/png']);
        expect(effectiveAccept(['text/html'])).toEqual([]);
        expect(effectiveAccept(['IMAGE/PNG; charset=x'])).toEqual(['image/png']);
    });

    it('should clamp maxSize to 10 MiB and read maxFiles as a positive integer', () => {
        // Assert
        expect(effectiveMaxSize(undefined)).toBe(MAX_FILE_SIZE);
        expect(effectiveMaxSize(500)).toBe(500);
        expect(effectiveMaxSize(MAX_FILE_SIZE + 1)).toBe(MAX_FILE_SIZE);
        expect(effectiveMaxSize(0)).toBe(MAX_FILE_SIZE);
        expect(effectiveMaxFiles(undefined)).toBe(1);
        expect(effectiveMaxFiles(3)).toBe(3);
        expect(effectiveMaxFiles(0)).toBe(1);
        expect(effectiveMaxFiles(1.5)).toBe(1);
    });

    it('should take the type from the browser, else from the extension', () => {
        // Assert
        expect(mediaTypeOf({ name: 'a.png', type: 'image/png' })).toBe('image/png');
        expect(mediaTypeOf({ name: 'notes.MD', type: '' })).toBe('text/markdown');
        expect(mediaTypeOf({ name: 'data.csv', type: 'text/csv; charset=utf-8' })).toBe('text/csv');
        expect(mediaTypeOf({ name: 'run.exe', type: '' })).toBe('');
        expect(typeFromName('noextension')).toBe('');
    });

    it('should build the picker accept hint with types and extensions', () => {
        // Assert
        expect(acceptAttribute(['image/jpeg', 'text/markdown'])).toBe('image/jpeg,.jpg,.jpeg,text/markdown,.md,.markdown');
    });

    it('should recognise a reference and reject anything else', () => {
        // Assert
        expect(isFileRef({ id: 'f1', name: 'a.txt', size: 1, type: 'text/plain' })).toBe(true);
        expect(isFileRef({ id: '', name: 'a.txt', size: 1, type: 'text/plain' })).toBe(false);
        expect(isFileRef({ id: 'f1', name: 'a.txt', size: '1', type: 'text/plain' })).toBe(false);
        expect(isFileRef(null)).toBe(false);
    });

    it('should format sizes in the locale and percent as a whole number', () => {
        // Assert
        expect(formatBytes(812, 'en')).toBe('812 B');
        expect(formatBytes(1536, 'en')).toBe('1.5 KB');
        expect(formatBytes(1536, 'de')).toBe('1,5 KB');
        expect(formatBytes(10 * 1024 * 1024, 'en')).toBe('10 MB');
        expect(percentOf(50, 200)).toBe(25);
        expect(percentOf(5, 0)).toBe(0);
        expect(percentOf(300, 200)).toBe(100);
    });

    it('should read the code of a rejected transfer and use internal for anything else', () => {
        // Assert
        expect(transferCode({ code: 'quota' })).toBe('quota');
        expect(transferCode({ code: 'weird' })).toBe('internal');
        expect(transferCode(new Error('x'))).toBe('internal');
        expect(transferCode(undefined)).toBe('internal');
    });
});
