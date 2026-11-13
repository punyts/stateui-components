/** The first letter of the first and of the last word of a name, in capitals: one word gives one letter */
export function initialsOf(name: string): string {
    const words = name.split(/\s+/).filter((word) => word !== '');
    const first = words[0];
    const last = words.length > 1 ? words[words.length - 1] : undefined;
    return [first, last]
        .map((word) => (word === undefined ? '' : (Array.from(word)[0] ?? '')))
        .join('')
        .toLocaleUpperCase();
}
