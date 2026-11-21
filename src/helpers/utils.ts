import { HomeAssistant, navigate as navigatePath } from 'custom-card-helpers';
import { EntityKey } from '../const';
import { JkBmsCardConfig } from '../interfaces';
import { getPreset } from '../presets';

export type EntityDomain = 'sensor' | 'switch' | 'number' | 'binary_sensor';

export interface NumericReading {
    value: number | null;
    unit: string;
    entityId?: string;
    exists: boolean;
}

export interface StateReading {
    state: string | null;
    unit: string;
    entityId?: string;
    exists: boolean;
}

export interface CandidateOptions {
    // When true, do not fall back from a preset's pack-scoped mapping to legacy/alias bank-level names.
    strictPresetOnly?: boolean;
}

const UNAVAILABLE_STATES = new Set(['', 'unknown', 'unavailable', 'none', 'null', 'nan']);

const CELL_VOLTAGE_RE = /^cell_voltage_(\d+)$/;
const CELL_RESISTANCE_RE = /^cell_resistance_(\d+)$/;

const ENTITY_ALIASES: Partial<Record<EntityKey, string[]>> = {
    [EntityKey.power_tube_temperature]: ['mosfet_temperature'],
    [EntityKey.total_battery_capacity_setting]: ['full_charge_capacity'],
    [EntityKey.balance_starting_voltage]: ['balancing_start_voltage'],
    [EntityKey.balance_trigger_voltage]: ['balancing_trigger_voltage'],
    [EntityKey.capacity_remaining]: ['remaining_capacity'],
    [EntityKey.total_charging_cycle_capacity]: ['total_charging_cycle_capacity', 'total_battery_cycle_capacity'],
    [EntityKey.balancing_current]: ['balance_current'],
    [EntityKey.balancing]: ['balancer_status'],
    [EntityKey.balancer_status_bitmask]: ['balancer_status_bitmask'],
};

const isFullEntityId = (value: string) => value.includes('.');

const normalizedPrefix = (config?: JkBmsCardConfig): string =>
    typeof config?.prefix === 'string' ? config.prefix.trim() : '';

const normalizedPackZeroBased = (config?: JkBmsCardConfig): number => {
    const raw = config?.packIndex ?? config?.batteryNumber ?? 1;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 1) {
        return 0;
    }
    return numeric - 1;
};

const expandPlaceholders = (value: string, config?: JkBmsCardConfig): string => {
    const prefix = normalizedPrefix(config);
    const packZeroBased = normalizedPackZeroBased(config);
    return value.replace(/\{prefix\}/g, prefix).replace(/\{pack\}/g, String(packZeroBased));
};

const withDomain = (value: string, type: EntityDomain) =>
    isFullEntityId(value) ? value : `${type}.${value}`;

const prefixedEntityId = (config: JkBmsCardConfig, suffix: string, type: EntityDomain): string | undefined => {
    const expanded = expandPlaceholders(suffix, config);
    if (!expanded) return undefined;
    if (isFullEntityId(expanded)) return expanded;
    const prefix = normalizedPrefix(config);
    if (!prefix) return undefined;
    return `${type}.${prefix}_${expanded}`;
};

const cellIndexFromKey = (entityKey: EntityKey, family: 'cell_voltage' | 'cell_resistance'): number | null => {
    const match = entityKey?.toString()?.match(family === 'cell_voltage' ? CELL_VOLTAGE_RE : CELL_RESISTANCE_RE);
    return match ? Number(match[1]) : null;
};

const arrayEntity = (values: string[] | undefined, index: number): string | null => {
    const value = values?.[index - 1]?.toString()?.trim();
    return value && value.length > 1 ? value : null;
};

const configuredPrefix = (config: JkBmsCardConfig, key: string, legacyKey: string): string | null => {
    const value = (config?.entities?.[key] ?? config?.[legacyKey])?.toString()?.trim();
    return value && value.length > 1 ? value : null;
};

