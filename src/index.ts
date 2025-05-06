import {css, html, LitElement, TemplateResult} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {HomeAssistant, LovelaceCardEditor} from 'custom-card-helpers';
import {EDITOR_NAME, MAIN_NAME} from './const';
import {JkBmsCardConfig} from './interfaces';
import {localize} from './localize/localize';

import {version} from '../package.json';
import {globalData} from './helpers/globals';

export const CARD_VERSION = version;

console.groupCollapsed(
    `%c🔋 JK-BMS Battery Card%c   ready!  🚀 (v${CARD_VERSION})`,
    'background: linear-gradient(to right, #41cd52, #3090c7); color: white; font-weight: bold; padding: 2px 8px; border-radius: 6px;',
    'background: none; color: #AAA; font-style: italic;'
);
console.log('%c📖 Docs:', 'color: #41cd52; font-weight: bold;', 'https://github.com/Pho3niX90/jk-bms-card');
console.groupEnd();

@customElement(MAIN_NAME)
export class JkBmsCard extends LitElement{
    @property() public hass!: HomeAssistant;
    @property() private _config?: JkBmsCardConfig;

    public setConfig(config: JkBmsCardConfig): void {
        this._config = {...this._config, ...config};
    }

    static getStubConfig() {
        return {
            title: localize("title"),
            prefix: "jk_bms",
            cellCount: 16,
            cellColumns: 2,
            cellLayout: "bankMode",
        } as unknown as JkBmsCardConfig;
    }

    public static async getConfigElement() {
        await import("./editor");
        return document.createElement(EDITOR_NAME) as LovelaceCardEditor;
    }

    public getCardSize(): number {
        return 3;
    }

    static styles = css`
        .grid {
            display: grid;
            gap: 4px;
            margin: 4px;
        }
        .grid-1 { grid-template-columns: 1fr; }
        .grid-2 { grid-template-columns: repeat(2, 1fr); }
        .grid-3 { grid-template-columns: repeat(3, 1fr); }
        .grid-4 { grid-template-columns: repeat(4, 1fr); }
        .grid-5 { grid-template-columns: repeat(5, 1fr); }
        .grid-6 { grid-template-columns: repeat(6, 1fr); }
        .grid-7 { grid-template-columns: repeat(7, 1fr); }
        .grid-8 { grid-template-columns: repeat(8, 1fr); }
        .clickable {
            cursor: pointer;
        }
        .section-padding {
            padding-top: 0.45rem;
            padding-bottom: 0.75rem;
        }
        .stats-padding {
            padding-top: 0.75rem;
            padding-left: 0.75rem;
        }
        .power-negative {
            color: red
        }
        .power-positive {
            color: #41cd52
        }
        .power-even {
            color: #808080
        }
        .balance-positive {
            color: red
        }
        .balance-negative {
            color: #3090C7
        }
        .balance-even {
            color: #808080
        }
        .delta-needs-balancing {
            color: #FFA500
        }
        .delta-ok {
            color: #41CD52
        }
        .stats-border {
            border-width: var(--ha-card-border-width, 1px);
            border-style: solid;
            border-color: var(--ha-card-border-color, var(--divider-color, #e0e0e0));
        }
        .button-border {
            border-width: var(--ha-card-border-width, 1px);
            border-style: solid;
            border-color: var(--ha-card-border-color, var(--divider-color, #e0e0e0));
        }
        .error-message {
            color: red;
            font-style: italic;
        }
        .button-padding {
            padding-top: 0.75rem;
            padding-bottom: 0.75rem;
        }
        .status-on { color: #41cd52; }
        .status-off { color: red; }
        .voltage-high { color: #3090C7; }
        .voltage-low { color: red; }
        .center { text-align: center; }
        .pill {
            display: inline-block;
            padding: 0.15rem 0.25rem;
            background-color: #195569;
            color: #e4f3f8;
            border-radius: 999px;
            font-weight: 500;
            font-family: sans-serif;
            font-size: 0.9rem;
            min-width: 2rem;
            text-align: center;
        }
        .flow-line {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }
        
        line {
            stroke: #3090C7;
            stroke-width: 2;
            stroke-dasharray: 6;
            animation: dashmove 1s linear infinite;
            filter: drop-shadow(0 0 4px #41cd52);
        }
        path {
            stroke: #3090C7;
            stroke-width: 3;
            stroke-linecap: round;
            fill: none;
            stroke-dasharray: 10;
            stroke-dashoffset: 0;
            animation: dashmove 1.2s linear infinite;
            filter: drop-shadow(0 0 4px #41cd52);
         }

        @keyframes dashmove {
            from {
                stroke-dashoffset: 0;
            }
            to {
                stroke-dashoffset: -20;
            }
        }
    `;

