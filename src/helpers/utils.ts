import {HomeAssistant, navigate as navigatePath} from 'custom-card-helpers';
import {EntityKey} from '../const';
import {JkBmsCardConfig} from '../interfaces';

type EntityDomain = "sensor" | "switch" | "number" | "binary_sensor";

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

const withDomain = (value: string, type: EntityDomain) => isFullEntityId(value) ? value : `${type}.${value}`;

const prefixedEntityId = (config: JkBmsCardConfig, suffix: string, type: EntityDomain) =>
    `${type}.${config?.prefix}_${suffix}`;

const cellIndexFromKey = (entityKey: EntityKey, family: 'cell_voltage' | 'cell_resistance'): number | null => {
    const match = entityKey?.toString()?.match(new RegExp(`^${family}_(\\d+)$`));
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
        if (manual) return withDomain(manual, type);

        const prefix = configuredPrefix(config, 'cell_prefix', 'cellPrefix');
        if (prefix) return withDomain(`${prefix}${voltageIndex}`, type);
    }

    const resistanceIndex = cellIndexFromKey(entityKey, 'cell_resistance');
    if (resistanceIndex) {
        const manual = arrayEntity(config?.cellResistances ?? (config as any)?.cell_resistances, resistanceIndex);
        if (manual) return withDomain(manual, type);

        const prefix = configuredPrefix(config, 'cell_resistance_prefix', 'cellResistancePrefix');
        if (prefix) return withDomain(`${prefix}${resistanceIndex}`, type);
    }

    return null;
};

const candidateEntityIds = (
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain
): string[] => {
    const generatedCell = generatedCellEntity(config, entityKey, type);
    if (generatedCell) return [generatedCell];

    const configuredValue = config?.entities?.[entityKey]?.toString()?.trim();
    const legacyValue = entityKey?.toString();
    const aliases = (ENTITY_ALIASES[entityKey] ?? []).map(alias => prefixedEntityId(config, alias, type));
    const legacyEntityId = legacyValue ? prefixedEntityId(config, legacyValue, type) : undefined;

    const candidates = configuredValue && configuredValue.length > 1
        ? [
            isFullEntityId(configuredValue) ? configuredValue : prefixedEntityId(config, configuredValue, type),
            ...aliases,
            legacyEntityId,
        ]
        : [
            ...aliases,
            legacyEntityId,
        ];

    return [...new Set(candidates.filter(Boolean) as string[])];
};

export const resolveEntityId = (
    hass: HomeAssistant,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = "sensor"
): string | undefined => resolveEntity(hass, config, entityKey, type)?.entity_id ?? candidateEntityIds(config, entityKey, type)[0];

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

export const configOrEnum = (config: JkBmsCardConfig, entityId: EntityKey) => {
    const configValue = config?.entities?.[entityId]?.toString()?.trim();
    return configValue && configValue.length > 1 ? configValue : entityId?.toString();
}

export const navigate = (event, config: JkBmsCardConfig, entityId: EntityKey, type: EntityDomain = "sensor", hass?: HomeAssistant) => {
    if (!event) {
        return;
    }

    event.stopPropagation();

    const entity = hass ? resolveEntity(hass, config, entityId, type) : null;
    const fullEntityId = entity?.entity_id ?? candidateEntityIds(config, entityId, type)[0];
    let customEvent = new CustomEvent('hass-more-info', {
        detail: {entityId: fullEntityId},
        composed: true,
    })
    event.target.dispatchEvent(customEvent);
}

export const navigateTitle = (event, hass: HomeAssistant, config: JkBmsCardConfig) => {
    if (config?.titleAction !== 'device') {
        navigate(event, config, EntityKey.total_runtime_formatted, 'sensor', hass);
        return;
    }

    event?.stopPropagation();

    const entityId = resolveEntityId(hass, config, EntityKey.total_runtime_formatted);
    const deviceId = config?.deviceId?.trim()
        ?? config?.entities?.device_id?.toString()?.trim()
        ?? (entityId ? (hass as any)?.entities?.[entityId]?.device_id : undefined);

    if (deviceId) {
        navigatePath(event?.target, `/config/devices/device/${deviceId}`);
        return;
    }

    navigate(event, config, EntityKey.total_runtime_formatted, 'sensor', hass);
}

