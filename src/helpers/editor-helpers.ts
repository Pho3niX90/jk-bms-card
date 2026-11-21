import { HomeAssistant } from 'custom-card-helpers';
import { ExtraEntityKey, JkBmsCardConfig, JkBmsPackConfig } from '../interfaces';
import { EntityKey } from '../const';
import { applyPackModelDefaults, BMS_PRESETS, BmsModel, getPreset, STOCK_PREFIXES } from '../presets';
import { isTruthyHeater } from './bank-metrics';

const PRIORITY_SENSOR_SUFFIXES = [
    '_total_voltage',
    '_state_of_charge',
    '_delta_cell_voltage',
    '_delta_voltage',
    '_cell_voltage_1',
    '_pack_0_cell_1_voltage',
    '_pack_0_voltage',
    '_mosfet_temperature',
    '_power_tube_temperature',
];

const PACK_NUMBERED_SUFFIX_RE = /_pack_\d+_(?:voltage|current|battery_level|cycles|mosfet_temperature|temperature_\d+|cell_\d+_voltage)$/;
const TRAILING_PACK_RE = /_pack_\d+$/;

export const generatePackId = (existing: JkBmsPackConfig[]): string => {
    const used = new Set(existing.map(p => p.id).filter((id): id is string => Boolean(id)));
    let n = existing.length + 1;
    while (used.has(`pack_${n}`)) {
        n++;
    }
    return `pack_${n}`;
};

// Pick the lowest unused 1-based packIndex among packs sharing the same effective model & prefix.
export const nextUnusedPackIndex = (
    packs: JkBmsPackConfig[],
    effectiveModel: BmsModel | undefined,
    prefix: string,
    defaultModel: BmsModel | undefined
): number => {
    const normPrefix = prefix.trim();
    const used = new Set<number>();
    packs.forEach((p, i) => {
        const pModel = p.bmsModel ?? defaultModel ?? 'jk';
        if (pModel === (effectiveModel ?? defaultModel ?? 'jk') && (p.prefix?.trim() ?? '') === normPrefix) {
            const idx = p.packIndex ?? p.batteryNumber ?? i + 1;
            if (Number.isInteger(idx) && idx >= 1) {
                used.add(idx);
            }
        }
    });
    let candidate = 1;
    while (used.has(candidate)) {
        candidate++;
    }
    return candidate;
};

// Suggest a non-colliding next prefix. For shared-prefix models (e.g. Seplos BLE), keep the shared prefix.
export const suggestNextPrefix = (
    existing: JkBmsPackConfig[],
    rootConfig: JkBmsCardConfig,
    effectiveModel?: BmsModel
): string => {
    const preset = getPreset({ bmsModel: effectiveModel ?? rootConfig.bmsModel });
    const last = existing[existing.length - 1]?.prefix?.trim();

    if (preset.sharedPrefix) {
        return last || rootConfig.prefix?.trim() || preset.packDefaults.prefix || 'seplos_bms_v3_ble';
    }

    const usedPrefixes = new Set(existing.map(p => p.prefix?.trim()).filter(Boolean));
    const base = last || rootConfig.prefix?.trim() || preset.packDefaults.prefix || 'jk_bms';

    // Only increment a trailing index separated by _ or - or a short trailing 1-2 digit suffix (avoiding version strings like v19).
    const sepMatch = base.match(/^(.*?[_-])(\d+)$/);
    if (sepMatch) {
        let num = Number(sepMatch[2]) + 1;
        let candidate = `${sepMatch[1]}${num}`;
        while (usedPrefixes.has(candidate)) {
            num++;
            candidate = `${sepMatch[1]}${num}`;
        }
        return candidate;
    }

    let suffix = existing.length + 1;
    let candidate = `${base}_${suffix}`;
    while (usedPrefixes.has(candidate)) {
        suffix++;
        candidate = `${base}_${suffix}`;
    }
    return candidate;
};