const generatedCellEntity = (
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain
): string | null => {
    const voltageIndex = cellIndexFromKey(entityKey, 'cell_voltage');
    if (voltageIndex) {
        const manual = arrayEntity(config?.cells, voltageIndex);
        if (manual) return withDomain(expandPlaceholders(manual, config), type);

        const prefix = configuredPrefix(config, 'cell_prefix', 'cellPrefix');
        if (prefix) return withDomain(`${expandPlaceholders(prefix, config)}${voltageIndex}`, type);
    }

    const resistanceIndex = cellIndexFromKey(entityKey, 'cell_resistance');
    if (resistanceIndex) {
        const legacyResistances = (config as Record<string, unknown>)?.cell_resistances as string[] | undefined;
        const manual = arrayEntity(config?.cellResistances ?? legacyResistances, resistanceIndex);
        if (manual) return withDomain(expandPlaceholders(manual, config), type);

        const prefix = configuredPrefix(config, 'cell_resistance_prefix', 'cellResistancePrefix');
        if (prefix) return withDomain(`${expandPlaceholders(prefix, config)}${resistanceIndex}`, type);
    }

    return null;
};

// Resolution precedence:
//   1. Cell array / cell_prefix overrides
//   2. Manual user override in config.entities
//   3. BMS model preset (empty string '' explicitly marks the entity absent and stops fallback)
//   4. ESPHome v3 ENTITY_ALIASES
//   5. Legacy key name
export const candidateEntityIds = (
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = 'sensor',
    options: CandidateOptions = {}
): string[] => {
    const generatedCell = generatedCellEntity(config, entityKey, type);
    if (generatedCell) return [generatedCell];

    const configuredValue = config?.entities?.[entityKey]?.toString()?.trim();
    const hasManualOverride = Boolean(configuredValue && configuredValue.length > 1);

    const preset = getPreset(config);
    const presetValue = preset.entities[entityKey];

    // If the preset explicitly maps this key to '', the BMS does not expose it:
    // suppress alias and legacy fallbacks. If the user supplied a manual override, return ONLY that override.
    if (presetValue === '') {
        if (!hasManualOverride || !configuredValue) return [];
        const manualId = prefixedEntityId(config, configuredValue, type);
        return manualId ? [manualId] : [];
    }

    const candidates: Array<string | undefined> = [];

    if (hasManualOverride && configuredValue) {
        candidates.push(prefixedEntityId(config, configuredValue, type));
    }

    if (presetValue !== undefined && presetValue !== '') {
        candidates.push(prefixedEntityId(config, presetValue, type));
        if (options.strictPresetOnly) {
            return [...new Set(candidates.filter(Boolean) as string[])];
        }
    }

    for (const alias of ENTITY_ALIASES[entityKey] ?? []) {
        candidates.push(prefixedEntityId(config, alias, type));
    }

    const legacyValue = entityKey?.toString();
    if (legacyValue) {
        candidates.push(prefixedEntityId(config, legacyValue, type));
    }

    return [...new Set(candidates.filter(Boolean) as string[])];
};

// Returns only the legacy/alias bank-level candidate IDs (ignoring pack-scoped preset entries).
export const bankLevelCandidateEntityIds = (
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = 'sensor'
): string[] => {
    const preset = getPreset(config);
    const presetValue = preset.entities[entityKey];
    const candidates: Array<string | undefined> = [];

    // Include preset mapping if it does NOT reference {pack} (i.e. it is bank-level like total_capacity / delta_voltage)
    if (presetValue !== undefined && presetValue !== '' && !presetValue.includes('{pack}')) {
        candidates.push(prefixedEntityId(config, presetValue, type));
    }

    for (const alias of ENTITY_ALIASES[entityKey] ?? []) {
        candidates.push(prefixedEntityId(config, alias, type));
    }

    const legacyValue = entityKey?.toString();
    if (legacyValue) {
        candidates.push(prefixedEntityId(config, legacyValue, type));
    }

    return [...new Set(candidates.filter(Boolean) as string[])];
};

