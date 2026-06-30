import { LovelaceCardConfig } from 'custom-card-helpers';
import { EntityKey } from './const';

export interface JkBmsCardConfig extends LovelaceCardConfig {
    title: string;
    prefix: string; // The entity prefix (e.g., "jk_bms_bms0_")
    cellCount: number;
    cellColumns: number;
    cellLayout: 'incremental' | 'bankMode';
    layout?: string;
    deltaVoltageUnit?: 'V' | 'mV';
    cellColorMode?: 'progress' | 'gradient';
    cellOrientation?: 'vertical' | 'horizontal';
    minCellVoltage?: number;
    maxCellVoltage?: number;
    titleAction?: 'device' | 'more-info';
    deviceId?: string;
    cells?: string[];
    cell_resistances?: string[];
    cellPrefix?: string;
    cellResistancePrefix?: string;
    entities: Record<EntityKey | string, string>;
}
