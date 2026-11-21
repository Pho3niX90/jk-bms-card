import { describe, it, expect } from 'vitest';
import { EntityKey } from '../src/const';
import {
    applyModelDefaults,
    applyPackModelDefaults,
    BMS_PRESETS,
    BmsModel,
    getPreset,
} from '../src/presets';
import { JkBmsCardConfig, JkBmsPackConfig } from '../src/interfaces';

const config = (overrides: Partial<JkBmsCardConfig> = {}) =>
    ({ prefix: 'jk_bms', entities: {}, ...overrides }) as JkBmsCardConfig;

const pack = (overrides: Partial<JkBmsPackConfig> = {}): JkBmsPackConfig => ({
    prefix: 'jk_bms',
    ...overrides,
});

describe('BMS_PRESETS', () => {
    const models = Object.keys(BMS_PRESETS) as BmsModel[];

    it('only maps known entity keys', () => {
        const validKeys = Object.values(EntityKey) as string[];
        for (const model of models) {
            for (const key of Object.keys(BMS_PRESETS[model].entities)) {
                expect(validKeys, `${model}: ${key}`).toContain(key);
            }
        }
    });

    it('gives every model a label and a unique default prefix', () => {
        const prefixes = models.map(m => BMS_PRESETS[m].defaults.prefix);
        for (const model of models) {
            expect(BMS_PRESETS[model].label).toBeTruthy();
            expect(BMS_PRESETS[model].defaults.prefix).toBeTruthy();
        }
        expect(new Set(prefixes).size).toBe(prefixes.length);
    });

    it('maps all 16 Seplos V3 BLE cells and 4 temp sensors to {pack}', () => {
        const { entities } = BMS_PRESETS.seplos_v3_ble;
        for (let i = 1; i <= 16; i++) {
            expect(entities[`cell_voltage_${i}` as EntityKey]).toBe(`pack_{pack}_cell_${i}_voltage`);
        }
        for (let i = 1; i <= 4; i++) {
            expect(entities[`temperature_sensor_${i}` as EntityKey]).toBe(`pack_{pack}_temperature_${i}`);
            expect(BMS_PRESETS.seplos_v3_modbus.entities[`temperature_sensor_${i}` as EntityKey]).toBe(
                `cell_temperature_${i}`
            );
        }
    });
});

describe('getPreset', () => {
    it('returns configured model or falls back to JK', () => {
        expect(getPreset(config({ bmsModel: 'seplos_v3_ble' }))).toBe(BMS_PRESETS.seplos_v3_ble);
        expect(getPreset(config({ bmsModel: 'seplos_v3_modbus' }))).toBe(BMS_PRESETS.seplos_v3_modbus);
        expect(getPreset(config())).toBe(BMS_PRESETS.jk);
        expect(getPreset(undefined)).toBe(BMS_PRESETS.jk);
        expect(getPreset(config({ bmsModel: 'unknown' as BmsModel }))).toBe(BMS_PRESETS.jk);
    });
});

describe('applyModelDefaults', () => {
    it('applies root defaults and swaps stock prefix', () => {
        const result = applyModelDefaults(config({ bmsModel: 'seplos_v3_modbus', showButtons: true }), 'jk');
        expect(result.prefix).toBe('seplos_bms');
        expect(result.tempSensorsCount).toBe(4);
        expect(result.showButtons).toBe(false);
    });

    it('preserves a custom prefix', () => {
        const result = applyModelDefaults(config({ bmsModel: 'seplos_v3_ble', prefix: 'garage_bat' }), 'jk');
        expect(result.prefix).toBe('garage_bat');
        expect(result.cellCount).toBe(16);
    });

    it('is a no-op when model is unchanged or unknown', () => {
        const input = config({ bmsModel: 'seplos_v3_modbus', showButtons: true });
        expect(applyModelDefaults(input, 'seplos_v3_modbus')).toBe(input);
        const bad = config({ bmsModel: 'daly' as BmsModel });
        expect(applyModelDefaults(bad, 'jk')).toBe(bad);
    });
});

describe('applyPackModelDefaults', () => {
    it('only applies pack-level defaults and never injects root display flags', () => {
        const result = applyPackModelDefaults(pack({ bmsModel: 'seplos_v3_modbus' }), 'jk');
        expect(result.prefix).toBe('seplos_bms');
        expect(result.tempSensorsCount).toBe(4);
        expect((result as any).showButtons).toBeUndefined();
    });

    it('keeps a custom pack prefix and custom cell/temp counts when switching models', () => {
        const result = applyPackModelDefaults(
            pack({ bmsModel: 'seplos_v3_ble', prefix: 'pack_west', cellCount: 8, tempSensorsCount: 2 }),
            'jk'
        );
        expect(result.prefix).toBe('pack_west');
        expect(result.cellCount).toBe(8);
        expect(result.tempSensorsCount).toBe(2);
    });
});
