import { EntityKey } from './const';
import { JkBmsCardConfig, JkBmsPackConfig } from './interfaces';

export type BmsModel = 'jk' | 'seplos_v3_modbus' | 'seplos_v3_ble';

export interface BmsPreset {
    label: string;
    // Whether multiple packs of this model typically share one ESPHome prefix and distinguish packs by packIndex.
    sharedPrefix?: boolean;
    // Card config defaults applied when the model is picked in the root editor.
    defaults: Partial<JkBmsCardConfig>;
    // Pack-scoped defaults applied when a pack's model is switched in bank-overview.
    packDefaults: Partial<JkBmsPackConfig>;
    // EntityKey -> entity suffix, or a full entity id when it contains a dot.
    // Supports {prefix} and {pack} ((packIndex ?? batteryNumber ?? 1) - 1) placeholders.
    // An empty string means the BMS has no such entity (suppresses aliases & legacy fallback).
    entities: Partial<Record<EntityKey, string>>;
    // Keys whose upstream ESPHome sensors are bank-wide rather than pack-specific.
    // In bank-overview, pack rows avoid attributing bank-wide values to a disconnected pack.
    bankScopedKeys?: EntityKey[];
    // Keys that have dedicated pack-scoped sensors; in multi-pack bank-overview, packs must not
    // silently fall back to bank-wide legacy names when the pack-scoped entity is absent/unavailable.
    strictPackKeys?: EntityKey[];
}

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

const map = (count: number, key: (i: number) => string, value: (i: number) => string) =>
    Object.fromEntries(range(count).map(i => [key(i), value(i)])) as Partial<Record<EntityKey, string>>;

// Entity names from https://github.com/syssi/esphome-seplos-bms
export const BMS_PRESETS: Record<BmsModel, BmsPreset> = {
    jk: {
        label: 'JK BMS',
        defaults: { prefix: 'jk_bms' },
        packDefaults: { prefix: 'jk_bms' },
        entities: {},
    },
    // esp32-seplos-v3-example.yaml (RS485 / modbus_controller)
    seplos_v3_modbus: {
        label: 'Seplos V3 (RS485 / Modbus)',
        defaults: { prefix: 'seplos_bms', tempSensorsCount: 4, showButtons: false },
        packDefaults: { prefix: 'seplos_bms', tempSensorsCount: 4 },
        entities: {
            [EntityKey.capacity_remaining]: 'remaining_capacity',
            [EntityKey.total_battery_capacity_setting]: 'total_capacity',
            [EntityKey.total_charging_cycle_capacity]: 'total_discharge_capacity',
            [EntityKey.charging_cycles]: 'cycle',
            [EntityKey.power_tube_temperature]: 'mosfet_temperature',
            ...map(4, i => `temperature_sensor_${i}`, i => `cell_temperature_${i}`),
        },
    },
    // esp32-seplos-v3-ble-example.yaml (seplos_bms_v3_ble + seplos_bms_v3_ble_pack)
    seplos_v3_ble: {
        label: 'Seplos V3 (BLE)',
        sharedPrefix: true,
        defaults: { prefix: 'seplos_bms_v3_ble', tempSensorsCount: 4, cellCount: 16 },
        packDefaults: { prefix: 'seplos_bms_v3_ble', tempSensorsCount: 4, cellCount: 16 },
        entities: {
            [EntityKey.total_voltage]: 'pack_{pack}_voltage',
            [EntityKey.current]: 'pack_{pack}_current',
            [EntityKey.state_of_charge]: 'pack_{pack}_battery_level',
            [EntityKey.charging_cycles]: 'pack_{pack}_cycles',
            [EntityKey.delta_cell_voltage]: 'delta_voltage',
            [EntityKey.total_battery_capacity_setting]: 'total_capacity',
            [EntityKey.charging]: 'binary_sensor.{prefix}_charging',
            [EntityKey.discharging]: 'binary_sensor.{prefix}_discharging',
            [EntityKey.heater]: 'binary_sensor.{prefix}_heating',
            [EntityKey.errors]: 'problem_code',
            [EntityKey.software_version]: 'firmware_version',
            // Cell index sensors cover all packs; let the card derive them from the shown pack.
            [EntityKey.min_voltage_cell]: '',
            [EntityKey.max_voltage_cell]: '',
            [EntityKey.power_tube_temperature]: 'pack_{pack}_mosfet_temperature',
            ...map(4, i => `temperature_sensor_${i}`, i => `pack_{pack}_temperature_${i}`),
            ...map(16, i => `cell_voltage_${i}`, i => `pack_{pack}_cell_${i}_voltage`),
        },
        bankScopedKeys: [
            EntityKey.delta_cell_voltage,
            EntityKey.min_cell_voltage,
            EntityKey.max_cell_voltage,
            EntityKey.average_cell_voltage,
            EntityKey.capacity_remaining,
            EntityKey.total_battery_capacity_setting,
            EntityKey.power,
            EntityKey.errors,
            EntityKey.charging,
            EntityKey.discharging,
            EntityKey.heater,
        ],
        strictPackKeys: [
            EntityKey.total_voltage,
            EntityKey.current,
            EntityKey.state_of_charge,
            EntityKey.charging_cycles,
            EntityKey.power_tube_temperature,
        ],
    },
};

export const getPreset = (config?: { bmsModel?: BmsModel }): BmsPreset =>
    BMS_PRESETS[config?.bmsModel as BmsModel] ?? BMS_PRESETS.jk;

export const STOCK_PREFIXES = Object.values(BMS_PRESETS)
    .map(p => p.defaults.prefix)
    .filter((p): p is string => Boolean(p));

// Config after switching from previousModel to config.bmsModel. A custom prefix is kept;
// only an empty prefix or another model's default prefix is replaced.
export const applyModelDefaults = (config: JkBmsCardConfig, previousModel?: BmsModel): JkBmsCardConfig => {
    const preset = BMS_PRESETS[config.bmsModel as BmsModel];
    if (!preset || config.bmsModel === previousModel) return config;

    const { prefix, ...defaults } = preset.defaults;
    const updated = { ...config, ...defaults };

    if (prefix && (!config.prefix || STOCK_PREFIXES.includes(config.prefix))) {
        updated.prefix = prefix;
    }
    return updated;
};

// Pack-scoped variant that only applies pack defaults (never root display toggles like showButtons)
// and preserves custom cellCount / tempSensorsCount unless undefined or equal to the previous model's default.
export const applyPackModelDefaults = (pack: JkBmsPackConfig, previousModel?: BmsModel): JkBmsPackConfig => {
    const preset = BMS_PRESETS[pack.bmsModel as BmsModel];
    if (!preset || pack.bmsModel === previousModel) return pack;

    const prevDefaults = previousModel ? BMS_PRESETS[previousModel]?.packDefaults : undefined;
    const updated: JkBmsPackConfig = { ...pack };

    const nextPrefix = preset.packDefaults.prefix;
    if (nextPrefix && (!pack.prefix || STOCK_PREFIXES.includes(pack.prefix))) {
        updated.prefix = nextPrefix;
    }

    if (
        preset.packDefaults.cellCount !== undefined &&
        (pack.cellCount === undefined || pack.cellCount === prevDefaults?.cellCount)
    ) {
        updated.cellCount = preset.packDefaults.cellCount;
    }

    if (
        preset.packDefaults.tempSensorsCount !== undefined &&
        (pack.tempSensorsCount === undefined || pack.tempSensorsCount === prevDefaults?.tempSensorsCount)
    ) {
        updated.tempSensorsCount = preset.packDefaults.tempSensorsCount;
    }

    return updated;
};
