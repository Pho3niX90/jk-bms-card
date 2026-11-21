import { describe, it, expect, vi } from 'vitest';
import { HomeAssistant } from 'custom-card-helpers';
import { EntityKey } from '../src/const';
import { JkBmsCardConfig } from '../src/interfaces';
import {
    candidateEntityIds,
    configOrEnum,
    formatValue,
    getNumericState,
    getRawState,
    getState,
    getTemperatureColor,
    getUnit,
    isCellBalancing,
    isCellBalancingFromMask,
    navigate,
    navigateEntityId,
    parseBalancerBitmask,
    resolveEntityId,
    toAmps,
    toCelsius,
    toMillivolts,
    toVolts,
    toWatts,
} from '../src/helpers/utils';

const config = (overrides: Partial<JkBmsCardConfig> = {}) =>
    ({ prefix: 'jk_bms', cellCount: 16, entities: {}, ...overrides }) as JkBmsCardConfig;

const hassWith = (states: Record<string, { state: string; unit?: string }>) =>
    ({
        states: Object.fromEntries(
            Object.entries(states).map(([id, s]) => [id, { state: s.state, attributes: { unit_of_measurement: s.unit } }])
        ),
    }) as unknown as HomeAssistant;

describe('candidateEntityIds & resolveEntityId', () => {
    it('follows precedence: manual override -> preset -> ESPHome v3 aliases -> legacy key', () => {
        const cfg = config({
            bmsModel: 'seplos_v3_modbus',
            prefix: 'seplos',
            entities: { power_tube_temperature: 'custom_mos' },
        });
        expect(candidateEntityIds(cfg, EntityKey.power_tube_temperature)).toEqual([
            'sensor.seplos_custom_mos',
            'sensor.seplos_mosfet_temperature',
            'sensor.seplos_power_tube_temperature',
        ]);
    });

    it('resolves ESPHome v3 alias when present in hass.states', () => {
        const hass = hassWith({
            'sensor.jk_bms_mosfet_temperature': { state: '31.2', unit: '°C' },
        });
        expect(resolveEntityId(hass, config(), EntityKey.power_tube_temperature)).toBe(
            'sensor.jk_bms_mosfet_temperature'
        );
    });

    it('suppresses alias and legacy fallback when preset explicitly marks an entity empty', () => {
        const hass = hassWith({
            'sensor.seplos_min_voltage_cell': { state: '7' },
        });
        const cfg = config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos' });
        expect(candidateEntityIds(cfg, EntityKey.min_voltage_cell)).toEqual([]);
        expect(resolveEntityId(hass, cfg, EntityKey.min_voltage_cell)).toBeUndefined();
    });

    it('returns ONLY the manual override when preset marks an entity empty (no alias/legacy fallback)', () => {
        const cfg = config({
            bmsModel: 'seplos_v3_ble',
            prefix: 'seplos',
            entities: { min_voltage_cell: 'sensor.custom_min_cell' },
        });
        expect(candidateEntityIds(cfg, EntityKey.min_voltage_cell)).toEqual(['sensor.custom_min_cell']);
    });

    it('handles full-ID overrides, empty prefix, and all-empty stub entities', () => {
        const fullIdCfg = config({
            prefix: '',
            entities: { total_voltage: 'sensor.external_pack_v', current: '' },
        });
        expect(candidateEntityIds(fullIdCfg, EntityKey.total_voltage)).toEqual(['sensor.external_pack_v']);
        expect(candidateEntityIds(fullIdCfg, EntityKey.current)).toEqual([]);
    });

    it('trims prefix identically for {prefix} placeholders and plain suffixes', () => {
        const cfg = config({ bmsModel: 'seplos_v3_ble', prefix: '  seplos_main  ', packIndex: 1 });
        expect(resolveEntityId(undefined, cfg, EntityKey.charging, 'switch')).toBe(
            'binary_sensor.seplos_main_charging'
        );
        expect(resolveEntityId(undefined, cfg, EntityKey.cell_voltage_1)).toBe(
            'sensor.seplos_main_pack_0_cell_1_voltage'
        );
    });

    it('prefers packIndex over batteryNumber and clamps non-positive values to pack 0', () => {
        const bothSet = config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos', packIndex: 3, batteryNumber: 1 });
        expect(resolveEntityId(undefined, bothSet, EntityKey.cell_voltage_1)).toBe(
            'sensor.seplos_pack_2_cell_1_voltage'
        );
        expect(resolveEntityId(undefined, bothSet, EntityKey.total_voltage)).toBe('sensor.seplos_pack_2_voltage');

        const clamped = config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos', batteryNumber: 0 });
        expect(resolveEntityId(undefined, clamped, EntityKey.cell_voltage_1)).toBe(
            'sensor.seplos_pack_0_cell_1_voltage'
        );
    });

    it('supports cells[], cellResistances[], legacy cell_resistances[], and cell_prefix overrides beating entities', () => {
        const cfgArr = config({
            cells: ['sensor.pack_c1', 'sensor.pack_c2'],
            entities: { cell_voltage_2: 'sensor.ignored_override' },
            cell_resistances: ['sensor.pack_r1', 'sensor.pack_r2'],
        } as Partial<JkBmsCardConfig>);
        expect(candidateEntityIds(cfgArr, EntityKey.cell_voltage_2)).toEqual(['sensor.pack_c2']);
        expect(candidateEntityIds(cfgArr, EntityKey.cell_resistance_2)).toEqual(['sensor.pack_r2']);

        const cfgPrefix = config({ prefix: 'bat1', entities: { cell_prefix: 'sensor.{prefix}_v_' } });
        expect(candidateEntityIds(cfgPrefix, EntityKey.cell_voltage_5)).toEqual(['sensor.bat1_v_5']);
    });
});

