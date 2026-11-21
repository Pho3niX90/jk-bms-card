import { describe, it, expect } from 'vitest';
import { HomeAssistant } from 'custom-card-helpers';
import { EntityKey } from '../src/const';
import { JkBmsCardConfig, JkBmsPackConfig } from '../src/interfaces';
import {
    aggregateBankMetrics,
    buildPackConfig,
    collectWatchedEntityIds,
    computeStablePackKeys,
    countMatchedPackEntities,
    formatEta,
    readPackSnapshot,
    resolveEffectivePacks,
} from '../src/helpers/bank-metrics';

const makeHass = (
    states: Record<string, { state: string; unit?: string }>,
    entitiesMeta: Record<string, { device_id?: string }> = {}
) =>
    ({
        states: Object.fromEntries(
            Object.entries(states).map(([id, s]) => [
                id,
                { state: s.state, attributes: { unit_of_measurement: s.unit } },
            ])
        ),
        entities: entitiesMeta,
    }) as unknown as HomeAssistant;

const rootConfig = (overrides: Partial<JkBmsCardConfig> = {}): JkBmsCardConfig =>
    ({
        type: 'custom:jk-bms-card',
        layout: 'bank-overview',
        title: 'Solar Bank',
        prefix: 'jk_root',
        cellCount: 4,
        cellColumns: 2,
        cellLayout: 'incremental',
        deltaVoltageUnit: 'mV',
        resistanceUnit: 'Ω',
        tempSensorsCount: 2,
        hasHeater: 0,
        socDecimals: 1,
        customDecimals: 2,
        entities: {
            total_voltage: 'sensor.root_only_voltage',
            power: 'custom_power_suffix',
            cell_prefix: 'sensor.root_cell_',
            device_id: 'root-device',
        },
        deviceId: 'root-device',
        cells: ['sensor.root_c1'],
        ...overrides,
    }) as JkBmsCardConfig;

describe('buildPackConfig inheritance rules', () => {
    it('does not leak root prefix, deviceId, cells, or full entity IDs into configured packs', () => {
        const root = rootConfig({
            packs: [{ name: 'Pack 2', prefix: 'jk_bms_2' }],
        });
        const packCfg = buildPackConfig(root, root.packs![0], 0, false);

        expect(packCfg.prefix).toBe('jk_bms_2');
        expect(packCfg.deviceId).toBeUndefined();
        expect(packCfg.cells).toBeUndefined();
        expect(packCfg.cellPrefix).toBeUndefined();
        expect(packCfg.entities.total_voltage).toBeUndefined();
        expect(packCfg.entities.cell_prefix).toBeUndefined();
        expect(packCfg.entities.device_id).toBeUndefined();
        // Dotless suffix override IS inherited
        expect(packCfg.entities.power).toBe('custom_power_suffix');
        // Shape defaults ARE inherited
        expect(packCfg.cellCount).toBe(4);
        expect(packCfg.tempSensorsCount).toBe(2);
    });

    it('falls back to a single pack synthesized from root config when packs is empty', () => {
        const root = rootConfig({ packs: [] });
        const { packs, isFallback } = resolveEffectivePacks(root);
        expect(isFallback).toBe(true);
        expect(packs).toHaveLength(1);
        expect(packs[0].prefix).toBe('jk_root');

        const packCfg = buildPackConfig(root, packs[0], 0, true);
        expect(packCfg.entities.total_voltage).toBe('sensor.root_only_voltage');
        expect(packCfg.deviceId).toBe('root-device');
    });

    it('generates stable unique pack keys independent of array index for reordering', () => {
        const packs: JkBmsPackConfig[] = [
            { name: 'A', prefix: 'jk_1' },
            { name: 'B', prefix: 'jk_2' },
        ];
        const keys1 = computeStablePackKeys(packs);
        const keys2 = computeStablePackKeys([packs[1], packs[0]]);
        expect(keys2[0]).toBe(keys1[1]);
        expect(keys2[1]).toBe(keys1[0]);
    });
});