// Seed Pack 1 from root config when transitioning from zero-config fallback to explicit packs[],
// preserving manual entity overrides, cell arrays, legacy cell_resistances, and cell prefixes.
export const seedFirstPackFromRoot = (rootConfig: JkBmsCardConfig): JkBmsPackConfig => {
    const entities: Partial<Record<EntityKey | ExtraEntityKey, string>> = {};
    if (rootConfig.entities) {
        for (const [k, v] of Object.entries(rootConfig.entities)) {
            const trimmed = v?.toString()?.trim();
            if (trimmed && trimmed.length > 1) {
                entities[k as EntityKey | ExtraEntityKey] = trimmed;
            }
        }
    }

    const legacyResistances = (rootConfig as Record<string, unknown>)?.cell_resistances as string[] | undefined;
    const cellResistances = rootConfig.cellResistances ?? legacyResistances;

    const seeded: JkBmsPackConfig = {
        id: 'pack_1',
        name: rootConfig.batteryName?.trim() || 'Pack 1',
        prefix: rootConfig.prefix?.trim() || 'jk_bms',
        bmsModel: rootConfig.bmsModel,
        packIndex: rootConfig.packIndex ?? rootConfig.batteryNumber ?? 1,
        cellCount: rootConfig.cellCount,
        tempSensorsCount: rootConfig.tempSensorsCount,
        hasHeater: isTruthyHeater(rootConfig.hasHeater),
    };

    if (rootConfig.deviceId?.trim()) seeded.deviceId = rootConfig.deviceId.trim();
    if (Object.keys(entities).length > 0) seeded.entities = entities;
    if (Array.isArray(rootConfig.cells) && rootConfig.cells.length > 0) seeded.cells = [...rootConfig.cells];
    if (Array.isArray(cellResistances) && cellResistances.length > 0) {
        seeded.cellResistances = [...cellResistances];
    }
    if (rootConfig.cellPrefix?.trim()) seeded.cellPrefix = rootConfig.cellPrefix.trim();
    if (rootConfig.cellResistancePrefix?.trim()) {
        seeded.cellResistancePrefix = rootConfig.cellResistancePrefix.trim();
    }

    return seeded;
};

export const addPackToConfig = (rootConfig: JkBmsCardConfig): { config: JkBmsCardConfig; newIndex: number } => {
    const currentPacks = Array.isArray(rootConfig.packs) ? [...rootConfig.packs] : [];

    if (currentPacks.length === 0 && (rootConfig.prefix?.trim() || rootConfig.cells?.length)) {
        currentPacks.push(seedFirstPackFromRoot(rootConfig));
    }

    const lastPack = currentPacks[currentPacks.length - 1];
    const nextModel = lastPack?.bmsModel;
    const effectiveModel = nextModel ?? rootConfig.bmsModel;
    const nextPrefix = suggestNextPrefix(currentPacks, rootConfig, effectiveModel);
    const packIndex = nextUnusedPackIndex(currentPacks, nextModel, nextPrefix, rootConfig.bmsModel);

    const nextPack: JkBmsPackConfig = {
        id: generatePackId(currentPacks),
        name: `Pack ${currentPacks.length + 1}`,
        prefix: nextPrefix,
        ...(nextModel ? { bmsModel: nextModel } : {}),
        packIndex,
    };

    currentPacks.push(nextPack);
    return {
        config: { ...rootConfig, packs: currentPacks },
        newIndex: currentPacks.length - 1,
    };
};

// Infer BMS entity prefix from a Home Assistant device ID by matching BMS suffixes
// (including numbered Seplos BLE pack suffixes) and ranking candidates by agreement count.
export const inferPrefixFromDevice = (hass: HomeAssistant | undefined, deviceId: string): string | undefined => {
    const entities = (hass as unknown as { entities?: Record<string, { device_id?: string }> })?.entities;
    if (!entities || !deviceId) return undefined;

    const deviceObjectIds: string[] = [];
    for (const [entityId, meta] of Object.entries(entities)) {
        if (meta?.device_id !== deviceId) continue;
        const dotIdx = entityId.indexOf('.');
        if (dotIdx !== -1) {
            deviceObjectIds.push(entityId.slice(dotIdx + 1));
        }
    }
    if (deviceObjectIds.length === 0) return undefined;

    const scores = new Map<string, number>();
    const addCandidate = (raw: string, weight: number) => {
        const cleaned = raw.replace(TRAILING_PACK_RE, '').trim();
        if (!cleaned) return;
        scores.set(cleaned, (scores.get(cleaned) ?? 0) + weight);
    };

    for (const objectId of deviceObjectIds) {
        const packMatch = objectId.match(PACK_NUMBERED_SUFFIX_RE);
        if (packMatch && packMatch.index !== undefined && packMatch.index > 0) {
            addCandidate(objectId.slice(0, packMatch.index), 2);
            continue;
        }
        for (let i = 0; i < PRIORITY_SENSOR_SUFFIXES.length; i++) {
            const suffix = PRIORITY_SENSOR_SUFFIXES[i];
            if (objectId.endsWith(suffix)) {
                const candidate = objectId.slice(0, -suffix.length);
                if (candidate.length > 0) {
                    // Earlier priority suffixes get slightly higher tie-break weight
                    addCandidate(candidate, 2 + (PRIORITY_SENSOR_SUFFIXES.length - i) * 0.01);
                }
                break;
            }
        }
    }

    let best: string | undefined;
    let bestScore = -1;
    for (const [candidate, score] of scores.entries()) {
        // Bonus for every entity on this device that starts with `${candidate}_`
        const prefixMatches = deviceObjectIds.filter(id => id.startsWith(`${candidate}_`)).length;
        const total = score + prefixMatches;
        if (total > bestScore) {
            bestScore = total;
            best = candidate;
        }
    }

    return best;
};

