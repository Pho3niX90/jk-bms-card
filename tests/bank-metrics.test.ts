import { describe, it, expect } from 'vitest';
import { HomeAssistant } from 'custom-card-helpers';
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

describe('buildPackConfig & stable keys', () => {
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
        expect(packCfg.entities.power).toBe('custom_power_suffix');
        expect(packCfg.cellCount).toBe(4);
        expect(packCfg.tempSensorsCount).toBe(2);
    });

    it('coerces string "0" hasHeater to false and "1"/true to true', () => {
        const root = rootConfig({ hasHeater: '1', packs: [{ prefix: 'p1', hasHeater: '0' as unknown as boolean }] });
        expect(buildPackConfig(root, root.packs![0], 0, false).hasHeater).toBe('0');
        const rootOn = rootConfig({ hasHeater: '0', packs: [{ prefix: 'p1', hasHeater: true }] });
        expect(buildPackConfig(rootOn, rootOn.packs![0], 0, false).hasHeater).toBe('1');
    });

    it('falls back to a single pack synthesized from root config (including legacy cell_resistances)', () => {
        const root = rootConfig({
            packs: [],
            cell_resistances: ['sensor.legacy_r1'],
        } as Partial<JkBmsCardConfig>);
        const { packs, isFallback } = resolveEffectivePacks(root);
        expect(isFallback).toBe(true);
        expect(packs).toHaveLength(1);
        expect(packs[0].cellResistances).toEqual(['sensor.legacy_r1']);

        const packCfg = buildPackConfig(root, packs[0], 0, true);
        expect(packCfg.entities.total_voltage).toBe('sensor.root_only_voltage');
        expect(packCfg.deviceId).toBe('root-device');
    });

    it('generates collision-free stable keys unaffected by reordering or renaming', () => {
        const packs: JkBmsPackConfig[] = [
            { id: 'a', name: 'First', prefix: 'jk_1' },
            { id: 'a', name: 'Second', prefix: 'jk_2' },
            { id: 'a#2', name: 'Third', prefix: 'jk_3' },
        ];
        const keys = computeStablePackKeys(packs);
        expect(new Set(keys).size).toBe(3);

        const named: JkBmsPackConfig[] = [
            { name: 'Alpha', prefix: 'jk_1', packIndex: 1 },
            { name: 'Beta', prefix: 'jk_2', packIndex: 2 },
        ];
        const beforeRename = computeStablePackKeys(named);
        const afterRename = computeStablePackKeys([
            { ...named[0], name: 'Alpha Renamed' },
            named[1],
        ]);
        expect(afterRename[0]).toBe(beforeRename[0]);
    });
});

