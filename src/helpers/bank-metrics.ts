import { HomeAssistant } from 'custom-card-helpers';
import { EntityKey } from '../const';
import { ExtraEntityKey, JkBmsCardConfig, JkBmsPackConfig } from '../interfaces';
import { getPreset } from '../presets';
import {
    bankLevelCandidateEntityIds,
    candidateEntityIds,
    EntityDomain,
    getNumericState,
    getRawState,
    isCellBalancingFromMask,
    parseBalancerBitmask,
    readNumericFromCandidates,
    toAmps,
    toCelsius,
    toMillivolts,
    toVolts,
    toWatts,
} from './utils';

export interface FetState {
    exists: boolean;
    isOn: boolean;
    isUnavailable: boolean;
    entityId?: string;
}

export interface CellSnapshot {
    index: number;
    voltageV: number | null;
    voltageEntityId?: string;
    resistance: number | null;
    resistanceUnit: string;
    resistanceEntityId?: string;
    isBalancing: boolean;
    isMin: boolean;
    isMax: boolean;
}

export interface TempReading {
    value: number;
    unit: string;
    celsius: number;
    label: string;
    entityId?: string;
}

export interface BankFallbackSource {
    voltage?: number | null;
    voltageEntityId?: string;
    current?: number | null;
    currentEntityId?: string;
    power?: number | null;
    powerEntityId?: string;
    soc?: number | null;
    socEntityId?: string;
    remainingAh?: number | null;
    remainingAhEntityId?: string;
    capacityAh?: number | null;
    capacityAhEntityId?: string;
}

export interface PackSnapshot {
    key: string;
    index: number;
    name: string;
    prefix: string;
    bmsModel?: string;
    packConfig: JkBmsCardConfig;
    isOnline: boolean;
    soc: number | null;
    socEntityId?: string;
    voltage: number | null;
    voltageEntityId?: string;
    current: number | null;
    currentEntityId?: string;
    power: number | null;
    powerDerived: boolean;
    powerEntityId?: string;
    // Electrical source key for deduping measured or derived power when current sensors are shared.
    powerSourceKey?: string;
    remainingAh: number | null;
    remainingAhEntityId?: string;
    capacityAh: number | null;
    capacityAhEntityId?: string;
    // Optional bank-level fallback readings (used for shared-prefix models like Seplos BLE when pack-level sensors aren't enabled).
    bankFallback?: BankFallbackSource;
    cycles: number | null;
    cyclesEntityId?: string;
    cycleCapacityAh: number | null;
    averageCellV: number | null;
    deltaV: number | null;
    deltaMv: number | null;
    deltaEntityId?: string;
    minCellV: number | null;
    maxCellV: number | null;
    minCellId: number | null;
    maxCellId: number | null;
    balancingCurrent: number | null;
    balancingCurrentEntityId?: string;
    isBalancing: boolean;
    balancerMask: bigint;
    mosTemp: TempReading | null;
    tempSensors: TempReading[];
    peakTemp: TempReading | null;
    fets: {
        charging: FetState;
        discharging: FetState;
        balancer: FetState;
        heater: FetState;
    };
    errorMessage: string | null;
    errorEntityId?: string;
    runtime: string | null;
    runtimeEntityId?: string;
    hardwareVersion: string | null;
    softwareVersion: string | null;
    deviceId?: string;
    navigationPath?: string;
    cells: CellSnapshot[];
}

export type BankStatus = 'charging' | 'discharging' | 'idle' | 'offline';

export interface BankWorstDelta {
    deltaMv: number;
    deltaV: number;
    packName: string;
    minCellId: number | null;
    maxCellId: number | null;
    entityId?: string;
    isWarning: boolean;
}

export interface BankPeakTemp {
    value: number;
    unit: string;
    celsius: number;
    packName: string;
    label: string;
    entityId?: string;
}

export interface BankCellExtreme {
    voltageV: number;
    packName: string;
    cellId: number | null;
}

export interface BankSnapshot {
    status: BankStatus;
    totalCount: number;
    onlineCount: number;
    isPartial: boolean;
    soc: number | null;
    avgVoltage: number | null;
    voltageSpreadV: number | null;
    totalCurrent: number | null;
    totalPower: number | null;
    totalRemainingAh: number | null;
    totalCapacityAh: number | null;
    hasFullCapacityCoverage: boolean;
    remainingKwh: number | null;
    totalKwh: number | null;
    currentDeadbandA: number;
    etaHours: number | null;
    worstDelta: BankWorstDelta | null;
    peakTemp: BankPeakTemp | null;
    minCell: BankCellExtreme | null;
    maxCell: BankCellExtreme | null;
    balancingPackCount: number;
    errorCount: number;
    hasFault: boolean;
    packs: PackSnapshot[];
}

const PACK_ONLY_ROOT_ENTITY_KEYS = new Set<string>(['cell_prefix', 'cell_resistance_prefix', 'device_id']);
const NON_ERROR_STRINGS = new Set(['', '0', 'none', 'ok', 'normal', '-']);

export const isTruthyHeater = (val: unknown): boolean => val === true || val === 1 || val === '1';

// Collision-free stable key encoding. Omits `name` when `id` is absent so renaming a pack keeps its drawer open.
export const computeStablePackKeys = (packs: JkBmsPackConfig[]): string[] => {
    const counts = new Map<string, number>();
    return packs.map(pack => {
        const id = typeof pack.id === 'string' ? pack.id.trim() : '';
        const prefix = typeof pack.prefix === 'string' ? pack.prefix.trim() : '';
        const idxPart = pack.packIndex ?? pack.batteryNumber ?? '';
        const base = id ? JSON.stringify(['id', id]) : JSON.stringify(['p', prefix, String(idxPart)]);
        const occurrence = (counts.get(base) ?? 0) + 1;
        counts.set(base, occurrence);
        return JSON.stringify([base, occurrence]);
    });
};