export const shouldApplyInferredPrefix = (
    currentPrefix: string | undefined,
    existingPacks: JkBmsPackConfig[],
    rootConfig: JkBmsCardConfig,
    packIndex: number
): boolean => {
    const trimmed = currentPrefix?.trim() ?? '';
    if (!trimmed) return true;
    if (STOCK_PREFIXES.includes(trimmed)) return true;
    const priorPacks = existingPacks.slice(0, packIndex);
    const autoSuggested = suggestNextPrefix(priorPacks, rootConfig, existingPacks[packIndex]?.bmsModel);
    return trimmed === autoSuggested;
};

export const applyPackEdit = (
    rootConfig: JkBmsCardConfig,
    index: number,
    incoming: Record<string, unknown>,
    hass?: HomeAssistant
): JkBmsCardConfig => {
    const currentPacks = Array.isArray(rootConfig.packs) ? rootConfig.packs : [];
    const prevPack = currentPacks[index];
    if (!prevPack) return rootConfig;

    let updated: JkBmsPackConfig = { ...prevPack, ...(incoming as Partial<JkBmsPackConfig>) };

    if (incoming.bmsModel === '__inherit__') {
        delete updated.bmsModel;
    } else if (updated.bmsModel && updated.bmsModel !== prevPack.bmsModel) {
        updated = applyPackModelDefaults(updated, prevPack.bmsModel);
    }

    if (typeof incoming.deviceId === 'string' && incoming.deviceId && incoming.deviceId !== prevPack.deviceId) {
        const inferred = inferPrefixFromDevice(hass, incoming.deviceId);
        if (inferred && shouldApplyInferredPrefix(updated.prefix, currentPacks, rootConfig, index)) {
            updated = { ...updated, prefix: inferred };
        }
    }

    const nextPacks = currentPacks.map((p, i) => (i === index ? updated : p));
    return { ...rootConfig, packs: nextPacks };
};

// Normalize dependent show/hide flags while preserving explicit false values when parent flags are omitted
// (since stub defaults for showMain and showCells are true).
export const normalizeShowHideFlags = (config: JkBmsCardConfig): JkBmsCardConfig => {
    const next = { ...config };
    const layout = next.layout ?? 'default';
    const effectiveShowMain = next.showMain !== false;
    const effectiveShowCells = next.showCells !== false;

    const supportsMainStats = layout === 'core-reactor' || layout === 'bank-overview';
    if (!supportsMainStats || !effectiveShowMain) {
        if (next.showMainStats !== undefined && !supportsMainStats) {
            delete next.showMainStats;
        }
    }

    if (!effectiveShowCells && next.showResistances === undefined) {
        // Leave omitted child untouched; preserve explicit false/true values.
    }

    return next;
};

export const buildPackFormSchema = (
    modelOptions: Array<{ label: string; value: string }>
): Array<Record<string, unknown>> => [
    {
        type: 'grid',
        column_min_width: '180px',
        schema: [
            { name: 'name', selector: { text: {} } },
            { name: 'prefix', selector: { text: {} } },
        ],
    },
    {
        type: 'grid',
        column_min_width: '180px',
        schema: [
            {
                name: 'bmsModel',
                selector: {
                    select: {
                        mode: 'dropdown',
                        options: modelOptions,
                    },
                },
            },
            {
                name: 'packIndex',
                selector: {
                    number: { min: 1, max: 16, step: 1, mode: 'box' },
                },
            },
        ],
    },
    {
        type: 'grid',
        column_min_width: '180px',
        schema: [
            { name: 'deviceId', selector: { device: {} } },
            { name: 'navigationPath', selector: { text: {} } },
        ],
    },
    {
        type: 'grid',
        column_min_width: '140px',
        schema: [
            {
                name: 'cellCount',
                selector: {
                    number: { min: 2, max: 48, step: 1, mode: 'box' },
                },
            },
            {
                name: 'tempSensorsCount',
                selector: {
                    number: { min: 0, max: 4, step: 1, mode: 'box' },
                },
            },
            { name: 'hasHeater', selector: { boolean: {} } },
        ],
    },
];

export const getBmsModelOptions = (inheritLabel: string): Array<{ label: string; value: string }> => [
    { label: inheritLabel, value: '__inherit__' },
    ...Object.entries(BMS_PRESETS).map(([value, preset]) => ({ label: preset.label, value })),
];