const resolveEntity = (
    hass: HomeAssistant,
    config: JkBmsCardConfig,
    entityKey: EntityKey,
    type: EntityDomain = "sensor"
) => {
    for (const entityId of candidateEntityIds(config, entityKey, type)) {
        const entity = hass?.states[entityId];
        if (entity) return { ...entity, entity_id: entityId };
    }

    return null;
};

export const getState = (hass: HomeAssistant, config: JkBmsCardConfig, entityKey: EntityKey, precision: number = 2, defaultValue = '', type: EntityDomain = "sensor"): string => {
    const entity = resolveEntity(hass, config, entityKey, type);
    if (!entity) return defaultValue;

    const state = entity.state;
    const numeric = Number(state);

    if (!isNaN(numeric))
        return numeric.toFixed(precision);

    return state ?? defaultValue;
}

export const getUnit = ( hass: HomeAssistant, config: JkBmsCardConfig, entityKey: EntityKey, type: EntityDomain = "sensor"): string => {
    const entity = resolveEntity(hass, config, entityKey, type);
    return entity?.attributes?.unit_of_measurement ?? '';
};

export const isCellBalancing = (hass: HomeAssistant, config: JkBmsCardConfig, cellNumber: number): boolean => {
    const raw = resolveEntity(hass, config, EntityKey.balancer_status_bitmask)?.state ?? '';
    const value = raw?.toString()?.trim();
    if (!value || value === 'unknown' || value === 'unavailable') return false;

    let mask: bigint;
    try {
        if (/^0b[01]+$/i.test(value)) {
            mask = BigInt(value);
        } else if (/^[01]+$/.test(value) && value.length === config?.cellCount) {
            mask = BigInt(`0b${value}`);
        } else if (/^0x[0-9a-f]+$/i.test(value)) {
            mask = BigInt(value);
        } else if (/^\d+$/.test(value)) {
            mask = BigInt(value);
        } else {
            return false;
        }
    } catch {
        return false;
    }

    return (mask & (1n << BigInt(cellNumber - 1))) !== 0n;
};

// This is a more generic factor conversion function
type UnitType = 'V' | 'mV' | 'Ω' | 'mΩ'; // this could be extended to any other measure types, but should be added also in UNIT_CONFIG

const normalizeUnit = (unit: string | null | undefined): UnitType | null => {
    if (!unit) return null;

    const u = unit.trim().toLowerCase();

    switch (u) {
        case 'v': return 'V';
        case 'mv': return 'mV';

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

const UNIT_CONFIG: Record<UnitType, { toBase: number }> = {
    V:  { toBase: 1 },
    mV: { toBase: 0.001 },

    Ω:  { toBase: 1 },
    mΩ: { toBase: 0.001 }
};

export const formatValue = (
    inputUnitRaw: string | null | undefined,
    outputUnitRaw: string | null | undefined,
    value: number | string
): string => {

    const numeric = typeof value === 'string'
        ? parseFloat(value)
        : value;

    if (isNaN(numeric)) return '-';

    const inputUnit = normalizeUnit(inputUnitRaw);
    const outputUnit = normalizeUnit(outputUnitRaw);

    // fallback safe
    if (!inputUnit || !outputUnit) {
        return `${numeric} ${outputUnitRaw ?? ''}`.trim();
    }

    // conversion: input → bază → output
    const baseValue = numeric * UNIT_CONFIG[inputUnit].toBase;
    const finalValue = baseValue / UNIT_CONFIG[outputUnit].toBase;

    const decimals = outputUnit.startsWith('m') ? 0 : 3;

    const formatted = finalValue.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });

    return `${formatted} ${outputUnit}`;
};