    private _navigate(event, entityId: string, type: "sensor" | "switch" | "number" = "sensor") {
        if (!event) {
            return;
        }

        event.stopPropagation();

        const fullEntityId = type + "." + this._config?.prefix + "_" + entityId;
        let customEvent = new CustomEvent('hass-more-info', {
            detail: { entityId: fullEntityId },
            composed: true,
        })
        event.target.dispatchEvent(customEvent);
    }

    private _state(suffix: string, defaultValue = '', type: "sensor" | "switch" | "number" = "sensor"): string {
        const entityId = `${type}.${this._config!.prefix}_${suffix}`;
        const entity = this.hass?.states[entityId];
        const state = entity?.state;

        return state ?? defaultValue;
    }

    render() {
        globalData.hass = this.hass;
        if (!this.hass || !this._config) return html``;
        const title = this._config.title || 'Bat 1';

        const deltaCellV = parseFloat(this._state('delta_cell_voltage', '0'));
        const balanceCurrent = parseFloat(this._state('balancing_current', '0'));
        const powerNumber = parseFloat(this._state('power', '0'));
        const triggerV= Number(this._state("balance_trigger_voltage", "", "number"));

        const powerClass = powerNumber > 0 ? 'power-positive' : powerNumber < 0 ? 'power-negative' : 'power-even'
        const balanceClass = balanceCurrent > 0 ? 'balance-positive' : balanceCurrent < 0 ? 'balance-negative' : 'balance-even';
        const deltaClass = deltaCellV >= triggerV ? 'delta-needs-balancing' : 'delta-ok'

        return html`
      <ha-card>
        <div class="grid grid-1 p-3 section-padding">
          <div class="center clickable" @click=${(e) => this._navigate(e, `total_runtime_formatted`)}>
            ${title} | Time: <b><font color="#3090C7">${this._state('total_runtime_formatted').toUpperCase()}</font></b>
          </div>
        </div>

        <div class="grid grid-3">
          ${this._renderSwitch('charging', 'charge')}
          ${this._renderSwitch('discharging', 'discharge')}
          ${this._renderSwitch('balancer', 'balance')}
        </div>
          
          ${this._renderError()}

        <div class="grid grid-2 section-padding">
          <div class="stats-padding stats-border">
            <div class="clickable center" @click=${(e) => this._navigate(e, `total_voltage`)}>
              <b><font color="#41CD52" size="6">${this._state('total_voltage')} V</font></b>
            </div>
              ${localize('stats.power')} <span class="clickable ${powerClass}" @click=${(e) => this._navigate(e, `power`)}>${this._state('power')} W</span><br>
              ${localize('stats.capacity')} <span class="clickable" @click=${(e) => this._navigate(e, `total_battery_capacity_setting`)}>${this._state('total_battery_capacity_setting')} Ah</span><br>
              ${localize('stats.cycleCapacity')} <span class="clickable" @click=${(e) => this._navigate(e, `total_charging_cycle_capacity`)}>${this._state('total_charging_cycle_capacity')} Ah</span><br>
              ${localize('stats.averageCellV')} <span class="clickable" @click=${(e) => this._navigate(e, `average_cell_voltage`)}>${this._state('average_cell_voltage')} V</span><br>
              ${localize('stats.balanceCurrent')} <span class="${balanceClass}">
              ${balanceCurrent.toFixed(1)} A
            </span>
          </div>

          <div class="stats-padding stats-border">
            <div class="clickable center" @click=${(e) => this._navigate(e, `current`)}>
              <b><font color="#41CD52" size="6">${this._state('current')} A</font></b>
            </div>
              ${localize('stats.stateOfCharge')} <span class="clickable" @click=${(e) => this._navigate(e, `state_of_charge`)}>${this._state('state_of_charge')} %</span><br>
              ${localize('stats.remainingAmps')} <span class="clickable" @click=${(e) => this._navigate(e, `capacity_remaining`)}>${this._state('capacity_remaining')} Ah</span><br>
              ${localize('stats.cycles')} <span class="clickable" @click=${(e) => this._navigate(e, `charging_cycles`)}>${this._state('charging_cycles')}</span><br>
              ${localize('stats.delta')} <span class="${deltaClass}">
              ${deltaCellV.toFixed(3)} V
            </span><br>
              ${localize('stats.mosfetTemp')} <span class="clickable" @click=${(e) => this._navigate(e, `power_tube_temperature`)}>${this._state('power_tube_temperature')} °C</span>
          </div>
        </div>

          <svg class="flow-line" id="flow-svg">
              <path id="flow-path" fill="none" />
          </svg>

          <div class="grid grid-${this._config.cellColumns ?? 2}">
          ${this._renderCells(this._config.cellLayout == "bankMode")}
        </div>
      </ha-card>
    `;
    }
    updated() {
        requestAnimationFrame(() => this._updateFlowLine());
    }
    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('resize', this._updateFlowLine.bind(this));
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('resize', this._updateFlowLine.bind(this));
    }


    private _renderError() {
        const state = this._state('errors', '', "sensor");
        if (state.trim().length <= 1) {
            return html``
        }
        return html`<span class="error-message">${state}</span>`
    }

    private _renderSwitch(entityId: string, label: string): TemplateResult {
        const state = this._state(entityId, '', "switch");
        const colorClass = state === 'on' ? 'status-on' : 'status-off';
        return html`
      <div class="button-border button-padding center clickable" @click=${(e) => this._navigate(e, `${entityId}`, "switch")}>
        ${localize('switches.'+label)}: <span class="${colorClass}">${state.toUpperCase()}</span>
      </div>
    `;
    }

    private _renderCells(bankmode = true): TemplateResult {
        const cells: TemplateResult[] = [];

        const start = 1;
        const columns = this._config?.cellColumns ?? 2;
        const totalCells =  this._config?.cellCount ?? 16;
        const bankOffset = Math.floor(totalCells / columns);
        const end = bankmode ? Math.ceil(totalCells / columns) : totalCells;
        const uneven = totalCells % columns

        for (let i = start; i <= end; i++) {
            if (bankmode && uneven && i == end) {
                cells.push(this._createCell(totalCells));
            } else  {
                cells.push(this._createCell(i));
            }

            if (bankmode && (i < end || !uneven)) {
                for (let ii = 1; ii < columns; ii++) {
                    cells.push(this._createCell(i + (bankOffset * ii)));
                }
            }
        }

        return html`${cells}`;
    }

    private _createCell(i) {
        const voltage = this._state(`cell_voltage_${i}`, '0.0');
        const resistance = this._state(`cell_resistance_${i}`, '');
        const minCell = this._state('min_voltage_cell');
        const maxCell = this._state('max_voltage_cell');

        const color = i.toString() === minCell ? 'voltage-low'
            : i.toString() === maxCell ? 'voltage-high'
            : '';

        let resistanceHtml = resistance == '' ? '' : html`
            <span class="clickable" @click=${(e) => this._navigate(e, `cell_resistance_${i}`)}>
            / ${resistance} Ω
          </span>`

        return html`
            <div class="center cell-container" id="cell-${i}">
            <span class="clickable" @click=${(e) => this._navigate(e, `cell_voltage_${i}`)}>
                <span class="pill">${i.toString().padStart(2, '0')}</span>
            ${color ? html`<span class="${color}">${voltage} V</span>` : html`${voltage} V`}
          </span>
                ${resistanceHtml}
            </div>
        `;
    }
    private _updateFlowLine() {
        const minId = this._state('min_voltage_cell');
        const maxId = this._state('max_voltage_cell');
        const balanceCurrent = parseFloat(this._state('balancing_current', '0'));

        const minEl = this.renderRoot.querySelector(`#cell-${minId}`);
        const maxEl = this.renderRoot.querySelector(`#cell-${maxId}`);
        const path = this.renderRoot.querySelector('#flow-path') as SVGPathElement;

        if (!path) return;

        if (balanceCurrent === 0 || !minEl || !maxEl) {
            path.setAttribute('d', '');
            path.style.display = 'none';
            return;
        }

        path.style.display = 'inline';

        const hostEl = this.renderRoot instanceof ShadowRoot
            ? this.renderRoot.host as HTMLElement
            : this;

        const cardRect = hostEl.getBoundingClientRect();
        const minRect = minEl.getBoundingClientRect();
        const maxRect = maxEl.getBoundingClientRect();

        const getSideAnchor = (rect: DOMRect): { side: 'left' | 'right', x: number, y: number } => {
            const centerX = rect.left + rect.width / 2;
            const midCardX = cardRect.left + cardRect.width / 2;
            const side = centerX < midCardX ? 'right' : 'left';
            const x = side === 'right' ? rect.right - cardRect.left : rect.left - cardRect.left;
            const y = rect.top + rect.height / 2 - cardRect.top;
            return { side, x, y };
        };

        const from = getSideAnchor(maxRect);
        const to = getSideAnchor(minRect);

        const horizontalOffset = 10;
        let d: string;

        if (from.side === to.side) {
            const elbowX = from.side === 'right'
                ? from.x + horizontalOffset
                : from.x - horizontalOffset;

            d = `M ${from.x},${from.y}
             L ${elbowX},${from.y}
             L ${elbowX},${to.y}
             L ${to.x},${to.y}`;
        } else {
            const midX = (from.x + to.x) / 2;

            d = `M ${from.x},${from.y}
             L ${midX},${from.y}
             L ${midX},${to.y}
             L ${to.x},${to.y}`;
        }

        path.setAttribute('d', d);
    }
}

(window as any).customCards.push({
    type: MAIN_NAME,
    name: 'JK BMS Card',
    preview: true,
    description: localize('common.description'),
    configurable: true
});