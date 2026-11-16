import { describe, expect, it } from 'vitest';
import { commandMatches, groupCommands, readCommands } from './palette.js';

const commands = readCommands({
    open: { _label: 'Open file', group: 'File', shortcut: 'Ctrl+O', keywords: ['load'] },
    theme: { _label: 'Thème sombre', group: 'View', keywords: 'dark' },
    save: { _label: 'Save', group: 'File' },
    help: {}
});

describe('readCommands', () => {
    it('should read the map in key order, the key standing in for a missing label and one string for one keyword', () => {
        // Assert
        expect(commands.map((command) => command.key)).toEqual(['open', 'theme', 'save', 'help']);
        expect(commands[3]?.label).toBe('help');
        expect(commands[1]?.keywords).toEqual(['dark']);
        expect(commands[0]?.shortcut).toBe('Ctrl+O');
    });

    it('should read anything that is not a map as no commands', () => {
        // Assert
        expect(readCommands([{ _label: 'A' }])).toEqual([]);
        expect(readCommands(null)).toEqual([]);
    });
});

describe('commandMatches', () => {
    it('should find the query in the label or a keyword, apart from case and accents', () => {
        // Assert
        expect(commandMatches(commands[0]!, 'FILE', 'en')).toBe(true);
        expect(commandMatches(commands[0]!, 'loa', 'en')).toBe(true);
        expect(commandMatches(commands[1]!, 'theme', 'fr')).toBe(true);
        expect(commandMatches(commands[1]!, 'save', 'en')).toBe(false);
        expect(commandMatches(commands[1]!, '  ', 'en')).toBe(true);
    });
});

describe('groupCommands', () => {
    it('should group the matches in the order each group first appears', () => {
        // Act
        const groups = groupCommands(commands, '', 'en');

        // Assert
        expect(groups.map((group) => group.label)).toEqual(['File', 'View', '']);
        expect(groups[0]?.commands.map((command) => command.key)).toEqual(['open', 'save']);
    });

    it('should leave out a group with no match', () => {
        // Act
        const groups = groupCommands(commands, 'sa', 'en');

        // Assert
        expect(groups.map((group) => group.label)).toEqual(['File']);
        expect(groups[0]?.commands.map((command) => command.key)).toEqual(['save']);
    });
});
