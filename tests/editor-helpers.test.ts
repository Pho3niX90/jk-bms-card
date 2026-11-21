import { describe, it, expect } from 'vitest';
import { HomeAssistant } from 'custom-card-helpers';
import { EntityKey } from '../src/const';
import { JkBmsCardConfig } from '../src/interfaces';
import { buildPackConfig, resolveEffectivePacks } from '../src/helpers/bank-metrics';
import { resolveEntityId } from '../src/helpers/utils';
import {
    addPackToConfig,
    applyPackEdit,
    inferPrefixFromDevice,
    normalizeShowHideFlags,
    suggestNextPrefix,
} from '../src/helpers/editor-helpers';

const baseConfig = (overrides: Partial<JkBmsCardConfig> = {}): JkBmsCardConfig =>
    ({
        type: 'custom:jk-bms-card',
        layout: 'bank-overview',
        title: 'Bank',
        prefix: 'jk_bms_1',
        cellCount: 16,
        cellColumns: 4,
        cellLayout: 'incremental',
        entities: {},
        ...overrides,
    }) as JkBmsCardConfig;

describe('addPackToConfig & Pack 1 seeding', () => {
    it('preserves all Pack 1 entity overrides, cells, cellResistances, and cellPrefix across Add Pack', () => {
        const before = baseConfig({
            prefix: 'jk_main',
            deviceId: 'dev-1',
            cells: ['sensor.custom_c1', 'sensor.custom_c2'],
            cell_resistances: ['sensor.custom_r1'],
            cellPrefix: 'sensor.pref_',
            entities: {
                total_voltage: 'sensor.manual_voltage',
                cell_prefix: 'sensor.ent_cell_',
            },
        } as Partial<JkBmsCardConfig>);

        const fallbackPack = resolveEffectivePacks(before).packs[0];
        const beforeCfg = buildPackConfig(before, fallbackPack, 0, true);

        const { config: after, newIndex } = addPackToConfig(before);
        expect(newIndex).toBe(1);
        expect(after.packs).toHaveLength(2);
        expect(after.packs![0].id).toBe('pack_1');
        expect(after.packs![1].id).toBe('pack_2');

        const afterPack0Cfg = buildPackConfig(after, after.packs![0], 0, false);

        expect(resolveEntityId(undefined, afterPack0Cfg, EntityKey.total_voltage)).toBe(
            resolveEntityId(undefined, beforeCfg, EntityKey.total_voltage)
        );
        expect(resolveEntityId(undefined, afterPack0Cfg, EntityKey.cell_voltage_1)).toBe('sensor.custom_c1');
        expect(resolveEntityId(undefined, afterPack0Cfg, EntityKey.cell_resistance_1)).toBe('sensor.custom_r1');
        expect(afterPack0Cfg.deviceId).toBe('dev-1');
    });

    it('keeps shared prefix and copies bmsModel for Seplos V3 BLE, picking unused packIndex after middle deletion', () => {
        const cfg = baseConfig({
            bmsModel: 'seplos_v3_ble',
            prefix: 'seplos_bms_v3_ble',
            packs: [
                { id: 'pack_1', name: 'Pack 1', prefix: 'seplos_bms_v3_ble', bmsModel: 'seplos_v3_ble', packIndex: 1 },
                // Pack 2 was removed, leaving packIndex 1 and 3
                { id: 'pack_3', name: 'Pack 3', prefix: 'seplos_bms_v3_ble', bmsModel: 'seplos_v3_ble', packIndex: 3 },
            ],
        });

        const { config: updated } = addPackToConfig(cfg);
        const added = updated.packs![2];
        expect(added.prefix).toBe('seplos_bms_v3_ble');
        expect(added.bmsModel).toBe('seplos_v3_ble');
        // Lowest unused packIndex is 2 (not duplicate 3!)
        expect(added.packIndex).toBe(2);
    });

    it('avoids incrementing version-like suffixes (jk_bms_v19) and avoids prefix collisions', () => {
        const cfg = baseConfig({ prefix: 'jk_bms_v19' });
        expect(suggestNextPrefix([{ prefix: 'jk_bms_v19' }], cfg)).toBe('jk_bms_v19_2');

        const colliding = [{ prefix: 'jk_1' }, { prefix: 'jk_3' }, { prefix: 'jk_2' }];
        expect(suggestNextPrefix(colliding, cfg)).toBe('jk_4');
    });
});

describe('inferPrefixFromDevice & applyPackEdit', () => {
    const hass = {
        entities: {
            'sensor.seplos_bms_v3_ble_pack_0_mosfet_temperature': { device_id: 'dev-ble' },
            'sensor.seplos_bms_v3_ble_pack_1_cell_1_voltage': { device_id: 'dev-ble' },
            'sensor.seplos_bms_v3_ble_total_voltage': { device_id: 'dev-ble' },
            'sensor.other_device_total_voltage': { device_id: 'dev-other' },
        },
    } as unknown as HomeAssistant;

    it('strips _pack_N suffixes and infers the true base prefix', () => {
        expect(inferPrefixFromDevice(hass, 'dev-ble')).toBe('seplos_bms_v3_ble');
    });

    it('applies inferred prefix for stock/empty prefix but preserves a user-typed custom prefix', () => {
        const cfg = baseConfig({
            packs: [
                { id: 'pack_1', name: 'Pack 1', prefix: 'jk_bms' },
                { id: 'pack_2', name: 'Pack 2', prefix: 'my_custom_prefix' },
            ],
        });

        const updatedStock = applyPackEdit(cfg, 0, { deviceId: 'dev-ble' }, hass);
        expect(updatedStock.packs![0].prefix).toBe('seplos_bms_v3_ble');

        const updatedCustom = applyPackEdit(cfg, 1, { deviceId: 'dev-ble' }, hass);
        expect(updatedCustom.packs![1].prefix).toBe('my_custom_prefix');
    });

    it('allows clearing the prefix field without snapping back', () => {
        const cfg = baseConfig({ packs: [{ id: 'pack_1', prefix: 'jk_1' }] });
        const cleared = applyPackEdit(cfg, 0, { prefix: '' }, hass);
        expect(cleared.packs![0].prefix).toBe('');
    });
});

describe('normalizeShowHideFlags', () => {
    it('preserves explicit showResistances: false and showMainStats: false when parent flags are omitted', () => {
        const cfg = baseConfig({
            layout: 'bank-overview',
            showResistances: false,
            showMainStats: false,
        });
        delete cfg.showCells;
        delete cfg.showMain;

        const normalized = normalizeShowHideFlags(cfg);
        expect(normalized.showResistances).toBe(false);
        expect(normalized.showMainStats).toBe(false);
    });
});