export const resolveEffectivePacks = (
    rootConfig: JkBmsCardConfig
): { packs: JkBmsPackConfig[]; isFallback: boolean } => {
    if (Array.isArray(rootConfig.packs) && rootConfig.packs.length > 0) {
        return { packs: rootConfig.packs, isFallback: false };
    }

    const legacyResistances = (rootConfig as Record<string, unknown>)?.cell_resistances as string[] | undefined;

    const fallback: JkBmsPackConfig = {
        id: 'root-fallback-pack',
        name: typeof rootConfig.batteryName === 'string' ? rootConfig.batteryName.trim() || undefined : undefined,
        prefix: typeof rootConfig.prefix === 'string' ? rootConfig.prefix.trim() : '',
        bmsModel: rootConfig.bmsModel,
        packIndex: rootConfig.packIndex ?? rootConfig.batteryNumber ?? 1,
        batteryNumber: rootConfig.batteryNumber,
        cellCount: rootConfig.cellCount,
        tempSensorsCount: rootConfig.tempSensorsCount,
        hasHeater: isTruthyHeater(rootConfig.hasHeater),
        deviceId: rootConfig.deviceId,
        entities: rootConfig.entities,
        cells: rootConfig.cells,
        cellResistances: rootConfig.cellResistances ?? legacyResistances,
        cellPrefix: rootConfig.cellPrefix,
        cellResistancePrefix: rootConfig.cellResistancePrefix,
    };

    return { packs: [fallback], isFallback: true };
};

// Merge root defaults with per-pack overrides.
// When packs[] is configured, NEVER inherit prefix, deviceId, cell arrays/prefixes,
// or full entity IDs (with '.') from root — only shape/display defaults and dotless suffix overrides.
export const buildPackConfig = (
    rootConfig: JkBmsCardConfig,
    pack: JkBmsPackConfig,
    index: number,
    isFallbackSinglePack = false
): JkBmsCardConfig => {
    const mergedEntities: Partial<Record<EntityKey | ExtraEntityKey, string>> = {};

    if (isFallbackSinglePack) {
        if (rootConfig.entities) {
            for (const [k, v] of Object.entries(rootConfig.entities)) {
                const trimmed = v?.toString()?.trim();
                if (trimmed && trimmed.length > 1) {
                    mergedEntities[k as EntityKey | ExtraEntityKey] = trimmed;
                }
            }
        }
    } else if (rootConfig.entities) {
        for (const [k, v] of Object.entries(rootConfig.entities)) {
            if (PACK_ONLY_ROOT_ENTITY_KEYS.has(k)) continue;
            const trimmed = v?.toString()?.trim();
            if (trimmed && trimmed.length > 1 && !trimmed.includes('.')) {
                mergedEntities[k as EntityKey | ExtraEntityKey] = trimmed;
            }
        }
    }

    if (pack.entities) {
        for (const [k, v] of Object.entries(pack.entities)) {
            const trimmed = v?.toString()?.trim();
            if (trimmed && trimmed.length > 1) {
                mergedEntities[k as EntityKey | ExtraEntityKey] = trimmed;
            }
        }
    }

    const packIndex = pack.packIndex ?? pack.batteryNumber ?? index + 1;
    const hasHeater =
        pack.hasHeater !== undefined ? isTruthyHeater(pack.hasHeater) : isTruthyHeater(rootConfig.hasHeater);
    const legacyRootRes = (rootConfig as Record<string, unknown>)?.cell_resistances as string[] | undefined;
    const legacyPackRes = (pack as unknown as Record<string, unknown>)?.cell_resistances as string[] | undefined;

    return {
        type: rootConfig.type,
        title: (typeof pack.name === 'string' ? pack.name : undefined) ?? rootConfig.title,
        bmsModel: pack.bmsModel ?? rootConfig.bmsModel,
        prefix: typeof pack.prefix === 'string' ? pack.prefix.trim() : '',
        batteryName: typeof pack.name === 'string' ? pack.name : undefined,
        packIndex,
        batteryNumber: pack.batteryNumber ?? packIndex,
        cellCount: pack.cellCount ?? rootConfig.cellCount ?? 16,
        cellColumns: rootConfig.cellColumns ?? 4,
        cellLayout: rootConfig.cellLayout ?? 'incremental',
        deltaVoltageUnit: rootConfig.deltaVoltageUnit ?? 'mV',
        resistanceUnit: rootConfig.resistanceUnit ?? 'Ω',
        deltaWarningMv: rootConfig.deltaWarningMv ?? 30,
        cellColorMode: rootConfig.cellColorMode ?? 'progress',
        cellOrientation: rootConfig.cellOrientation ?? 'horizontal',
        minCellVoltage: rootConfig.minCellVoltage,
        maxCellVoltage: rootConfig.maxCellVoltage,
        tempSensorsCount: pack.tempSensorsCount ?? rootConfig.tempSensorsCount ?? 0,
        hasHeater: hasHeater ? '1' : '0',
        socDecimals: rootConfig.socDecimals ?? 1,
        customDecimals: rootConfig.customDecimals ?? 2,
        showButtons: rootConfig.showButtons ?? true,
        showCells: rootConfig.showCells ?? true,
        showResistances: rootConfig.showResistances ?? false,
        deviceId: isFallbackSinglePack ? (pack.deviceId ?? rootConfig.deviceId) : pack.deviceId,
        cells: isFallbackSinglePack ? (pack.cells ?? rootConfig.cells) : pack.cells,
        cellResistances: isFallbackSinglePack
            ? (pack.cellResistances ?? legacyPackRes ?? rootConfig.cellResistances ?? legacyRootRes)
            : (pack.cellResistances ?? legacyPackRes),
        cellPrefix: isFallbackSinglePack ? (pack.cellPrefix ?? rootConfig.cellPrefix) : pack.cellPrefix,
        cellResistancePrefix: isFallbackSinglePack
            ? (pack.cellResistancePrefix ?? rootConfig.cellResistancePrefix)
            : pack.cellResistancePrefix,
        entities: mergedEntities,
    };
};