describe('readPackSnapshot & aggregateBankMetrics', () => {
    it('computes capacity-weighted SoC, parallel sums, voltage spread, worst delta (mV/V), peak temp (°C/°F), kW/mA units, and ETA', () => {
        const hass = makeHass({
            // Pack 1: 280 Ah @ 90%, +20 A, 53.20 V, power in kW (1.064 kW), T1 beats MOS
            'sensor.jk_1_total_voltage': { state: '53.20', unit: 'V' },
            'sensor.jk_1_current': { state: '20000', unit: 'mA' },
            'sensor.jk_1_power': { state: '1.064', unit: 'kW' },
            'sensor.jk_1_state_of_charge': { state: '90', unit: '%' },
            'sensor.jk_1_capacity_remaining': { state: '252', unit: 'Ah' },
            'sensor.jk_1_total_battery_capacity_setting': { state: '280', unit: 'Ah' },
            'sensor.jk_1_delta_cell_voltage': { state: '0.008', unit: 'V' },
            'sensor.jk_1_power_tube_temperature': { state: '26.0', unit: '°C' },
            'sensor.jk_1_temperature_sensor_1': { state: '28.5', unit: '°C' },
            'sensor.jk_1_cell_voltage_1': { state: '3320', unit: 'mV' },
            'sensor.jk_1_cell_voltage_2': { state: '3328', unit: 'mV' },
            'sensor.jk_1_cell_voltage_3': { state: '3.325', unit: 'V' },
            'sensor.jk_1_cell_voltage_4': { state: '3.324', unit: 'V' },
            'switch.jk_1_charging': { state: 'on' },
            'switch.jk_1_discharging': { state: 'unavailable' },
            'switch.jk_1_balancer': { state: 'on' },
            'sensor.jk_1_errors': { state: 'unavailable' },

            // Pack 2: 140 Ah @ 60%, +10 A, 53.16 V, derived power, temp in °F (95 °F = 35 °C)
            'sensor.jk_2_total_voltage': { state: '53.16', unit: 'V' },
            'sensor.jk_2_current': { state: '10.0', unit: 'A' },
            'sensor.jk_2_state_of_charge': { state: '60', unit: '%' },
            'sensor.jk_2_capacity_remaining': { state: '84', unit: 'Ah' },
            'sensor.jk_2_total_battery_capacity_setting': { state: '140', unit: 'Ah' },
            'sensor.jk_2_power_tube_temperature': { state: '95.0', unit: '°F' },
            'sensor.jk_2_cell_voltage_1': { state: '3.305', unit: 'V' },
            'sensor.jk_2_cell_voltage_2': { state: '3.340', unit: 'V' },
            'sensor.jk_2_cell_voltage_3': { state: '0', unit: 'V' },
            'sensor.jk_2_cell_voltage_4': { state: 'unknown', unit: 'V' },
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
        expect(bank.isPartial).toBe(false);
        expect(bank.status).toBe('charging');
        expect(bank.soc).toBeCloseTo(80, 5);
        expect(bank.totalCurrent).toBeCloseTo(30, 5);
        expect(bank.totalPower).toBeCloseTo(1595.6, 2);
        expect(bank.avgVoltage).toBeCloseTo(53.18, 3);
        expect(bank.voltageSpreadV).toBeCloseTo(0.04, 3);
        expect(bank.worstDelta).toMatchObject({ deltaMv: 35, packName: 'Pack 2', isWarning: true });
        expect(snapshots[0].peakTemp).toMatchObject({ label: 'T1', value: 28.5 });
        expect(bank.peakTemp).toMatchObject({ value: 95, unit: '°F', packName: 'Pack 2' });
        expect(bank.minCell).toMatchObject({ voltageV: 3.305, packName: 'Pack 2', cellId: 1 });
        expect(bank.maxCell).toMatchObject({ voltageV: 3.34, packName: 'Pack 2', cellId: 2 });
        expect(bank.hasFault).toBe(false);
        expect(bank.etaHours).toBeCloseTo(2.8, 3);
        expect(formatEta(bank.etaHours)).toBe('2h 48m');
        // Discharging switch unavailable should be marked isUnavailable, not red off
        expect(snapshots[0].fets.discharging.isUnavailable).toBe(true);
        expect(snapshots[1].fets.charging.exists).toBe(false);
    });

    it('handles Seplos V3 BLE per-pack sensors, shared bank delta/errors, and disconnected BLE pack', () => {
        const hass = makeHass({
            // Shared bank-level sensors (must NOT keep disconnected Pack 2 online or override Pack 1 delta!)
            'sensor.seplos_total_voltage': { state: '52.8', unit: 'V' },
            'sensor.seplos_current': { state: '-25.0', unit: 'A' },
            'sensor.seplos_state_of_charge': { state: '75', unit: '%' },
            'sensor.seplos_delta_voltage': { state: '0.090', unit: 'V' },
            'sensor.seplos_capacity_remaining': { state: '420', unit: 'Ah' },
            'sensor.seplos_total_capacity': { state: '560', unit: 'Ah' },
            'sensor.seplos_problem_code': { state: 'Overvoltage alarm' },
            // Pack 0 (online with pack-specific sensors)
            'sensor.seplos_pack_0_voltage': { state: '52.82', unit: 'V' },
            'sensor.seplos_pack_0_current': { state: '-12.5', unit: 'A' },
            'sensor.seplos_pack_0_battery_level': { state: '76', unit: '%' },
            'sensor.seplos_pack_0_cycles': { state: '18' },
            'sensor.seplos_pack_0_cell_1_voltage': { state: '3.300', unit: 'V' },
            'sensor.seplos_pack_0_cell_2_voltage': { state: '3.312', unit: 'V' },
            'sensor.seplos_pack_0_mosfet_temperature': { state: '25', unit: '°C' },
            // Pack 1 (disconnected — all pack_1_* sensors unavailable)
            'sensor.seplos_pack_1_voltage': { state: 'unavailable', unit: 'V' },
            'sensor.seplos_pack_1_current': { state: 'unavailable', unit: 'A' },
            'sensor.seplos_pack_1_battery_level': { state: 'unavailable', unit: '%' },
            'sensor.seplos_pack_1_cell_1_voltage': { state: 'unavailable', unit: 'V' },
            'sensor.seplos_pack_1_cell_2_voltage': { state: 'unavailable', unit: 'V' },
            'sensor.seplos_pack_1_mosfet_temperature': { state: 'unavailable', unit: '°C' },
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

        // Disconnected Pack 2 is OFFLINE despite shared bank sensors being online!
        expect(snapshots[0].isOnline).toBe(true);
        expect(snapshots[1].isOnline).toBe(false);
        expect(bank.onlineCount).toBe(1);
        expect(bank.isPartial).toBe(true);
        // Pack 1 delta is derived from its own cells (12 mV), NOT bank-wide 90 mV
        expect(snapshots[0].deltaMv).toBe(12);
        expect(bank.worstDelta).toMatchObject({ packName: 'Seplos P1', deltaMv: 12 });
        // Shared error entity counted ONCE, not twice
        expect(bank.hasFault).toBe(true);
        expect(bank.errorCount).toBe(1);
        expect(bank.status).toBe('discharging');
    });

    it('suppresses ETA and kWh when remainingAh or capacityAh coverage does not match online packs', () => {
        const hass = makeHass({
            'sensor.p1_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p1_current': { state: '10.0', unit: 'A' },
            'sensor.p1_state_of_charge': { state: '50', unit: '%' },
            'sensor.p1_capacity_remaining': { state: '50', unit: 'Ah' },
            'sensor.p1_total_battery_capacity_setting': { state: '100', unit: 'Ah' },
            // Pack 2 is online with capacity + current, but remaining sensor is unavailable
            'sensor.p2_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p2_current': { state: '10.0', unit: 'A' },
            'sensor.p2_state_of_charge': { state: '50', unit: '%' },
            'sensor.p2_capacity_remaining': { state: 'unavailable', unit: 'Ah' },
            'sensor.p2_total_battery_capacity_setting': { state: '100', unit: 'Ah' },
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

        expect(bank.onlineCount).toBe(2);
        expect(bank.hasFullCapacityCoverage).toBe(false);
        expect(bank.etaHours).toBeNull();
        expect(bank.remainingKwh).toBeNull();
        expect(bank.totalKwh).toBeCloseTo((200 * 53) / 1000, 3);
    });

    it('deduplicates derived power when packs share a current sensor with different voltages', () => {
        const hass = makeHass({
            'sensor.p1_total_voltage': { state: '53.20', unit: 'V' },
            'sensor.p2_total_voltage': { state: '53.18', unit: 'V' },
            'sensor.shunt_current': { state: '20.0', unit: 'A' },
        });

        const cfg = rootConfig({
            entities: {},
            packs: [
                { name: 'P1', prefix: 'p1', entities: { current: 'sensor.shunt_current' } },
                { name: 'P2', prefix: 'p2', entities: { current: 'sensor.shunt_current' } },
            ],
        });

        const keys = computeStablePackKeys(cfg.packs!);
        const snapshots = cfg.packs!.map((p, i) => readPackSnapshot(hass, cfg, p, i, keys[i]));
        const bank = aggregateBankMetrics(snapshots);

        expect(bank.totalCurrent).toBeCloseTo(20, 5);
        // Derived power counted ONCE for sensor.shunt_current (~1064 W, NOT ~2128 W)
        expect(bank.totalPower).toBeCloseTo(53.2 * 20, 2);
    });

    it('handles discharging ETA, deadband idle, all-offline, and shared voltage spread=null', () => {
        const idleHass = makeHass({
            'sensor.p1_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p1_current': { state: '0.2', unit: 'A' }, // below 0.5 A deadband
            'sensor.p1_capacity_remaining': { state: '100', unit: 'Ah' },
            'sensor.p1_total_battery_capacity_setting': { state: '100', unit: 'Ah' },
        });
        const cfg1 = rootConfig({ entities: {}, packs: [{ name: 'P1', prefix: 'p1' }] });
        const snap1 = readPackSnapshot(idleHass, cfg1, cfg1.packs![0], 0, 'k1');
        const idleBank = aggregateBankMetrics([snap1]);
        expect(idleBank.status).toBe('idle');
        expect(idleBank.etaHours).toBeNull();
        expect(idleBank.voltageSpreadV).toBeNull();

        // Discharging ETA
        const dsgHass = makeHass({
            'sensor.p1_total_voltage': { state: '52.0', unit: 'V' },
            'sensor.p1_current': { state: '-25.0', unit: 'A' },
            'sensor.p1_capacity_remaining': { state: '100', unit: 'Ah' },
            'sensor.p1_total_battery_capacity_setting': { state: '200', unit: 'Ah' },
        });
        const dsgBank = aggregateBankMetrics([readPackSnapshot(dsgHass, cfg1, cfg1.packs![0], 0, 'k1')]);
        expect(dsgBank.status).toBe('discharging');
        expect(dsgBank.etaHours).toBeCloseTo(4, 3);

        // All offline
        const offBank = aggregateBankMetrics([readPackSnapshot(makeHass({}), cfg1, cfg1.packs![0], 0, 'k1')]);
        expect(offBank.status).toBe('offline');
        expect(offBank.onlineCount).toBe(0);
    });

    it('ignores 0/unknown/unavailable errors and still flags real errors', () => {
        const hass = makeHass({
            'sensor.p1_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p1_errors': { state: '0' },
            'sensor.p2_total_voltage': { state: '53.0', unit: 'V' },
            'sensor.p2_errors': { state: 'unknown' },
            'sensor.p3_total_voltage': { state: 'unavailable', unit: 'V' },
            'sensor.p3_errors': { state: 'Cell undervoltage' },
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

        expect(snapshots[0].errorMessage).toBeNull();
        expect(snapshots[1].errorMessage).toBeNull();
        expect(snapshots[2].errorMessage).toBe('Cell undervoltage');
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
