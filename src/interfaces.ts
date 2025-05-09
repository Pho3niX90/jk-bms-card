import {LovelaceCardConfig} from 'custom-card-helpers';
import {EntityKey} from './const';

export interface JkBmsCardConfig extends LovelaceCardConfig {
    title: string;
    prefix: string; // The entity prefix (e.g., "jk_bms_bms0_")
    cellCount: number;
    cellColumns: number;
    cellLayout: 'incremental' | 'bankMode';
    entities: Record<EntityKey, string>;
}