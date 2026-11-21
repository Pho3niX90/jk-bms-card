import { HomeAssistant } from 'custom-card-helpers';
import { EntityKey } from '../const';
import { ExtraEntityKey, JkBmsCardConfig, JkBmsPackConfig } from '../interfaces';
import {
    candidateEntityIds,
    EntityDomain,
    getNumericState,
    getRawState,
    isCellBalancingFromMask,
    parseBalancerBitmask,
    toCelsius,
    toMillivolts,
    toVolts,
} from './utils';

export interface FetState {
    exists: boolean;
    isOn: boolean;
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
    remainingAh: number | null;
    remainingAhEntityId?: string;
    capacityAh: number | null;
    capacityAhEntityId?: string;
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

const isTruthyHeater = (val: unknown): boolean => val === true || val === 1 || val === '1';

export const computeStablePackKeys = (packs: JkBmsPackConfig[]): string[] => {
    const counts = new Map<string, number>();
    return packs.map(pack => {
        const base =
            pack.id?.trim() ||
            `${pack.prefix ?? ''}|${pack.packIndex ?? pack.batteryNumber ?? ''}|${pack.name ?? ''}`;
        const seen = (counts.get(base) ?? 0) + 1;
        counts.set(base, seen);
        return seen === 1 ? base : `${base}#${seen}`;
    });
};

export const resolveEffectivePacks = (
    rootConfig: JkBmsCardConfig
): { packs: JkBmsPackConfig[]; isFallback: boolean } => {
    if (Array.isArray(rootConfig.packs) && rootConfig.packs.length > 0) {
        return { packs: rootConfig.packs, isFallback: false };
    }

    const fallback: JkBmsPackConfig = {
        id: 'root-fallback-pack',
        name: rootConfig.batteryName?.trim() || undefined,
        prefix: rootConfig.prefix ?? '',
        bmsModel: rootConfig.bmsModel,
        packIndex: rootConfig.packIndex ?? rootConfig.batteryNumber ?? 1,
        batteryNumber: rootConfig.batteryNumber,
        cellCount: rootConfig.cellCount,
        tempSensorsCount: rootConfig.tempSensorsCount,
        hasHeater: isTruthyHeater(rootConfig.hasHeater),
        deviceId: rootConfig.deviceId,
        entities: rootConfig.entities,
        cells: rootConfig.cells,
        cellResistances: rootConfig.cellResistances,
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
    const hasHeater = pack.hasHeater !== undefined ? Boolean(pack.hasHeater) : isTruthyHeater(rootConfig.hasHeater);

    return {
        type: rootConfig.type,
        title: pack.name ?? rootConfig.title,
        bmsModel: pack.bmsModel ?? rootConfig.bmsModel,
        prefix: pack.prefix ?? '',
        batteryName: pack.name,
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
            ? (pack.cellResistances ?? rootConfig.cellResistances)
            : pack.cellResistances,
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

const readFet = (
    hass: HomeAssistant,
    packConfig: JkBmsCardConfig,
    key: EntityKey
): FetState => {
    const reading = getRawState(hass, packConfig, key, 'switch');
    return {
        exists: reading.exists,
        isOn: reading.state?.toLowerCase() === 'on',
        entityId: reading.entityId,
    };
};

const parseErrorState = (state: string | null): string | null => {
    if (state === null) return null;
    const trimmed = state.trim();
    if (NON_ERROR_STRINGS.has(trimmed.toLowerCase())) return null;
    return trimmed;
};

export const readPackSnapshot = (
    hass: HomeAssistant,
    rootConfig: JkBmsCardConfig,
    pack: JkBmsPackConfig,
    index: number,
    stableKey: string,
    isFallbackSinglePack = false
): PackSnapshot => {
    const packConfig = buildPackConfig(rootConfig, pack, index, isFallbackSinglePack);
    const cellCount = Math.min(Math.max(packConfig.cellCount ?? 16, 0), 96);

    const voltageRead = getNumericState(hass, packConfig, EntityKey.total_voltage);
    const currentRead = getNumericState(hass, packConfig, EntityKey.current);
    const powerRead = getNumericState(hass, packConfig, EntityKey.power);
    const socRead = getNumericState(hass, packConfig, EntityKey.state_of_charge);
    const remainingRead = getNumericState(hass, packConfig, EntityKey.capacity_remaining);
    const capacityRead = getNumericState(hass, packConfig, EntityKey.total_battery_capacity_setting);
    const cyclesRead = getNumericState(hass, packConfig, EntityKey.charging_cycles);
    const cycleCapRead = getNumericState(hass, packConfig, EntityKey.total_charging_cycle_capacity);
    const avgCellRead = getNumericState(hass, packConfig, EntityKey.average_cell_voltage);
    const deltaRead = getNumericState(hass, packConfig, EntityKey.delta_cell_voltage);
    const minCellVRead = getNumericState(hass, packConfig, EntityKey.min_cell_voltage);
    const maxCellVRead = getNumericState(hass, packConfig, EntityKey.max_cell_voltage);
    const minCellIdRead = getNumericState(hass, packConfig, EntityKey.min_voltage_cell);
    const maxCellIdRead = getNumericState(hass, packConfig, EntityKey.max_voltage_cell);
    const balCurrentRead = getNumericState(hass, packConfig, EntityKey.balancing_current);
    const balBinaryRead = getRawState(hass, packConfig, EntityKey.balancing, 'binary_sensor');
    const errorRead = getRawState(hass, packConfig, EntityKey.errors);
    const runtimeRead = getRawState(hass, packConfig, EntityKey.total_runtime_formatted);
    const hwRead = getRawState(hass, packConfig, EntityKey.hardware_version);
    const swRead = getRawState(hass, packConfig, EntityKey.software_version);

    const voltage = voltageRead.value !== null ? toVolts(voltageRead.value, voltageRead.unit) : null;
    const current = currentRead.value;

    let power = powerRead.value;
    let powerDerived = false;
    let powerEntityId = powerRead.entityId;
    if (power === null && voltage !== null && current !== null) {
        power = voltage * current;
        powerDerived = true;
        if (currentRead.entityId) {
            powerEntityId = `derived:${voltageRead.entityId ?? ''}:${currentRead.entityId}`;
        }
    }

    const balancerMask = parseBalancerBitmask(hass, packConfig);

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
        const rRead = packConfig.showResistances
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

    const minCellId = sensorMinId ?? dynMinId;
    const maxCellId = sensorMaxId ?? dynMaxId;

    const sensorMinV = minCellVRead.value !== null ? toVolts(minCellVRead.value, minCellVRead.unit) : null;
    const sensorMaxV = maxCellVRead.value !== null ? toVolts(maxCellVRead.value, maxCellVRead.unit) : null;

    const minCellV = sensorMinV !== null && sensorMinV > 0 ? sensorMinV : dynMinV !== Infinity ? dynMinV : null;
    const maxCellV = sensorMaxV !== null && sensorMaxV > 0 ? sensorMaxV : dynMaxV !== -Infinity ? dynMaxV : null;

    const sensorDeltaMv =
        deltaRead.value !== null && deltaRead.value >= 0
            ? toMillivolts(deltaRead.value, deltaRead.unit)
            : null;
    const dynDeltaMv = validCellCount >= 2 ? Math.round(Math.max(0, (dynMaxV - dynMinV) * 1000) * 1000) / 1000 : null;
    const deltaMv =
        sensorDeltaMv !== null && (sensorDeltaMv > 0 || dynDeltaMv === null) ? sensorDeltaMv : dynDeltaMv;
    const deltaV = deltaMv !== null ? deltaMv / 1000 : null;

    const sensorAvgV = avgCellRead.value !== null ? toVolts(avgCellRead.value, avgCellRead.unit) : null;
    const averageCellV =
        sensorAvgV !== null && sensorAvgV > 0 ? sensorAvgV : validCellCount > 0 ? cellSum / validCellCount : null;

    // Mark min/max cells
    if (minCellId !== null || maxCellId !== null) {
        for (const cell of cells) {
            cell.isMin = minCellId !== null && cell.index === minCellId;
            cell.isMax = maxCellId !== null && cell.index === maxCellId;
        }
    }

    // Temperatures (compare in °C, keep display value & unit)
    const mosRead = getNumericState(hass, packConfig, EntityKey.power_tube_temperature);
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
        : { exists: false, isOn: false, entityId: undefined };

    const isBalancing =
        balBinaryRead.state?.toLowerCase() === 'on' ||
        (balCurrentRead.value !== null && Math.abs(balCurrentRead.value) > 0.01) ||
        balancerMask !== 0n;

    const isOnline = voltage !== null || socRead.value !== null || validCellCount > 0;

    const primaryEntityForDevice = voltageRead.entityId ?? socRead.entityId ?? runtimeRead.entityId;
    const hassEntities = (hass as unknown as { entities?: Record<string, { device_id?: string }> })?.entities;
    const deviceId =
        packConfig.deviceId?.trim() ||
        packConfig.entities?.device_id?.toString()?.trim() ||
        (primaryEntityForDevice ? hassEntities?.[primaryEntityForDevice]?.device_id : undefined);

    return {
        key: stableKey,
        index,
        name: pack.name?.trim() || `Pack ${index + 1}`,
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
        remainingAh: remainingRead.value,
        remainingAhEntityId: remainingRead.entityId,
        capacityAh: capacityRead.value,
        capacityAhEntityId: capacityRead.entityId,
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
        navigationPath: pack.navigationPath?.trim() || undefined,
        cells,
    };
};

const sumDeduplicated = (items: Array<{ value: number | null; entityId?: string }>): number | null => {
    const seen = new Set<string>();
    let sum = 0;
    let count = 0;

    for (const item of items) {
        if (item.value === null || !Number.isFinite(item.value)) continue;
        if (item.entityId) {
            if (seen.has(item.entityId)) continue;
            seen.add(item.entityId);
        }
        sum += item.value;
        count++;
    }

    return count > 0 ? sum : null;
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

    // Deduplicated parallel sums (prevents shared bank-level sensors like Seplos V3 BLE from being counted N times)
    const totalCurrent = sumDeduplicated(onlinePacks.map(p => ({ value: p.current, entityId: p.currentEntityId })));
    const totalPower = sumDeduplicated(onlinePacks.map(p => ({ value: p.power, entityId: p.powerEntityId })));
    const totalRemainingAh = sumDeduplicated(
        onlinePacks.map(p => ({ value: p.remainingAh, entityId: p.remainingAhEntityId }))
    );
    const totalCapacityAh = sumDeduplicated(
        onlinePacks.map(p => ({ value: p.capacityAh, entityId: p.capacityAhEntityId }))
    );

    // Weighted SoC: Σ(soc_i * cap_i) / Σ cap_i across online packs with valid SoC (deduped by socEntityId).
    // Falls back to equal weights if any pack lacks valid positive capacity or shares a capacity entity.
    const socSeen = new Set<string>();
    const socEntries: PackSnapshot[] = [];
    for (const p of onlinePacks) {
        if (p.soc === null || !Number.isFinite(p.soc)) continue;
        if (p.socEntityId) {
            if (socSeen.has(p.socEntityId)) continue;
            socSeen.add(p.socEntityId);
        }
        socEntries.push(p);
    }

    let soc: number | null = null;
    if (socEntries.length > 0) {
        const capIds = new Set<string>();
        let allHaveDistinctCap = true;
        for (const p of socEntries) {
            if (p.capacityAh === null || p.capacityAh <= 0) {
                allHaveDistinctCap = false;
                break;
            }
            if (p.capacityAhEntityId) {
                if (capIds.has(p.capacityAhEntityId)) {
                    allHaveDistinctCap = false;
                    break;
                }
                capIds.add(p.capacityAhEntityId);
            }
        }

        if (allHaveDistinctCap) {
            let weightedSum = 0;
            let capSum = 0;
            for (const p of socEntries) {
                weightedSum += (p.soc as number) * (p.capacityAh as number);
                capSum += p.capacityAh as number;
            }
            soc = capSum > 0 ? weightedSum / capSum : null;
        } else {
            const sumSoc = socEntries.reduce((acc, p) => acc + (p.soc as number), 0);
            soc = sumSoc / socEntries.length;
        }
    }

    // Bank voltage (mean across online packs with distinct/valid voltage) + inter-pack spread
    const voltages = onlinePacks
        .map(p => p.voltage)
        .filter((v): v is number => v !== null && Number.isFinite(v));
    const avgVoltage = voltages.length > 0 ? voltages.reduce((a, b) => a + b, 0) / voltages.length : null;
    const voltageSpreadV =
        voltages.length >= 2 ? Math.max(...voltages) - Math.min(...voltages) : voltages.length === 1 ? 0 : null;

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
    const errorCount = packs.filter(p => p.errorMessage !== null).length;
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

    const remainingKwh =
        totalRemainingAh !== null && avgVoltage !== null ? (totalRemainingAh * avgVoltage) / 1000 : null;
    const totalKwh =
        totalCapacityAh !== null && avgVoltage !== null ? (totalCapacityAh * avgVoltage) / 1000 : null;

    let etaHours: number | null = null;
    if (status === 'charging' && totalCurrent !== null && totalCapacityAh !== null && totalRemainingAh !== null) {
        const headroomAh = Math.max(totalCapacityAh - totalRemainingAh, 0);
        const h = headroomAh / totalCurrent;
        if (Number.isFinite(h) && h > 0 && h <= 999) {
            etaHours = h;
        }
    } else if (status === 'discharging' && totalCurrent !== null && totalRemainingAh !== null) {
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
