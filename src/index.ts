/**
 * The folders of `components/` that group components by size. Grouping only: the folder name sets the `size` of a
 * component's catalog entry and nothing else, and a component folder sits directly inside one of them
 */
export const COMPONENT_GROUPS = ['atoms', 'molecules', 'composites', 'composed'] as const;

export type ComponentGroup = (typeof COMPONENT_GROUPS)[number];

export { ICON_ALIASES } from './icons/aliases.js';
export { CORE_ICON_NAMES } from './icons/coreNames.js';
export { createIconNames, isIconName, loadIconsFile, packagedIconNames } from './icons/names.js';
export type { IconNames } from './icons/names.js';
export { validateIconNode } from './icons/validate.js';
export type { IconEntry, IconPath, IconStyledPath, IconsFile } from './icons/types.js';
export { VALUE_FORMATS, formatValue, toNumber } from './shared/format/format.js';
export type { FormatOptions, ValueFormat } from './shared/format/format.js';
export { NUMBER_INPUT_FORMATS, formatNumberInput, parseNumberInput } from './shared/format/numberInput.js';
export type { NumberInputFormat, NumberInputOptions } from './shared/format/numberInput.js';
export { ALIGNED_PLACEMENTS, PLACEMENTS, createPopover, isAlignedPlacement, isAnchorName, isPlacement, positionAreaOf } from './shared/popover/popover.js';
export type { AlignedPlacement, AnyPlacement, Placement, PopoverDismissReason, PopoverHandle, PopoverOptions } from './shared/popover/popover.js';
export { createBandScale, createLinearScale, extentOf, niceTicks, stack, stackExtent } from './shared/chart/scale.js';
export type { BandOptions, BandScale, Extent, LinearScale, NiceTicks, StackedValue, TickFormatter } from './shared/chart/scale.js';
export { MINUTES_PER_DAY, addDays, addMonths, dayNumber, daysInMonth, fromDayNumber, isIsoDate, isoOfDay, monthGrid, parseIsoDate, parseMoment, todayIso, toIso, weekdayOfDay } from './shared/dates/isoDate.js';
export type { DateParts, GridDay, Moment } from './shared/dates/isoDate.js';
export { dateOrder, formatDate, formatDateRange, formatDayNumber, formatHour, formatLongDate, formatMonthYear, formatTime, monthNames, parseDate, weekdayNames } from './shared/dates/localeDates.js';
export type { NameWidth } from './shared/dates/localeDates.js';
export { FIRST_DAY_BY_REGION, firstDayFromIntl, firstDayFromTable, firstDayOf } from './shared/dates/weekStart.js';
export type { FirstDay } from './shared/dates/weekStart.js';
