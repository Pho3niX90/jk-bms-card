import { LovelaceCardConfig } from 'custom-card-helpers';
import { EntityKey } from './const';
import type { BmsModel } from './presets';

export type ExtraEntityKey = 'cell_prefix' | 'cell_resistance_prefix' | 'device_id';

export interface JkBmsPackConfig {
    id?: string;
    name?: string;
    prefix: string;
    bmsModel?: BmsModel;
    packIndex?: number;
    batteryNumber?: number;
    cellCount?: number;
    tempSensorsCount?: number;
    hasHeater?: boolean;
    deviceId?: string;
    navigationPath?: string;
    entities?: Partial<Record<EntityKey | ExtraEntityKey, string>>;
    cells?: string[];
    cellResistances?: string[];
    cellPrefix?: string;
    cellResistancePrefix?: string;
}

export interface JkBmsCardConfig extends LovelaceCardConfig {
    title: string;
    bmsModel?: BmsModel;
    prefix: string; // The entity prefix (e.g., "jk_bms_bms0_")
    batteryName?: string;
    batteryNumber?: number;
    packIndex?: number;
    cellCount: number;
    cellColumns: number;
    cellLayout: 'incremental' | 'bankMode';
    layout?: string;
    deltaVoltageUnit?: 'V' | 'mV';
    resistanceUnit?: 'Ω' | 'mΩ';
    deltaWarningMv?: number;
    cellColorMode?: 'progress' | 'gradient';
    cellOrientation?: 'vertical' | 'horizontal';
    minCellVoltage?: number;
    maxCellVoltage?: number;
    titleAction?: 'device' | 'more-info';
    deviceId?: string;
    packs?: JkBmsPackConfig[];
    cells?: string[];
    cellResistances?: string[];
    cellPrefix?: string;
    cellResistancePrefix?: string;
    entities: Partial<Record<EntityKey | ExtraEntityKey, string>>;
}