const WATCHED_CORE_KEYS: Array<[EntityKey, EntityDomain]> = [
    [EntityKey.total_voltage, 'sensor'],
    [EntityKey.current, 'sensor'],
    [EntityKey.power, 'sensor'],
    [EntityKey.state_of_charge, 'sensor'],
    [EntityKey.capacity_remaining, 'sensor'],
    [EntityKey.total_battery_capacity_setting, 'sensor'],
    [EntityKey.delta_cell_voltage, 'sensor'],
    [EntityKey.average_cell_voltage, 'sensor'],
    [EntityKey.min_cell_voltage, 'sensor'],
    [EntityKey.max_cell_voltage, 'sensor'],
    [EntityKey.min_voltage_cell, 'sensor'],
    [EntityKey.max_voltage_cell, 'sensor'],
    [EntityKey.balancing_current, 'sensor'],
    [EntityKey.balancer_status_bitmask, 'sensor'],
    [EntityKey.power_tube_temperature, 'sensor'],
    [EntityKey.charging_cycles, 'sensor'],
    [EntityKey.total_charging_cycle_capacity, 'sensor'],
    [EntityKey.errors, 'sensor'],
    [EntityKey.total_runtime_formatted, 'sensor'],
    [EntityKey.hardware_version, 'sensor'],
    [EntityKey.software_version, 'sensor'],
    [EntityKey.balancing, 'binary_sensor'],
    [EntityKey.charging, 'switch'],
    [EntityKey.discharging, 'switch'],
    [EntityKey.balancer, 'switch'],
    [EntityKey.heater, 'switch'],
];

export const collectWatchedEntityIds = (rootConfig: JkBmsCardConfig): string[] => {
    const { packs, isFallback } = resolveEffectivePacks(rootConfig);
    const ids = new Set<string>();

    packs.forEach((pack, index) => {
        const packConfig = buildPackConfig(rootConfig, pack, index, isFallback);
        for (const [key, domain] of WATCHED_CORE_KEYS) {
            for (const id of candidateEntityIds(packConfig, key, domain)) {
                ids.add(id);
            }
            for (const id of bankLevelCandidateEntityIds(packConfig, key, domain)) {
                ids.add(id);
            }
        }

        const tempCount = Math.min(Math.max(packConfig.tempSensorsCount ?? 0, 0), 4);
        for (let t = 1; t <= tempCount; t++) {
            const key = `temperature_sensor_${t}` as EntityKey;
            for (const id of candidateEntityIds(packConfig, key, 'sensor')) {
                ids.add(id);
            }
        }

        const cellCount = Math.min(Math.max(packConfig.cellCount ?? 16, 0), 96);
        for (let c = 1; c <= cellCount; c++) {
            const vKey = `cell_voltage_${c}` as EntityKey;
            for (const id of candidateEntityIds(packConfig, vKey, 'sensor')) {
                ids.add(id);
            }
            if (packConfig.showResistances) {
                const rKey = `cell_resistance_${c}` as EntityKey;
                for (const id of candidateEntityIds(packConfig, rKey, 'sensor')) {
                    ids.add(id);
                }
            }
        }
    });

    return [...ids];
};

export const countMatchedPackEntities = (
    hass: HomeAssistant | undefined,
    rootConfig: JkBmsCardConfig,
    pack: JkBmsPackConfig,
    index: number
): number => {
    const states = hass?.states;
    if (!states || !pack.prefix?.trim()) return 0;

    const packConfig = buildPackConfig(rootConfig, pack, index, false);
    const matched = new Set<string>();

    for (const [key, domain] of WATCHED_CORE_KEYS) {
        for (const id of candidateEntityIds(packConfig, key, domain)) {
            if (states[id]) {
                matched.add(id);
                break;
            }
        }
    }

    const tempCount = Math.min(Math.max(packConfig.tempSensorsCount ?? 0, 0), 4);
    for (let t = 1; t <= tempCount; t++) {
        for (const id of candidateEntityIds(packConfig, `temperature_sensor_${t}` as EntityKey, 'sensor')) {
            if (states[id]) {
                matched.add(id);
                break;
            }
        }
    }

    const cellCount = Math.min(Math.max(packConfig.cellCount ?? 16, 0), 96);
    for (let c = 1; c <= cellCount; c++) {
        for (const id of candidateEntityIds(packConfig, `cell_voltage_${c}` as EntityKey, 'sensor')) {
            if (states[id]) {
                matched.add(id);
                break;
            }
        }
    }

    return matched.size;
};

const readFet = (hass: HomeAssistant, packConfig: JkBmsCardConfig, key: EntityKey): FetState => {
    const reading = getRawState(hass, packConfig, key, 'switch');
    return {
        exists: reading.exists,
        isOn: reading.state?.toLowerCase() === 'on',
        isUnavailable: reading.exists && reading.state === null,
        entityId: reading.entityId,
    };
};

const parseErrorState = (state: string | null): string | null => {
    if (state === null) return null;
    const trimmed = state.trim();
    if (NON_ERROR_STRINGS.has(trimmed.toLowerCase())) return null;
    return trimmed;
};

export interface ReadPackOptions {
    isFallbackSinglePack?: boolean;
    includeResistances?: boolean;
    cachedPackConfig?: JkBmsCardConfig;
}