const resolveEntityRecord = (
    hass: HomeAssistant | undefined,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = 'sensor',
    options?: CandidateOptions
) => {
    const states = hass?.states;
    if (!states) return null;
    for (const entityId of candidateEntityIds(config, entityKey, type, options)) {
        const entity = states[entityId];
        if (entity) return { entity, entityId };
    }
    return null;
};

export const resolveEntityId = (
    hass: HomeAssistant | undefined,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = 'sensor',
    options?: CandidateOptions
): string | undefined =>
    resolveEntityRecord(hass, config, entityKey, type, options)?.entityId ??
    candidateEntityIds(config, entityKey, type, options)[0];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fireEvent(node: HTMLElement, type: string, detail: any, options?: any) {
    options = options || {};
    detail = detail === null || detail === undefined ? {} : detail;
    const event = new Event(type, {
        bubbles: options.bubbles === undefined ? true : options.bubbles,
        cancelable: Boolean(options.cancelable),
        composed: options.composed === undefined ? true : options.composed,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event as any).detail = detail;
    node.dispatchEvent(event);
    return event;
}

export const configOrEnum = (config: JkBmsCardConfig, entityId: EntityKey): string => {
    const configValue = config?.entities?.[entityId]?.toString()?.trim();
    if (configValue && configValue.length > 1) return expandPlaceholders(configValue, config);

    const presetValue = getPreset(config).entities[entityId];
    return presetValue !== undefined ? expandPlaceholders(presetValue, config) : entityId?.toString();
};

export const navigate = (
    event: { stopPropagation?: () => void; target?: EventTarget | null } | undefined,
    config: JkBmsCardConfig,
    entityId: EntityKey,
    type: EntityDomain = 'sensor',
    hass?: HomeAssistant
) => {
    if (!event) {
        return;
    }

    event.stopPropagation?.();

    const fullEntityId = resolveEntityId(hass, config, entityId, type);
    if (!fullEntityId) return;

    const customEvent = new CustomEvent('hass-more-info', {
        detail: { entityId: fullEntityId },
        composed: true,
    });
    event.target?.dispatchEvent(customEvent);
};

export const navigateEntityId = (
    event: { stopPropagation?: () => void; target?: EventTarget | null } | undefined,
    entityId: string | undefined
) => {
    if (!event || !entityId) return;
    event.stopPropagation?.();
    const customEvent = new CustomEvent('hass-more-info', {
        detail: { entityId },
        composed: true,
    });
    event.target?.dispatchEvent(customEvent);
};

export const navigateTitle = (
    event: { stopPropagation?: () => void; target?: EventTarget | null } | undefined,
    hass: HomeAssistant,
    config: JkBmsCardConfig
) => {
    if (config?.titleAction !== 'device') {
        navigate(event, config, EntityKey.total_runtime_formatted, 'sensor', hass);
        return;
    }

    event?.stopPropagation?.();

    const entityId = resolveEntityId(hass, config, EntityKey.total_runtime_formatted);
    const hassEntities = (hass as unknown as { entities?: Record<string, { device_id?: string }> })?.entities;
    const deviceId =
        config?.deviceId?.trim() ||
        config?.entities?.device_id?.toString()?.trim() ||
        (entityId ? hassEntities?.[entityId]?.device_id : undefined);

    if (deviceId && event?.target) {
        navigatePath(event.target as HTMLElement, `/config/devices/device/${deviceId}`);
        return;
    }

    navigate(event, config, EntityKey.total_runtime_formatted, 'sensor', hass);
};

export const isUnavailableState = (raw: string | null | undefined): boolean => {
    if (raw === null || raw === undefined) return true;
    return UNAVAILABLE_STATES.has(raw.trim().toLowerCase());
};

export const readNumericFromCandidates = (
    hass: HomeAssistant | undefined,
    candidates: string[]
): NumericReading => {
    const states = hass?.states;
    if (!states) {
        return { value: null, unit: '', entityId: undefined, exists: false };
    }
    for (const entityId of candidates) {
        const entity = states[entityId];
        if (!entity) continue;
        const unit = entity.attributes?.unit_of_measurement ?? '';
        if (isUnavailableState(entity.state)) {
            return { value: null, unit, entityId, exists: true };
        }
        const num = Number(entity.state.trim());
        if (!Number.isFinite(num)) {
            return { value: null, unit, entityId, exists: true };
        }
        return { value: num, unit, entityId, exists: true };
    }
    return { value: null, unit: '', entityId: undefined, exists: false };
};

export const getRawState = (
    hass: HomeAssistant,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = 'sensor',
    options?: CandidateOptions
): StateReading => {
    const record = resolveEntityRecord(hass, config, entityKey, type, options);
    if (!record) {
        return { state: null, unit: '', entityId: undefined, exists: false };
    }

    const raw = record.entity.state;
    const unit = record.entity.attributes?.unit_of_measurement ?? '';
    if (isUnavailableState(raw)) {
        return { state: null, unit, entityId: record.entityId, exists: true };
    }

    return { state: raw.trim(), unit, entityId: record.entityId, exists: true };
};

export const getNumericState = (
    hass: HomeAssistant,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = 'sensor',
    options?: CandidateOptions
): NumericReading => {
    const raw = getRawState(hass, config, entityKey, type, options);
    if (raw.state === null) {
        return { value: null, unit: raw.unit, entityId: raw.entityId, exists: raw.exists };
    }

    const num = Number(raw.state);
    if (!Number.isFinite(num)) {
        return { value: null, unit: raw.unit, entityId: raw.entityId, exists: raw.exists };
    }

    return { value: num, unit: raw.unit, entityId: raw.entityId, exists: raw.exists };
};

export const getState = (
    hass: HomeAssistant,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    precision: number = 2,
    defaultValue = '',
    type: EntityDomain = 'sensor'
): string => {
    const record = resolveEntityRecord(hass, config, entityKey, type);
    if (!record) return defaultValue;

    const state = record.entity.state;
    if (state === '' || state === null || state === undefined) {
        return defaultValue;
    }

    const numeric = Number(state);
    if (!isNaN(numeric)) {
        return numeric.toFixed(precision);
    }

    return state;
};

export const getUnit = (
    hass: HomeAssistant,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = 'sensor'
): string => {
    const record = resolveEntityRecord(hass, config, entityKey, type);
    return record?.entity?.attributes?.unit_of_measurement ?? '';
};

export const parseBalancerBitmask = (hass: HomeAssistant, config: JkBmsCardConfig): bigint => {
    const raw = resolveEntityRecord(hass, config, EntityKey.balancer_status_bitmask)?.entity?.state ?? '';
    const value = raw?.toString()?.trim();
    if (!value || isUnavailableState(value)) return 0n;

    try {
        if (/^0b[01]+$/i.test(value)) {
            return BigInt(value);
        }
        if (/^[01]+$/.test(value) && value.length === config?.cellCount) {
            return BigInt(`0b${value}`);
        }
        if (/^0x[0-9a-f]+$/i.test(value)) {
            return BigInt(value);
        }
        if (/^\d+$/.test(value)) {
            return BigInt(value);
        }
        return 0n;
    } catch {
        return 0n;
    }
};

export const isCellBalancingFromMask = (mask: bigint, cellNumber: number): boolean => {
    if (mask === 0n || cellNumber < 1) return false;
    return (mask & (1n << BigInt(cellNumber - 1))) !== 0n;
};

export const isCellBalancing = (hass: HomeAssistant, config: JkBmsCardConfig, cellNumber: number): boolean =>
    isCellBalancingFromMask(parseBalancerBitmask(hass, config), cellNumber);

// Unit normalization helpers
type UnitType = 'V' | 'mV' | 'Ω' | 'mΩ';

const normalizeUnit = (unit: string | null | undefined): UnitType | null => {
    if (!unit) return null;

    const u = unit.trim().toLowerCase();

    switch (u) {
        case 'v':
            return 'V';
        case 'mv':
            return 'mV';

        case 'ω':
        case 'ohm':
        case 'ohms':
            return 'Ω';

        case 'mω':
        case 'mohm':
        case 'mohms':
            return 'mΩ';

        default:
            return null;
    }
};

export const toVolts = (value: number, unit?: string | null): number => {
    const norm = normalizeUnit(unit);
    return norm === 'mV' ? value / 1000 : value;
};

export const toMillivolts = (value: number, unit?: string | null): number => {
    const norm = normalizeUnit(unit);
    return norm === 'mV' ? value : value * 1000;
};

export const toAmps = (value: number, unit?: string | null): number | null => {
    if (!unit || !unit.trim()) return value;
    const u = unit.trim().toLowerCase();
    if (u === 'a' || u === 'amp' || u === 'amps') return value;
    if (u === 'ma' || u === 'milliamp' || u === 'milliamps') return value / 1000;
    return null;
};

export const toWatts = (value: number, unit?: string | null): number | null => {
    if (!unit || !unit.trim()) return value;
    const u = unit.trim().toLowerCase();
    if (u === 'w' || u === 'watt' || u === 'watts') return value;
    if (u === 'kw' || u === 'kilowatt' || u === 'kilowatts') return value * 1000;
    if (u === 'mw' || u === 'milliwatt' || u === 'milliwatts') return value / 1000;
    return null;
};

export const toCelsius = (value: number, unit?: string | null): number => {
    const u = unit?.trim().toLowerCase();
    if (u === '°f' || u === 'f' || u === 'fahrenheit') {
        return ((value - 32) * 5) / 9;
    }
    return value;
};

export const getTemperatureColor = (temp: number, unit: string = '°C'): string => {
    const tempC = toCelsius(temp, unit);
    const colors = [
        { temp: -10, color: '#0000FF' },
        { temp: 0, color: '#00BFFF' },
        { temp: 20, color: '#41CD52' },
        { temp: 30, color: '#FFD700' },
        { temp: 40, color: '#FF8C00' },
        { temp: 50, color: '#FF4500' },
        { temp: 60, color: '#DC143C' },
    ];

    for (let i = 0; i < colors.length - 1; i++) {
        const curr = colors[i];
        const next = colors[i + 1];

        if (tempC <= curr.temp) return curr.color;
        if (tempC >= next.temp) continue;

        const ratio = (tempC - curr.temp) / (next.temp - curr.temp);
        const r1 = parseInt(curr.color.slice(1, 3), 16);
        const g1 = parseInt(curr.color.slice(3, 5), 16);
        const b1 = parseInt(curr.color.slice(5, 7), 16);
        const r2 = parseInt(next.color.slice(1, 3), 16);
        const g2 = parseInt(next.color.slice(3, 5), 16);
        const b2 = parseInt(next.color.slice(5, 7), 16);

        const r = Math.round(r1 + ratio * (r2 - r1));
        const g = Math.round(g1 + ratio * (g2 - g1));
        const b = Math.round(b1 + ratio * (b2 - b1));

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    return colors[colors.length - 1].color;
};

const UNIT_CONFIG: Record<UnitType, { toBase: number }> = {
    V: { toBase: 1 },
    mV: { toBase: 0.001 },

    Ω: { toBase: 1 },
    mΩ: { toBase: 0.001 },
};

export const formatValue = (
    inputUnitRaw: string | null | undefined,
    outputUnitRaw: string | null | undefined,
    value: number | string
): string => {
    const numeric = typeof value === 'string' ? parseFloat(value) : value;

    if (isNaN(numeric)) return '-';

    const inputUnit = normalizeUnit(inputUnitRaw);
    const outputUnit = normalizeUnit(outputUnitRaw);

    if (!inputUnit || !outputUnit) {
        return `${numeric} ${outputUnitRaw ?? ''}`.trim();
    }

    const baseValue = numeric * UNIT_CONFIG[inputUnit].toBase;
    const finalValue = baseValue / UNIT_CONFIG[outputUnit].toBase;

    const decimals = outputUnit.startsWith('m') ? 0 : 3;

    const formatted = finalValue.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });

    return `${formatted} ${outputUnit}`;
};