describe('readPackSnapshot & aggregateBankMetrics', () => {
    it('computes capacity-weighted SoC, parallel sums, voltage spread, worst delta (mV/V), peak temp (°C/°F), and ETA', () => {
        const hass = makeHass({
            // Pack 1: 280 Ah @ 90%, +20 A, 53.20 V, delta in V (0.008 V = 8 mV), temp in °C
            'sensor.jk_1_total_voltage': { state: '53.20', unit: 'V' },
            'sensor.jk_1_current': { state: '20.0', unit: 'A' },
            'sensor.jk_1_power': { state: '1064', unit: 'W' },
            'sensor.jk_1_state_of_charge': { state: '90', unit: '%' },
            'sensor.jk_1_capacity_remaining': { state: '252', unit: 'Ah' },
            'sensor.jk_1_total_battery_capacity_setting': { state: '280', unit: 'Ah' },
            'sensor.jk_1_delta_cell_voltage': { state: '0.008', unit: 'V' },
            'sensor.jk_1_power_tube_temperature': { state: '26.0', unit: '°C' },
            'sensor.jk_1_cell_voltage_1': { state: '3.320', unit: 'V' },
            'sensor.jk_1_cell_voltage_2': { state: '3.328', unit: 'V' },
            'sensor.jk_1_cell_voltage_3': { state: '3.325', unit: 'V' },
            'sensor.jk_1_cell_voltage_4': { state: '3.324', unit: 'V' },
            'switch.jk_1_charging': { state: 'on' },
            'switch.jk_1_discharging': { state: 'on' },
            'switch.jk_1_balancer': { state: 'on' },
            'sensor.jk_1_errors': { state: 'unavailable' },

            // Pack 2: 140 Ah @ 60%, +10 A, 53.16 V, NO power sensor (derived!), delta in mV (35 mV), temp in °F (95 °F = 35 °C)
            'sensor.jk_2_total_voltage': { state: '53.16', unit: 'V' },
            'sensor.jk_2_current': { state: '10.0', unit: 'A' },
            'sensor.jk_2_state_of_charge': { state: '60', unit: '%' },
            'sensor.jk_2_capacity_remaining': { state: '84', unit: 'Ah' },
            'sensor.jk_2_total_battery_capacity_setting': { state: '140', unit: 'Ah' },
            'sensor.jk_2_delta_cell_voltage': { state: '35', unit: 'mV' },
            'sensor.jk_2_power_tube_temperature': { state: '95.0', unit: '°F' },
            'sensor.jk_2_cell_voltage_1': { state: '3.305', unit: 'V' },
            'sensor.jk_2_cell_voltage_2': { state: '3.340', unit: 'V' },
            'sensor.jk_2_cell_voltage_3': { state: '0', unit: 'V' }, // 0 V must NOT become min cell!
            'sensor.jk_2_cell_voltage_4': { state: 'unavailable', unit: 'V' },
            'sensor.jk_2_balancing_current': { state: '-1.5', unit: 'A' },
        });

        const cfg = rootConfig({
            entities: {},
            packs: [
                { name: 'Pack 1', prefix: 'jk_1' },
                { name: 'Pack 2', prefix: 'jk_2' },
            ],
        });

        const keys = computeStablePackKeys(cfg.packs!);
        const snapshots = cfg.packs!.map((p, i) => readPackSnapshot(hass, cfg, p, i, keys[i]));
        const bank = aggregateBankMetrics(snapshots, { deltaWarningMv: 30 });

        expect(bank.onlineCount).toBe(2);
        expect(bank.totalCount).toBe(2);
        expect(bank.isPartial).toBe(false);
        expect(bank.status).toBe('charging');
        // Weighted SoC: (90*280 + 60*140) / (280 + 140) = 33600 / 420 = 80%
        expect(bank.soc).toBeCloseTo(80, 5);
        expect(bank.totalCurrent).toBeCloseTo(30, 5);
        // Pack 2 derived power: 53.16 * 10 = 531.6; total = 1064 + 531.6 = 1595.6
        expect(snapshots[1].powerDerived).toBe(true);
        expect(bank.totalPower).toBeCloseTo(1595.6, 2);
        expect(bank.avgVoltage).toBeCloseTo(53.18, 3);
        expect(bank.voltageSpreadV).toBeCloseTo(0.04, 3);
        // Worst delta compares 8 mV vs 35 mV
        expect(bank.worstDelta).toMatchObject({
            deltaMv: 35,
            packName: 'Pack 2',
            isWarning: true,
        });
        // Peak temp compares 26 °C vs 95 °F (35 °C) and preserves °F display
        expect(bank.peakTemp).toMatchObject({
            value: 95,
            unit: '°F',
            packName: 'Pack 2',
        });
        expect(bank.peakTemp!.celsius).toBeCloseTo(35, 3);
        // 0 V cell on Pack 2 ignored; real min is 3.305 V (C1)
        expect(bank.minCell).toMatchObject({ voltageV: 3.305, packName: 'Pack 2', cellId: 1 });
        expect(bank.maxCell).toMatchObject({ voltageV: 3.34, packName: 'Pack 2', cellId: 2 });
        // Unavailable error sensor on Pack 1 must NOT trigger FAULT
        expect(bank.hasFault).toBe(false);
        expect(bank.balancingPackCount).toBe(1);
        // Charging ETA: (420 - 336) / 30 = 2.8 hours
        expect(bank.etaHours).toBeCloseTo(2.8, 3);
        expect(formatEta(bank.etaHours)).toBe('2h 48m');
        // Pack 2 has no switch entities -> exists = false (hidden, not shown red OFF)
        expect(snapshots[0].fets.charging.exists).toBe(true);
        expect(snapshots[1].fets.charging.exists).toBe(false);
    });

    it('deduplicates shared entity IDs so Seplos V3 BLE packs are never counted N times', () => {
        const hass = makeHass({
            // Shared bank-level Seplos V3 BLE entities
            'sensor.seplos_total_voltage': { state: '52.8', unit: 'V' },
            'sensor.seplos_current': { state: '-25.0', unit: 'A' },
            'sensor.seplos_state_of_charge': { state: '75', unit: '%' },
            'sensor.seplos_capacity_remaining': { state: '420', unit: 'Ah' },
            'sensor.seplos_total_capacity': { state: '560', unit: 'Ah' },
            // Pack-specific cell voltages & temps
            'sensor.seplos_pack_0_cell_1_voltage': { state: '3.300', unit: 'V' },
            'sensor.seplos_pack_0_cell_2_voltage': { state: '3.310', unit: 'V' },
            'sensor.seplos_pack_1_cell_1_voltage': { state: '3.295', unit: 'V' },
            'sensor.seplos_pack_1_cell_2_voltage': { state: '3.315', unit: 'V' },
            'sensor.seplos_pack_0_mosfet_temperature': { state: '25', unit: '°C' },
            'sensor.seplos_pack_1_mosfet_temperature': { state: '29', unit: '°C' },
            'binary_sensor.seplos_discharging': { state: 'on' },
        });

        const cfg = rootConfig({
            bmsModel: 'seplos_v3_ble',
            cellCount: 2,
            entities: {},
            packs: [
                { name: 'Seplos P1', prefix: 'seplos', packIndex: 1 },
                { name: 'Seplos P2', prefix: 'seplos', packIndex: 2 },
            ],
        });

        const keys = computeStablePackKeys(cfg.packs!);
        const snapshots = cfg.packs!.map((p, i) => readPackSnapshot(hass, cfg, p, i, keys[i]));
        const bank = aggregateBankMetrics(snapshots);

        // Must NOT double-count -25 A, 420 Ah, 560 Ah, or derived power!
        expect(bank.totalCurrent).toBeCloseTo(-25, 5);
        expect(bank.totalRemainingAh).toBeCloseTo(420, 5);
        expect(bank.totalCapacityAh).toBeCloseTo(560, 5);
        expect(bank.totalPower).toBeCloseTo(52.8 * -25, 2);
        expect(bank.soc).toBeCloseTo(75, 5);
        expect(bank.status).toBe('discharging');
        // Pack-level extremes still distinguish P1 vs P2
        expect(bank.worstDelta).toMatchObject({ packName: 'Seplos P2', deltaMv: 20 });
        expect(bank.peakTemp).toMatchObject({ packName: 'Seplos P2', value: 29 });
    });

    it('marks bank partial when a pack is offline and falls back to equal-weight SoC when capacity is missing', () => {
        const hass = makeHass({
            'sensor.p1_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p1_state_of_charge': { state: '80', unit: '%' },
            'sensor.p1_total_battery_capacity_setting': { state: '280', unit: 'Ah' },
            'sensor.p2_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p2_state_of_charge': { state: '60', unit: '%' },
            // p2 has NO capacity sensor
            // p3 is completely offline
            'sensor.p3_total_voltage': { state: 'unavailable', unit: 'V' },
            'sensor.p3_state_of_charge': { state: 'unavailable', unit: '%' },
        });

        const cfg = rootConfig({
            entities: {},
            packs: [
                { name: 'P1', prefix: 'p1' },
                { name: 'P2', prefix: 'p2' },
                { name: 'P3', prefix: 'p3' },
            ],
        });

        const keys = computeStablePackKeys(cfg.packs!);
        const snapshots = cfg.packs!.map((p, i) => readPackSnapshot(hass, cfg, p, i, keys[i]));
        const bank = aggregateBankMetrics(snapshots);

        expect(bank.onlineCount).toBe(2);
        expect(bank.totalCount).toBe(3);
        expect(bank.isPartial).toBe(true);
        // Equal-weight fallback because P2 lacks capacity
        expect(bank.soc).toBeCloseTo(70, 5);
        expect(bank.status).toBe('idle');
    });

    it('flags FAULT for real errors but ignores 0, unknown, and unavailable', () => {
        const hass = makeHass({
            'sensor.p1_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p1_errors': { state: '0' },
            'sensor.p2_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p2_errors': { state: 'Cell undervoltage' },
        });

        const cfg = rootConfig({
            entities: {},
            packs: [
                { name: 'P1', prefix: 'p1' },
                { name: 'P2', prefix: 'p2' },
            ],
        });

        const keys = computeStablePackKeys(cfg.packs!);
        const snapshots = cfg.packs!.map((p, i) => readPackSnapshot(hass, cfg, p, i, keys[i]));
        const bank = aggregateBankMetrics(snapshots);

        expect(snapshots[0].errorMessage).toBeNull();
        expect(snapshots[1].errorMessage).toBe('Cell undervoltage');
        expect(bank.hasFault).toBe(true);
        expect(bank.errorCount).toBe(1);
    });

    it('collects watched entity IDs and counts matched entities per pack', () => {
        const hass = makeHass({
            'sensor.p1_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p1_mosfet_temperature': { state: '25.0', unit: '°C' },
            'sensor.p1_cell_voltage_1': { state: '3.31', unit: 'V' },
        });
        const cfg = rootConfig({
            entities: {},
            packs: [{ name: 'P1', prefix: 'p1' }],
        });

        const watched = collectWatchedEntityIds(cfg);
        expect(watched).toContain('sensor.p1_total_voltage');
        expect(watched).toContain('sensor.p1_mosfet_temperature');
        expect(watched).toContain('sensor.p1_cell_voltage_1');
        expect(countMatchedPackEntities(hass, cfg, cfg.packs![0], 0)).toBe(3);
    });
});