export const readPackSnapshot = (
    hass: HomeAssistant,
    rootConfig: JkBmsCardConfig,
    pack: JkBmsPackConfig,
    index: number,
    stableKey: string,
    optionsOrFallback: boolean | ReadPackOptions = false
): PackSnapshot => {
    const opts: ReadPackOptions =
        typeof optionsOrFallback === 'boolean'
            ? { isFallbackSinglePack: optionsOrFallback, includeResistances: true }
            : optionsOrFallback;

    const isFallbackSinglePack = opts.isFallbackSinglePack ?? false;
    const packConfig = opts.cachedPackConfig ?? buildPackConfig(rootConfig, pack, index, isFallbackSinglePack);
    const cellCount = Math.min(Math.max(packConfig.cellCount ?? 16, 0), 96);
    const preset = getPreset(packConfig);
    const strictKeys = new Set<EntityKey>(preset.strictPackKeys ?? []);
    const bankScopedKeys = new Set<EntityKey>(preset.bankScopedKeys ?? []);

    const optFor = (key: EntityKey) =>
        strictKeys.has(key) ? { strictPresetOnly: true } : undefined;

    const voltageRead = getNumericState(hass, packConfig, EntityKey.total_voltage, 'sensor', optFor(EntityKey.total_voltage));
    const currentRead = getNumericState(hass, packConfig, EntityKey.current, 'sensor', optFor(EntityKey.current));
    const powerRead = getNumericState(hass, packConfig, EntityKey.power);
    const socRead = getNumericState(hass, packConfig, EntityKey.state_of_charge, 'sensor', optFor(EntityKey.state_of_charge));
    const remainingRead = getNumericState(hass, packConfig, EntityKey.capacity_remaining);
    const capacityRead = getNumericState(hass, packConfig, EntityKey.total_battery_capacity_setting);
    const cyclesRead = getNumericState(hass, packConfig, EntityKey.charging_cycles, 'sensor', optFor(EntityKey.charging_cycles));
    const cycleCapRead = getNumericState(hass, packConfig, EntityKey.total_charging_cycle_capacity);
    const avgCellRead = bankScopedKeys.has(EntityKey.average_cell_voltage)
        ? { value: null, unit: '', entityId: undefined, exists: false }
        : getNumericState(hass, packConfig, EntityKey.average_cell_voltage);
    const deltaRead = bankScopedKeys.has(EntityKey.delta_cell_voltage)
        ? { value: null, unit: '', entityId: undefined, exists: false }
        : getNumericState(hass, packConfig, EntityKey.delta_cell_voltage);
    const minCellVRead = bankScopedKeys.has(EntityKey.min_cell_voltage)
        ? { value: null, unit: '', entityId: undefined, exists: false }
        : getNumericState(hass, packConfig, EntityKey.min_cell_voltage);
    const maxCellVRead = bankScopedKeys.has(EntityKey.max_cell_voltage)
        ? { value: null, unit: '', entityId: undefined, exists: false }
        : getNumericState(hass, packConfig, EntityKey.max_cell_voltage);
    const minCellIdRead = getNumericState(hass, packConfig, EntityKey.min_voltage_cell);
    const maxCellIdRead = getNumericState(hass, packConfig, EntityKey.max_voltage_cell);
    const balCurrentRead = getNumericState(hass, packConfig, EntityKey.balancing_current);
    const balBinaryRead = getRawState(hass, packConfig, EntityKey.balancing, 'binary_sensor');
    const errorRead = getRawState(hass, packConfig, EntityKey.errors);
    const runtimeRead = getRawState(hass, packConfig, EntityKey.total_runtime_formatted);
    const hwRead = getRawState(hass, packConfig, EntityKey.hardware_version);
    const swRead = getRawState(hass, packConfig, EntityKey.software_version);

    const voltage = voltageRead.value !== null ? toVolts(voltageRead.value, voltageRead.unit) : null;
    const current = currentRead.value !== null ? toAmps(currentRead.value, currentRead.unit) : null;

    let power = powerRead.value !== null ? toWatts(powerRead.value, powerRead.unit) : null;
    let powerDerived = false;
    let powerEntityId = powerRead.entityId;
    let powerSourceKey = power !== null ? (powerRead.entityId ?? currentRead.entityId) : undefined;

    if (power === null && voltage !== null && current !== null) {
        power = voltage * current;
        powerDerived = true;
        powerEntityId = currentRead.entityId;
        // Key derived power by currentEntityId so two packs sharing a current sensor never double-count power.
        powerSourceKey = currentRead.entityId ? `cur:${currentRead.entityId}` : undefined;
    }

    const balancerMask = parseBalancerBitmask(hass, packConfig);
    const readResistances = Boolean(packConfig.showResistances) && opts.includeResistances !== false;

    // Read cells & compute dynamic min/max/avg from valid positive voltages (> 0 V)
    const cells: CellSnapshot[] = [];
    let dynMinV = Infinity;
    let dynMaxV = -Infinity;
    let dynMinId: number | null = null;
    let dynMaxId: number | null = null;
    let cellSum = 0;
    let validCellCount = 0;

    for (let i = 1; i <= cellCount; i++) {
        const vRead = getNumericState(hass, packConfig, `cell_voltage_${i}` as EntityKey);
        const rRead = readResistances
            ? getNumericState(hass, packConfig, `cell_resistance_${i}` as EntityKey)
            : { value: null, unit: '', entityId: undefined, exists: false };

        const vVolts = vRead.value !== null ? toVolts(vRead.value, vRead.unit) : null;
        const validVoltage = vVolts !== null && vVolts > 0 ? vVolts : null;

        if (validVoltage !== null) {
            validCellCount++;
            cellSum += validVoltage;
            if (validVoltage < dynMinV) {
                dynMinV = validVoltage;
                dynMinId = i;
            }
            if (validVoltage > dynMaxV) {
                dynMaxV = validVoltage;
                dynMaxId = i;
            }
        }

        cells.push({
            index: i,
            voltageV: validVoltage,
            voltageEntityId: vRead.entityId,
            resistance: rRead.value !== null && rRead.value > 0 ? rRead.value : null,
            resistanceUnit: rRead.unit || 'Ω',
            resistanceEntityId: rRead.entityId,
            isBalancing: isCellBalancingFromMask(balancerMask, i),
            isMin: false,
            isMax: false,
        });
    }

    const sensorMinId =
        minCellIdRead.value !== null &&
        Number.isInteger(minCellIdRead.value) &&
        minCellIdRead.value >= 1 &&
        minCellIdRead.value <= cellCount
            ? minCellIdRead.value
            : null;
    const sensorMaxId =
        maxCellIdRead.value !== null &&
        Number.isInteger(maxCellIdRead.value) &&
        maxCellIdRead.value >= 1 &&
        maxCellIdRead.value <= cellCount
            ? maxCellIdRead.value
            : null;

    // Prefer cell-derived extrema/delta/average whenever >= 2 valid cells are present so shared
    // summary sensors can never override per-pack cell telemetry.
    const hasCellStats = validCellCount >= 2;

    const minCellId = hasCellStats ? dynMinId : (sensorMinId ?? dynMinId);
    const maxCellId = hasCellStats ? dynMaxId : (sensorMaxId ?? dynMaxId);

    const sensorMinV = minCellVRead.value !== null ? toVolts(minCellVRead.value, minCellVRead.unit) : null;
    const sensorMaxV = maxCellVRead.value !== null ? toVolts(maxCellVRead.value, maxCellVRead.unit) : null;

    const minCellV = hasCellStats
        ? dynMinV
        : sensorMinV !== null && sensorMinV > 0
          ? sensorMinV
          : dynMinV !== Infinity
            ? dynMinV
            : null;
    const maxCellV = hasCellStats
        ? dynMaxV
        : sensorMaxV !== null && sensorMaxV > 0
          ? sensorMaxV
          : dynMaxV !== -Infinity
            ? dynMaxV
            : null;

    const sensorDeltaMv =
        deltaRead.value !== null && deltaRead.value >= 0
            ? toMillivolts(deltaRead.value, deltaRead.unit)
            : null;
    const dynDeltaMv = hasCellStats ? Math.round(Math.max(0, (dynMaxV - dynMinV) * 1000) * 1000) / 1000 : null;
    const deltaMv = hasCellStats
        ? dynDeltaMv
        : sensorDeltaMv !== null && sensorDeltaMv >= 0
          ? sensorDeltaMv
          : dynDeltaMv;
    const deltaV = deltaMv !== null ? deltaMv / 1000 : null;

    const sensorAvgV = avgCellRead.value !== null ? toVolts(avgCellRead.value, avgCellRead.unit) : null;
    const averageCellV = hasCellStats
        ? cellSum / validCellCount
        : sensorAvgV !== null && sensorAvgV > 0
          ? sensorAvgV
          : validCellCount > 0
            ? cellSum / validCellCount
            : null;

    if (minCellId !== null || maxCellId !== null) {
        for (const cell of cells) {
            cell.isMin = minCellId !== null && cell.index === minCellId;
            cell.isMax = maxCellId !== null && cell.index === maxCellId;
        }
    }

    // Temperatures (compare in °C, preserve display value & unit)
    const mosRead = getNumericState(
        hass,
        packConfig,
        EntityKey.power_tube_temperature,
        'sensor',
        optFor(EntityKey.power_tube_temperature)
    );
    const mosTemp: TempReading | null =
        mosRead.value !== null
            ? {
                  value: mosRead.value,
                  unit: mosRead.unit || '°C',
                  celsius: toCelsius(mosRead.value, mosRead.unit),
                  label: 'MOS',
                  entityId: mosRead.entityId,
              }
            : null;

    const tempSensors: TempReading[] = [];
    const tempCount = Math.min(Math.max(packConfig.tempSensorsCount ?? 0, 0), 4);
    for (let t = 1; t <= tempCount; t++) {
        const tRead = getNumericState(hass, packConfig, `temperature_sensor_${t}` as EntityKey);
        if (tRead.value !== null) {
            tempSensors.push({
                value: tRead.value,
                unit: tRead.unit || '°C',
                celsius: toCelsius(tRead.value, tRead.unit),
                label: `T${t}`,
                entityId: tRead.entityId,
            });
        }
    }

    let peakTemp: TempReading | null = mosTemp;
    for (const t of tempSensors) {
        if (!peakTemp || t.celsius > peakTemp.celsius) {
            peakTemp = t;
        }
    }

    const chargingFet = readFet(hass, packConfig, EntityKey.charging);
    const dischargingFet = readFet(hass, packConfig, EntityKey.discharging);
    const balancerFet = readFet(hass, packConfig, EntityKey.balancer);
    const heaterFet = isTruthyHeater(packConfig.hasHeater)
        ? readFet(hass, packConfig, EntityKey.heater)
        : { exists: false, isOn: false, isUnavailable: false, entityId: undefined };

    const isBalancing =
        balBinaryRead.state?.toLowerCase() === 'on' ||
        (balCurrentRead.value !== null && Math.abs(balCurrentRead.value) > 0.01) ||
        balancerMask !== 0n;

    // For presets with strictPackKeys (e.g. Seplos BLE), only pack-scoped telemetry counts toward pack availability.
    const isOnline =
        voltage !== null ||
        socRead.value !== null ||
        current !== null ||
        validCellCount > 0 ||
        mosTemp !== null ||
        tempSensors.length > 0;

    // Collect bank-level fallback readings for presets like Seplos V3 BLE when users haven't enabled
    // per-pack voltage/current/SoC sensors in ESPHome.
    let bankFallback: BankFallbackSource | undefined;
    if (preset.sharedPrefix) {
        const fbVoltageRead = readNumericFromCandidates(
            hass,
            bankLevelCandidateEntityIds(packConfig, EntityKey.total_voltage)
        );
        const fbCurrentRead = readNumericFromCandidates(
            hass,
            bankLevelCandidateEntityIds(packConfig, EntityKey.current)
        );
        const fbPowerRead = readNumericFromCandidates(hass, bankLevelCandidateEntityIds(packConfig, EntityKey.power));
        const fbSocRead = readNumericFromCandidates(
            hass,
            bankLevelCandidateEntityIds(packConfig, EntityKey.state_of_charge)
        );
        const fbVoltage = fbVoltageRead.value !== null ? toVolts(fbVoltageRead.value, fbVoltageRead.unit) : null;
        const fbCurrent = fbCurrentRead.value !== null ? toAmps(fbCurrentRead.value, fbCurrentRead.unit) : null;
        const fbPower = fbPowerRead.value !== null ? toWatts(fbPowerRead.value, fbPowerRead.unit) : null;

        bankFallback = {
            voltage: fbVoltage,
            voltageEntityId: fbVoltageRead.entityId,
            current: fbCurrent,
            currentEntityId: fbCurrentRead.entityId,
            power: fbPower,
            powerEntityId: fbPowerRead.entityId,
            soc: fbSocRead.value,
            socEntityId: fbSocRead.entityId,
            remainingAh: remainingRead.value,
            remainingAhEntityId: remainingRead.entityId,
            capacityAh: capacityRead.value,
            capacityAhEntityId: capacityRead.entityId,
        };
    }

    const primaryEntityForDevice =
        voltageRead.entityId ?? socRead.entityId ?? cells[0]?.voltageEntityId ?? mosRead.entityId ?? runtimeRead.entityId;
    const hassEntities = (hass as unknown as { entities?: Record<string, { device_id?: string }> })?.entities;
    const deviceId =
        packConfig.deviceId?.trim() ||
        packConfig.entities?.device_id?.toString()?.trim() ||
        (primaryEntityForDevice ? hassEntities?.[primaryEntityForDevice]?.device_id : undefined);

    return {
        key: stableKey,
        index,
        name: (typeof pack.name === 'string' && pack.name.trim()) || `Pack ${index + 1}`,
        prefix: packConfig.prefix,
        bmsModel: packConfig.bmsModel,
        packConfig,
        isOnline,
        soc: socRead.value,
        socEntityId: socRead.entityId,
        voltage,
        voltageEntityId: voltageRead.entityId,
        current,
        currentEntityId: currentRead.entityId,
        power,
        powerDerived,
        powerEntityId,
        powerSourceKey,
        remainingAh: remainingRead.value,
        remainingAhEntityId: remainingRead.entityId,
        capacityAh: capacityRead.value,
        capacityAhEntityId: capacityRead.entityId,
        bankFallback,
        cycles: cyclesRead.value,
        cyclesEntityId: cyclesRead.entityId,
        cycleCapacityAh: cycleCapRead.value,
        averageCellV,
        deltaV,
        deltaMv,
        deltaEntityId: deltaRead.entityId,
        minCellV,
        maxCellV,
        minCellId,
        maxCellId,
        balancingCurrent: balCurrentRead.value,
        balancingCurrentEntityId: balCurrentRead.entityId,
        isBalancing,
        balancerMask,
        mosTemp,
        tempSensors,
        peakTemp,
        fets: {
            charging: chargingFet,
            discharging: dischargingFet,
            balancer: balancerFet,
            heater: heaterFet,
        },
        errorMessage: parseErrorState(errorRead.state),
        errorEntityId: errorRead.entityId,
        runtime: runtimeRead.state,
        runtimeEntityId: runtimeRead.entityId,
        hardwareVersion: hwRead.state,
        softwareVersion: swRead.state,
        deviceId,
        navigationPath: typeof pack.navigationPath === 'string' ? pack.navigationPath.trim() || undefined : undefined,
        cells,
    };
};

