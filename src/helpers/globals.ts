import { HomeAssistant } from 'custom-card-helpers';
import { JkBmsCardConfig } from '../interfaces';

export interface GlobalData {
  hass: HomeAssistant | null;
  cardConfig?: JkBmsCardConfig;
}

export const globalData: GlobalData ={
    hass: null as HomeAssistant | null,
};

export function setHass(hass: HomeAssistant) {
    globalData.hass = hass;
}