describe('getNumericState, getRawState & getState', () => {
    const hass = hassWith({
        'sensor.jk_bms_total_voltage': { state: '53.25', unit: 'V' },
        'sensor.jk_bms_current': { state: 'unavailable', unit: 'A' },
        'sensor.jk_bms_power': { state: 'unknown', unit: 'W' },
        'sensor.jk_bms_state_of_charge': { state: '', unit: '%' },
        'sensor.jk_bms_errors': { state: 'Cell overvoltage' },
        'switch.jk_bms_charging': { state: 'on' },
    });

    it('returns numeric value and unit for valid sensors', () => {
        expect(getNumericState(hass, config(), EntityKey.total_voltage)).toEqual({
            value: 53.25,
            unit: 'V',
            entityId: 'sensor.jk_bms_total_voltage',
            exists: true,
        });
    });

    it('returns null (not 0) for unavailable, unknown, empty, or missing sensors', () => {
        expect(getNumericState(hass, config(), EntityKey.current)).toMatchObject({ value: null, exists: true });
        expect(getNumericState(hass, config(), EntityKey.power)).toMatchObject({ value: null, exists: true });
        expect(getNumericState(hass, config(), EntityKey.state_of_charge)).toMatchObject({ value: null, exists: true });
        expect(getNumericState(hass, config(), EntityKey.balancing_current)).toMatchObject({
            value: null,
            exists: false,
        });
    });

    it('reads non-numeric states and distinguishes missing vs unavailable', () => {
        expect(getRawState(hass, config(), EntityKey.errors)).toMatchObject({
            state: 'Cell overvoltage',
            exists: true,
        });
        expect(getRawState(hass, config(), EntityKey.charging, 'switch')).toMatchObject({
            state: 'on',
            exists: true,
        });
        expect(getRawState(hass, config(), EntityKey.heater, 'switch')).toMatchObject({
            state: null,
            exists: false,
        });
    });

    it('returns defaultValue in getState for empty states instead of coercing to 0.00', () => {
        expect(getState(hass, config(), EntityKey.total_voltage, 2)).toBe('53.25');
        expect(getState(hass, config(), EntityKey.state_of_charge, 2, '0')).toBe('0');
        expect(getUnit(hass, config(), EntityKey.total_voltage)).toBe('V');
    });
});