interface SumResult {
    sum: number | null;
    coveredPackKeys: Set<string>;
}

const sumDeduplicatedWithCoverage = (
    items: Array<{ packKey: string; value: number | null; entityId?: string }>
): SumResult => {
    const seenEntityIds = new Set<string>();
    const coveredPackKeys = new Set<string>();
    let sum = 0;
    let count = 0;

    for (const item of items) {
        if (item.value === null || !Number.isFinite(item.value)) continue;
        coveredPackKeys.add(item.packKey);
        if (item.entityId) {
            if (seenEntityIds.has(item.entityId)) continue;
            seenEntityIds.add(item.entityId);
        }
        sum += item.value;
        count++;
    }

    return { sum: count > 0 ? sum : null, coveredPackKeys };
};

const setsEqual = (a: Set<string>, b: Set<string>): boolean => {
    if (a.size !== b.size) return false;
    for (const v of a) {
        if (!b.has(v)) return false;
    }
    return true;
};

// Pure bank aggregation for parallel battery banks (v1).
export const aggregateBankMetrics = (
    packs: PackSnapshot[],
    options: { deltaWarningMv?: number } = {}
): BankSnapshot => {
    const deltaWarningMv = options.deltaWarningMv ?? 30;
    const totalCount = packs.length;
    const onlinePacks = packs.filter(p => p.isOnline);
    const onlineCount = onlinePacks.length;
    const isPartial = onlineCount < totalCount;
    const allOnlineKeys = new Set(onlinePacks.map(p => p.key));

    // Resolve each online pack's bank-contribution current, power, voltage, SoC, remainingAh, capacityAh
    // falling back to shared bankFallback when pack-level sensors aren't exposed (e.g. Seplos BLE without pack V/I/SoC).
    const currentItems = onlinePacks.map(p => {
        if (p.current !== null) return { packKey: p.key, value: p.current, entityId: p.currentEntityId };
        if (p.bankFallback?.current !== undefined && p.bankFallback.current !== null) {
            return { packKey: p.key, value: p.bankFallback.current, entityId: p.bankFallback.currentEntityId };
        }
        return { packKey: p.key, value: null, entityId: undefined };
    });

    const currentRes = sumDeduplicatedWithCoverage(currentItems);
    const totalCurrent = currentRes.sum;

    // Power deduplication: prevent double-counting when packs share a current sensor or mix measured + derived power.
    const measuredPowerEntityIds = new Set<string>();
    const measuredCurrentEntityIds = new Set<string>();
    for (const p of onlinePacks) {
        if (p.power !== null && !p.powerDerived) {
            if (p.powerEntityId) measuredPowerEntityIds.add(p.powerEntityId);
            if (p.currentEntityId) measuredCurrentEntityIds.add(p.currentEntityId);
        }
    }

    const powerItems: Array<{ packKey: string; value: number | null; entityId?: string }> = [];
    for (const p of onlinePacks) {
        if (p.power !== null) {
            if (p.powerDerived && p.currentEntityId && measuredCurrentEntityIds.has(p.currentEntityId)) {
                // Another pack already contributed measured power for this electrical current source.
                continue;
            }
            const key = p.powerDerived
                ? p.currentEntityId
                    ? `cur:${p.currentEntityId}`
                    : undefined
                : p.powerEntityId;
            powerItems.push({ packKey: p.key, value: p.power, entityId: key });
        } else if (p.bankFallback?.power !== undefined && p.bankFallback.power !== null) {
            powerItems.push({ packKey: p.key, value: p.bankFallback.power, entityId: p.bankFallback.powerEntityId });
        } else if (
            p.bankFallback?.voltage !== undefined &&
            p.bankFallback.voltage !== null &&
            p.bankFallback?.current !== undefined &&
            p.bankFallback.current !== null
        ) {
            const curKey = p.bankFallback.currentEntityId ? `cur:${p.bankFallback.currentEntityId}` : undefined;
            powerItems.push({
                packKey: p.key,
                value: p.bankFallback.voltage * p.bankFallback.current,
                entityId: curKey,
            });
        }
    }
    const totalPower = sumDeduplicatedWithCoverage(powerItems).sum;

    const remainingRes = sumDeduplicatedWithCoverage(
        onlinePacks.map(p => ({ packKey: p.key, value: p.remainingAh, entityId: p.remainingAhEntityId }))
    );
    const capacityRes = sumDeduplicatedWithCoverage(
        onlinePacks.map(p => ({ packKey: p.key, value: p.capacityAh, entityId: p.capacityAhEntityId }))
    );

    const totalRemainingAh = remainingRes.sum;
    const totalCapacityAh = capacityRes.sum;

    // True only when both remainingAh and capacityAh cover every online pack (or match cleanly across the same set).
    const hasFullRemainingCoverage =
        onlineCount > 0 && setsEqual(remainingRes.coveredPackKeys, allOnlineKeys);
    const hasFullCapacityCoverage =
        onlineCount > 0 && setsEqual(capacityRes.coveredPackKeys, allOnlineKeys);
    const hasFullCurrentCoverage =
        onlineCount > 0 && setsEqual(currentRes.coveredPackKeys, allOnlineKeys);

    // Weighted SoC: Σ(soc_i * cap_i) / Σ cap_i across online packs with valid SoC (deduped by socEntityId).
    // Falls back to equal weights if any pack lacks valid positive distinct capacity.
    const socSeen = new Set<string>();
    const socEntries: Array<{ soc: number; capacityAh: number | null; capacityEntityId?: string }> = [];
    for (const p of onlinePacks) {
        const effectiveSoc = p.soc !== null ? p.soc : (p.bankFallback?.soc ?? null);
        const effectiveSocId = p.soc !== null ? p.socEntityId : p.bankFallback?.socEntityId;
        if (effectiveSoc === null || !Number.isFinite(effectiveSoc)) continue;
        if (effectiveSocId) {
            if (socSeen.has(effectiveSocId)) continue;
            socSeen.add(effectiveSocId);
        }
        socEntries.push({
            soc: effectiveSoc,
            capacityAh: p.capacityAh,
            capacityEntityId: p.capacityAhEntityId,
        });
    }

    let soc: number | null = null;
    if (socEntries.length > 0) {
        const capIds = new Set<string>();
        let allHaveDistinctCap = true;
        for (const entry of socEntries) {
            if (entry.capacityAh === null || entry.capacityAh <= 0) {
                allHaveDistinctCap = false;
                break;
            }
            if (entry.capacityEntityId) {
                if (capIds.has(entry.capacityEntityId)) {
                    allHaveDistinctCap = false;
                    break;
                }
                capIds.add(entry.capacityEntityId);
            }
        }

        if (allHaveDistinctCap) {
            let weightedSum = 0;
            let capSum = 0;
            for (const entry of socEntries) {
                weightedSum += entry.soc * (entry.capacityAh as number);
                capSum += entry.capacityAh as number;
            }
            soc = capSum > 0 ? weightedSum / capSum : null;
        } else {
            const sumSoc = socEntries.reduce((acc, entry) => acc + entry.soc, 0);
            soc = sumSoc / socEntries.length;
        }
    }

    // Bank voltage (deduplicated across distinct voltage sources) + inter-pack spread
    const seenVoltIds = new Set<string>();
    const distinctVoltages: number[] = [];
    for (const p of onlinePacks) {
        const v = p.voltage !== null ? p.voltage : (p.bankFallback?.voltage ?? null);
        const vId = p.voltage !== null ? p.voltageEntityId : p.bankFallback?.voltageEntityId;
        if (v === null || !Number.isFinite(v)) continue;
        if (vId) {
            if (seenVoltIds.has(vId)) continue;
            seenVoltIds.add(vId);
        }
        distinctVoltages.push(v);
    }
    const avgVoltage =
        distinctVoltages.length > 0
            ? distinctVoltages.reduce((a, b) => a + b, 0) / distinctVoltages.length
            : null;
    const voltageSpreadV =
        distinctVoltages.length >= 2
            ? Math.max(...distinctVoltages) - Math.min(...distinctVoltages)
            : null;

    // Worst cell delta (normalized to mV)
    let worstDelta: BankWorstDelta | null = null;
    for (const p of onlinePacks) {
        if (p.deltaMv === null || !Number.isFinite(p.deltaMv)) continue;
        if (!worstDelta || p.deltaMv > worstDelta.deltaMv) {
            worstDelta = {
                deltaMv: p.deltaMv,
                deltaV: p.deltaMv / 1000,
                packName: p.name,
                minCellId: p.minCellId,
                maxCellId: p.maxCellId,
                entityId: p.deltaEntityId,
                isWarning: p.deltaMv >= deltaWarningMv,
            };
        }
    }

    // Peak temperature (compared in °C, displayed in source unit)
    let peakTemp: BankPeakTemp | null = null;
    for (const p of onlinePacks) {
        if (!p.peakTemp) continue;
        if (!peakTemp || p.peakTemp.celsius > peakTemp.celsius) {
            peakTemp = {
                value: p.peakTemp.value,
                unit: p.peakTemp.unit,
                celsius: p.peakTemp.celsius,
                packName: p.name,
                label: p.peakTemp.label,
                entityId: p.peakTemp.entityId,
            };
        }
    }

    // Bank-wide min/max cell voltage
    let minCell: BankCellExtreme | null = null;
    let maxCell: BankCellExtreme | null = null;
    for (const p of onlinePacks) {
        if (p.minCellV !== null && (!minCell || p.minCellV < minCell.voltageV)) {
            minCell = { voltageV: p.minCellV, packName: p.name, cellId: p.minCellId };
        }
        if (p.maxCellV !== null && (!maxCell || p.maxCellV > maxCell.voltageV)) {
            maxCell = { voltageV: p.maxCellV, packName: p.name, cellId: p.maxCellId };
        }
    }

    const balancingPackCount = onlinePacks.filter(p => p.isBalancing).length;

    // Dedupe errorCount by errorEntityId so a shared Seplos problem_code isn't counted N times.
    const seenErrorIds = new Set<string>();
    let errorCount = 0;
    for (const p of packs) {
        if (p.errorMessage === null) continue;
        if (p.errorEntityId) {
            if (seenErrorIds.has(p.errorEntityId)) continue;
            seenErrorIds.add(p.errorEntityId);
        }
        errorCount++;
    }
    const hasFault = errorCount > 0;

    // Bank-scaled current deadband so idle jitter doesn't flip state or flicker ETA
    const currentDeadbandA = Math.max(0.5, (totalCapacityAh ?? 0) * 0.002);

    let status: BankStatus;
    if (onlineCount === 0) {
        status = 'offline';
    } else if (totalCurrent !== null && totalCurrent > currentDeadbandA) {
        status = 'charging';
    } else if (totalCurrent !== null && totalCurrent < -currentDeadbandA) {
        status = 'discharging';
    } else {
        status = 'idle';
    }

    // Only compute kWh when remaining/capacity cover all online packs cleanly
    const remainingKwh =
        hasFullRemainingCoverage && totalRemainingAh !== null && avgVoltage !== null
            ? (totalRemainingAh * avgVoltage) / 1000
            : null;
    const totalKwh =
        hasFullCapacityCoverage && totalCapacityAh !== null && avgVoltage !== null
            ? (totalCapacityAh * avgVoltage) / 1000
            : null;

    // Require matching full coverage across online packs before reporting ETA
    let etaHours: number | null = null;
    if (
        status === 'charging' &&
        hasFullCurrentCoverage &&
        hasFullRemainingCoverage &&
        hasFullCapacityCoverage &&
        totalCurrent !== null &&
        totalCapacityAh !== null &&
        totalRemainingAh !== null
    ) {
        const headroomAh = Math.max(totalCapacityAh - totalRemainingAh, 0);
        const h = headroomAh / totalCurrent;
        if (Number.isFinite(h) && h > 0 && h <= 999) {
            etaHours = h;
        }
    } else if (
        status === 'discharging' &&
        hasFullCurrentCoverage &&
        hasFullRemainingCoverage &&
        totalCurrent !== null &&
        totalRemainingAh !== null
    ) {
        const h = Math.max(totalRemainingAh, 0) / Math.abs(totalCurrent);
        if (Number.isFinite(h) && h > 0 && h <= 999) {
            etaHours = h;
        }
    }

    return {
        status,
        totalCount,
        onlineCount,
        isPartial,
        soc,
        avgVoltage,
        voltageSpreadV,
        totalCurrent,
        totalPower,
        totalRemainingAh,
        totalCapacityAh,
        hasFullCapacityCoverage: hasFullRemainingCoverage && hasFullCapacityCoverage,
        remainingKwh,
        totalKwh,
        currentDeadbandA,
        etaHours,
        worstDelta,
        peakTemp,
        minCell,
        maxCell,
        balancingPackCount,
        errorCount,
        hasFault,
        packs,
    };
};

export const formatEta = (hours: number | null): string => {
    if (hours === null || !Number.isFinite(hours) || hours <= 0) return '';
    const totalMinutes = Math.round(hours * 60);
    if (totalMinutes < 1) return '<1m';
    const d = Math.floor(totalMinutes / (60 * 24));
    const h = Math.floor((totalMinutes % (60 * 24)) / 60);
    const m = totalMinutes % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};