describe('balancer bitmask parsing', () => {
    it('parses binary (0b and cellCount-width), hex, and decimal bitmasks', () => {
        const hexHass = hassWith({ 'sensor.jk_bms_balancer_status_bitmask': { state: '0x0005' } });
        const hexMask = parseBalancerBitmask(hexHass, config());
        expect(hexMask).toBe(5n);
        expect(isCellBalancingFromMask(hexMask, 1)).toBe(true);
        expect(isCellBalancingFromMask(hexMask, 2)).toBe(false);
        expect(isCellBalancingFromMask(hexMask, 3)).toBe(true);
        expect(isCellBalancing(hexHass, config(), 3)).toBe(true);

        const binPrefixHass = hassWith({ 'sensor.jk_bms_balancer_status_bitmask': { state: '0b1010' } });
        expect(parseBalancerBitmask(binPrefixHass, config())).toBe(10n);

        const binWidthHass = hassWith({ 'sensor.jk_bms_balancer_status_bitmask': { state: '0101' } });
        expect(parseBalancerBitmask(binWidthHass, config({ cellCount: 4 }))).toBe(5n);

        const decHass = hassWith({ 'sensor.jk_bms_balancer_status_bitmask': { state: '12' } });
        expect(parseBalancerBitmask(decHass, config())).toBe(12n);
    });

    it('returns 0n for unavailable or malformed bitmasks', () => {
        const hass = hassWith({
            'sensor.jk_bms_balancer_status_bitmask': { state: 'unavailable' },
        });
        expect(parseBalancerBitmask(hass, config())).toBe(0n);
    });
});

describe('unit normalization & formatting', () => {
    it('normalizes volts, millivolts, watts, amps, and Celsius', () => {
        expect(toVolts(3312, 'mV')).toBeCloseTo(3.312);
        expect(toVolts(3.312, 'V')).toBeCloseTo(3.312);
        expect(toMillivolts(0.015, 'V')).toBeCloseTo(15);
        expect(toMillivolts(15, 'mV')).toBeCloseTo(15);
        expect(toWatts(1.25, 'kW')).toBeCloseTo(1250);
        expect(toWatts(500, 'mW')).toBeCloseTo(0.5);
        expect(toWatts(100, 'W')).toBeCloseTo(100);
        expect(toWatts(100, 'VA')).toBeNull();
        expect(toAmps(1500, 'mA')).toBeCloseTo(1.5);
        expect(toAmps(12, 'A')).toBeCloseTo(12);
        expect(toAmps(12, 'kA')).toBeNull();
        expect(toCelsius(86, '°F')).toBeCloseTo(30);
        expect(toCelsius(30, '°C')).toBeCloseTo(30);
        expect(getTemperatureColor(68, '°F')).toBe(getTemperatureColor(20, '°C'));
    });

    it('formats V/mV and Ω/mΩ cleanly', () => {
        expect(formatValue('V', 'mV', 0.0123)).toBe('12 mV');
        expect(formatValue('mV', 'V', 12)).toBe('0.012 V');
        expect(formatValue('ohm', 'mΩ', 0.25)).toBe('250 mΩ');
        expect(formatValue('V', 'mV', 'unavailable')).toBe('-');
    });
});

describe('navigate, navigateEntityId & configOrEnum', () => {
    it('does nothing when preset suppresses an entity', () => {
        const dispatchEvent = vi.fn();
        const event = { stopPropagation: vi.fn(), target: { dispatchEvent } };
        navigate(event, config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos' }), EntityKey.min_voltage_cell);
        expect(dispatchEvent).not.toHaveBeenCalled();
    });

    it('dispatches hass-more-info via navigateEntityId and ignores missing entityId', () => {
        const dispatchEvent = vi.fn();
        const event = { stopPropagation: vi.fn(), target: { dispatchEvent } };
        navigateEntityId(event, 'sensor.jk_bms_total_voltage');
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect((dispatchEvent.mock.calls[0][0] as CustomEvent).detail).toEqual({
            entityId: 'sensor.jk_bms_total_voltage',
        });

        navigateEntityId(event, undefined);
        expect(dispatchEvent).toHaveBeenCalledTimes(1);
    });

    it('expands placeholders in configOrEnum', () => {
        expect(configOrEnum(config({ bmsModel: 'seplos_v3_ble', packIndex: 2 }), EntityKey.total_voltage)).toBe(
            'pack_1_voltage'
        );
        expect(configOrEnum(config({ bmsModel: 'seplos_v3_ble' }), EntityKey.min_voltage_cell)).toBe('');
    });
});
