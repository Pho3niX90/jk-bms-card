import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { HomeAssistant, NumberFormat } from 'custom-card-helpers';
import { EntityKey } from '../const';
import { JkBmsCardConfig } from '../interfaces';
import { localize } from '../localize/localize';
import { globalData } from '../helpers/globals';
import { navigate, getState, getUnit, configOrEnum, formatValue, isCellBalancing, navigateTitle } from '../helpers/utils';
import { version } from '../../package.json';

@customElement('jk-bms-default-layout')
export class JkBmsDefaultLayout extends LitElement {
    @property() public hass!: HomeAssistant;
    @property() public config!: JkBmsCardConfig;

    minCellId: string = '';
    maxCellId: string = '';
    deltaV: number = 0.000;
    shouldBalance: boolean = false;
    VERSION = version;

    static styles = css`
        .grid {
            display: grid;
            gap: 4px;
            margin: 4px;
            align-content: center;
            min-width: 300px;
        }

        .grid-1 {
            grid-template-columns: 1fr;
        }

        .grid-2 {
            grid-template-columns: repeat(2, 1fr);
        }

        .grid-3 {
            grid-template-columns: repeat(3, 1fr);
        }

        .grid-4 {
            grid-template-columns: repeat(4, 1fr);
        }

        .grid-5 {
            grid-template-columns: repeat(5, 1fr);
        }

        .grid-6 {
            grid-template-columns: repeat(6, 1fr);
        }

        .grid-7 {
            grid-template-columns: repeat(7, 1fr);
        }

        .grid-8 {
            grid-template-columns: repeat(8, 1fr);
        }

        .center {
            text-align: center !important;
            align-content: center !important;
        }

        .cell-container {
            display: flex;
            flex-direction: row;
            container-type: inline-size;
            align-items: center;
            justify-content:center;
            container-type: inline-size;
        }

        div[class^="cell-div-"] {
            width: auto;
            padding-left: 5px;
            padding-right: 5px;
        }

        .multi-line {
            display: flex !important;
            flex-direction: column !important; 
            align-items: center; 
            justify-content: center;
            padding: 5px 0px;
            gap: 2px; 
        }

        .single-line {
            display: flex !important;
            flex-direction: row !important;
            align-items: center;
            gap: 5px;
        }

        .multi-line, .single-line {
            width: 100%; 
            height: 100%;
            align-items: center;
            justify-content: center;
        }

        .label {
            font-size: clamp(0.68rem, round(20cqi + 0.2rem, 0.1rem), 1rem) !important;
            white-space: nowrap;
        }
        
        .label.stats {
            font-size: clamp(0.48rem, round(14cqi + 0.2rem, 0.1rem), 1rem) !important;
            width: 100%;
        }
        
        .label.res {
            font-size: clamp(0.64rem, round(14cqi + 0.2rem, 0.1rem), 0.8rem) !important;
        }

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
        
        .data-row {
            display: flex;
            justify-content: flex-start;
            gap: 4px;
        }

        .data-row.split {
            justify-content: space-between;
            margin-right: 4px;
            white-space: nowrap;
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

        .status-on {
            color: #41cd52;
        }

        .status-off {
            color: red;
        }

        .voltage-high {
            color: #3090C7;
        }

        .voltage-low {
            color: red;
        }

        .cell-balancing .pill,
        .cell-balancing .label {
            color: #41CD52;
            font-weight: bold;
        }

        .pill {
            display: inline-block;
            padding: 0.2rem 0.2rem;
            background-color: #195569;
            color: #e4f3f8;
            border-radius: 999px;
            font-weight: 500;
            font-family: sans-serif;
            font-size: clamp(0.8rem, round(10cqi + 0.2rem, 0.2rem), 0.9rem);
            min-width: 1.8rem;
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

        .cardVersion {
            text-align: right;
            margin-right: 5px;
        }
        
        .version {
            font-style: italic;
            font-size: 0.8rem;
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

    private _navigate(event, entityId: EntityKey, type: "sensor" | "switch" | "number" = "sensor") {
        navigate(event, this.config, entityId, type, this.hass);
    }

    private _navigateTitle(event) {
        navigateTitle(event, this.hass, this.config);
    }

    private getState(entityKey: EntityKey, precision: number = 2, defaultValue = '', type: "sensor" | "switch" | "number" = "sensor"): string {
        return getState(this.hass, this.config, entityKey, precision, defaultValue, type);
    }

    private getUnit(entityKey: EntityKey): string {
        return getUnit(this.hass, this.config, entityKey);
    }

    private _renderSwitch(entityId: EntityKey, label: string): TemplateResult {
        const state = this.getState(entityId, 0, '', "switch");
        const colorClass = state === 'on' ? 'status-on' : 'status-off';
        return html`
      <div class="button-border button-padding center clickable" @click=${(e) => this._navigate(e, entityId, "switch")}>
        ${localize('switches.' + label)}: <span class="${colorClass}">${state.toUpperCase()}</span>
      </div>
    `;
    }

    configOrEnum(entityId: EntityKey) {
        return configOrEnum(this.config, entityId);
    }

    protected render() {
        globalData.hass = this.hass;
        if (!this.hass || !this.config) return html``;

        const hardwareVersion = this.getState(EntityKey.hardware_version);
        const softwareVersion = this.getState(EntityKey.software_version);
        const runtime = this.getState(EntityKey.total_runtime_formatted);
        const header = runtime && runtime != "unknown" ? html`${localize('html_texts.time')}: <b><font color="#3090C7">${runtime.toUpperCase()}</font></b>` : ''
        const batName = this.config.batteryName || '';

        const title = (this.config.title && this.config.title.toLocaleLowerCase() != localize('config.title').toLocaleLowerCase()) ? this.config.title : 
            html`${batName === '' ? '' : batName + ' | ' }${localize('html_texts.capacity')}: <b> ${this.getState(EntityKey.total_battery_capacity_setting)} Ah</b></br>
                HW: <b>${hardwareVersion}</b> | SW: <b>${softwareVersion}</b> | ${header}`;

        this.deltaV = parseFloat(this.getState(EntityKey.delta_cell_voltage, 3, '0'));
        const balanceCurrent = parseFloat(this.getState(EntityKey.balancing_current, 2, '0'));
        const powerNumber = parseFloat(this.getState(EntityKey.power, 2, '0'));

        this.shouldBalance = balanceCurrent != 0; // this is enough

        const powerClass = powerNumber > 0 ? 'power-positive' : powerNumber < 0 ? 'power-negative' : 'power-even'
        const balanceClass = balanceCurrent > 0 ? 'balance-positive' : balanceCurrent < 0 ? 'balance-negative' : 'balance-even';
        const deltaClass = this.shouldBalance ? 'delta-needs-balancing' : 'delta-ok';

        const socDecimals = this.config.socDecimals ?? 0;
        const customDecimals = this.config.customDecimals ?? 0;
        const showTitle = this.config.showTitle;
        const showButtons = this.config.showButtons;
        const showMain = this.config.showMain;
        const showCondensed = this.config.showCondensed;
        const showCells = this.config.showCells;
        const showRes = this.config.showResistances;
        const showCardVersion = this.config.showCardVersion;

        const rowClass = showCondensed ? 'stats data-row' : 'stats data-row split';

        this.minCellId = this.getState(EntityKey.min_voltage_cell, 0);
        this.maxCellId = this.getState(EntityKey.max_voltage_cell, 0);

        const isValidCellId = (value: any): boolean => {
            if (value == null || value === "") return false;                    
            const num = Number(value);                          
            return !isNaN(num) && isFinite(num) && num >= 0;   
        };

        const isValidDelta = (value: any): boolean => {
            if (value == null) return false;
            const num = Number(value);
            return !isNaN(num) && isFinite(num) && num > 0;
        };

        const hasValidMinMax = isValidCellId(this.minCellId) && isValidCellId(this.maxCellId);
        const hasValidDelta = isValidDelta(this.deltaV);

        if (!hasValidMinMax || !hasValidDelta) {
            this.calculateDynamicMinMaxCellId(this.config?.cellCount ?? 16);
        }

        return html`
        <ha-card>
            <div class="grid grid-1 p-3 section-padding">
                <div class="center clickable" @click=${(e) => this._navigateTitle(e)}>
                    ${showTitle ? title : ''}
                </div>
            </div>

            ${showButtons ? html`
            <div class="grid grid-${ this.config.hasHeater == '1' ? '4' : '3'}">
                ${this._renderSwitch(EntityKey.charging, 'charge')}
                ${this._renderSwitch(EntityKey.discharging, 'discharge')}
                ${this._renderSwitch(EntityKey.balancer, 'balance')}
                ${this.config.hasHeater == '1' ? this._renderSwitch(EntityKey.heater, 'heater') : ''}
            </div>    
            ` : html``}
            
            ${this._renderError()}
            
            ${showMain ? html`
            <div class="grid grid-2 section-padding">
                <div class="stats-padding stats-border">
                    <div class="clickable center" @click=${(e) => this._navigate(e, EntityKey.total_voltage)}>
                    <b><font color="#41CD52" size="6">${this.getState(EntityKey.total_voltage)} ${localize('html_texts.volt')}</font></b>
                    </div>
                    <div class="${rowClass}">${localize('stats.power')} <span class="label clickable ${powerClass}" @click=${(e) => this._navigate(e, EntityKey.power)}>${this.getState(EntityKey.power, customDecimals)} W</span></div>
                    <div class="${rowClass}">${localize('stats.capacity')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.total_battery_capacity_setting)}>${this.getState(EntityKey.total_battery_capacity_setting, customDecimals)} Ah</span></div>
                    <div class="${rowClass}">${localize('stats.cycleCapacity')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.total_charging_cycle_capacity)}>${this.getState(EntityKey.total_charging_cycle_capacity, customDecimals)} Ah</span></div>
                    <div class="${rowClass}">${localize('stats.averageCellV')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.average_cell_voltage)}>${this.getState(EntityKey.average_cell_voltage, 3)} ${localize('html_texts.volt')}</span></div>
                    ${EntityKey.min_cell_voltage && this.getState(EntityKey.min_cell_voltage) != '' ? html`<div class="${rowClass}">${localize('stats.minCellV')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.min_cell_voltage)}>${this.getState(EntityKey.min_cell_voltage, 3)} ${localize('html_texts.volt')}</span></div>` : ''}
                    <div class="${rowClass}">${localize('stats.balanceCurrent')} <span class="label ${balanceClass}">${balanceCurrent.toFixed(1)} A</span></div>
                    ${this._renderTemps(1)}
                </div>

                <div class="stats-padding stats-border">
                    <div class="clickable center" @click=${(e) => this._navigate(e, EntityKey.current)}>
                    <b><font color="#41CD52" size="6">${this.getState(EntityKey.current)} A</font></b>
                    </div>
                    <div class="${rowClass}">${localize('stats.stateOfCharge')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.state_of_charge)}>${this.getState(EntityKey.state_of_charge, socDecimals)} %</span></div>
                    <div class="${rowClass}">${localize('stats.remainingAmps')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.capacity_remaining)}>${this.getState(EntityKey.capacity_remaining, customDecimals)} Ah</span></div>
                    <div class="${rowClass}">${localize('stats.cycles')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.charging_cycles)}>${this.getState(EntityKey.charging_cycles, customDecimals)}</span></div>
                    <div class="${rowClass}">${localize('stats.delta')} <span class="label ${deltaClass}" @click=${(e) => this._navigate(e, EntityKey.delta_cell_voltage)}> ${formatValue(this.getUnit(EntityKey.delta_cell_voltage) ?? 'V', this.config.deltaVoltageUnit ?? 'V', this.deltaV)} </span></div>
                    ${EntityKey.max_cell_voltage && this.getState(EntityKey.max_cell_voltage) != '' ? html`<div class="${rowClass}">${localize('stats.maxCellV')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.max_cell_voltage)}>${this.getState(EntityKey.max_cell_voltage, 3)} ${localize('html_texts.volt')}</span></div>` : ''}
                    <div class="${rowClass}">${localize('stats.mosfetTemp')} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey.power_tube_temperature)}>${this.getState(EntityKey.power_tube_temperature)} ${this.getUnit(EntityKey.power_tube_temperature)}</span></div>
                    ${this._renderTemps(2)}
                </div>
            </div>
            
            ${this.shouldBalance ? html`
            <svg class="flow-line" id="flow-svg">
                <path id="flow-path" fill="none" />
            </svg>` : ''}   
            ` : html``}
            
            ${showCells ? html`
            <div class="grid grid-${this.config.cellColumns ?? 2}">
                ${this._renderCells(this.config.cellLayout == "bankMode", showRes)}
            </div>    
            `:html``}
            ${showCardVersion ? html`
            <div class="cardVersion">
                <span class="version">
                    v.${this.VERSION}
                </span>
            </div>
            ` : html``}
            
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
        const state = this.getState(EntityKey.errors, 0);
        if (state.trim().length <= 1 || state == '0') {
            return html``
        }
        return html`<span class="error-message">${state}</span>`
    }

    private _renderTemps(placement): TemplateResult {
        const sensors: TemplateResult[] = [];
        const sensorsCount = this.config?.tempSensorsCount ?? 0;
        const rowClass = this.config.showCondensed ? 'data-row' : 'data-row split'
        for (let i = placement; i <= sensorsCount; i += 2) {
            sensors.push(html`
                <div class="${rowClass}">${localize('stats.temperature_sensor_' + i)} <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey['temperature_sensor_' + i])}>${this.getState(EntityKey['temperature_sensor_' + i])} ${this.getUnit(EntityKey['temperature_sensor_' + i])}</span></div>`);
        }

        return html`${sensors}`;
    }

    private _renderCells(bankmode = true, showRes: boolean): TemplateResult {
        const cells: TemplateResult[] = [];

        const start = 1;
        const columns = this.config?.cellColumns ?? 2;
        const totalCells = this.config?.cellCount ?? 16;
        const bankOffset = Math.floor(totalCells / columns);
        const end = bankmode ? Math.ceil(totalCells / columns) : totalCells;
        const uneven = totalCells % columns

        for (let i = start; i <= end; i++) {
            if (bankmode && uneven && i == end) {
                cells.push(this._createCell(totalCells, columns, showRes));
            } else {
                cells.push(this._createCell(i, columns, showRes));
            }

            if (bankmode && (i < end || !uneven)) {
                for (let ii = 1; ii < columns; ii++) {
                    cells.push(this._createCell(i + (bankOffset * ii), columns, showRes));
                }
            }
        }

        return html`${cells}`;
    }

    private calculateDynamicMinMaxCellId(totalCells: number) {
        let minVoltage = Infinity;
        let maxVoltage = -Infinity;
        let minId = 0;
        let maxId = 0;

        for (let i = 1; i <= totalCells; i++) {
            const state = this.getState(EntityKey[`cell_voltage_${i}`], 3, '')
            const voltage = parseFloat(state);
            if (isNaN(voltage)) {
                continue;
            }
            if (voltage > maxVoltage) {
                maxVoltage = voltage;
                maxId = i;
            }

            if (voltage < minVoltage) {
                minVoltage = voltage;
                minId = i;
            }
        }

        this.minCellId = String(minId);
        this.maxCellId = String(maxId);
        this.deltaV = Number((maxVoltage - minVoltage).toFixed(3));
    }

    private _createCell(i, columns: number, showRes: boolean) {
        const voltage = this.getState(EntityKey[`cell_voltage_${i}`], 3, '0.0');
        const res = this.getUnit(EntityKey[`cell_resistance_${i}`]) ?? 'Ω'; // get original unit of resistance sensor, fallback to Ω
        const resUnit = this.config?.resistanceUnit ?? res; // get resistance from config, fallback to original unit
        const resistance = formatValue(res, resUnit, this.getState(EntityKey[`cell_resistance_${i}`], 3)).replace(' ', '');
        const minCell = this.minCellId;
        const maxCell = this.maxCellId;

        const color = i.toString() === minCell ? 'voltage-low'
            : i.toString() === maxCell ? 'voltage-high'
                : '';
        const balancingClass = isCellBalancing(this.hass, this.config, i) ? 'cell-balancing' : '';
        const resExists = showRes && resistance !== '-';
        const cellUnit = localize('html_texts.volt');

        let resistanceHtml = resExists ? html`
            <span class="label clickable" @click=${(e) => this._navigate(e, EntityKey[`cell_resistance_${i}`])}>
            ${columns <= 3 ? html` / ` : ''}${resistance}
          </span>` : '';

        return html`
            <div class="center cell-container ${balancingClass}" id="cell-${i}">
                <div class="cell-div-${i}">
                    <div class="clickable ${columns > 4 || (columns > 3 && resExists === true) ? "multi-line" : "single-line"}" @click=${(e) => this._navigate(e, EntityKey[`cell_voltage_${i}`],)}>
                        <span class="pill">${i.toString().padStart(2, '0')}</span>
                        <span class="label ${color}">${voltage}${resExists ? cellUnit : ''}</span>
                        ${resistanceHtml}
                    </div>
                </div>
            </div>
        `;
    }

    private _updateFlowLine() {
        const balanceCurrent = parseFloat(this.getState(EntityKey.balancing_current, 3, '0'));
        const minEl = this.renderRoot.querySelector(`.cell-div-${this.minCellId}`);
        const maxEl = this.renderRoot.querySelector(`.cell-div-${this.maxCellId}`);
        const path = this.renderRoot.querySelector('#flow-path') as SVGPathElement;

        if (!path || !minEl || !maxEl) return;

        if (!this.shouldBalance && balanceCurrent === 0) {
            path.setAttribute('d', '');
            path.style.display = 'none';
            return;
        }
        path.style.display = 'inline';

        const hostEl = this.renderRoot instanceof ShadowRoot ? (this.renderRoot.host as HTMLElement) : this;
        const cardRect = hostEl.getBoundingClientRect();
        const minRect = minEl.getBoundingClientRect();
        const maxRect = maxEl.getBoundingClientRect();

        const columns = this.config?.cellColumns ?? 2;
        const colWidth = cardRect.width / columns;

        // Columns calculation
        const colFrom = Math.floor((maxRect.left + maxRect.width / 2 - cardRect.left) / colWidth);
        const colTo   = Math.floor((minRect.left + minRect.width / 2 - cardRect.left) / colWidth);
        const isSameRow = Math.abs(maxRect.top - minRect.top) < 10;

        // Helper function for coordinates
        const getCoords = (rect: DOMRect, side: 'left' | 'right') => ({
            x: side === 'right' ? rect.right - cardRect.left : rect.left - cardRect.left,
            y: rect.top + rect.height / 2 - cardRect.top
        });

        let sideFrom: 'left' | 'right';
        let sideTo: 'left' | 'right';

        // Case 1:  same row -> directly horizontal bond
        if (isSameRow) {
            sideFrom = maxRect.left < minRect.left ? 'right' : 'left';
            sideTo   = maxRect.left < minRect.left ? 'left'  : 'right';
        }
        // Case 2: same column -> U-shape on the card's center side-most
        else if (colFrom === colTo) {
            const side = (colFrom < columns / 2) ? 'right' : 'left';
            sideFrom = sideTo = side;
        }
        // Case 3: Different columns
        else {
            const direction = colFrom < colTo ? 'rightToLeft' : 'leftToRight';
            // For adjacents, we can use the same side if we are on the margins
            const isAdjacent = Math.abs(colFrom - colTo) === 1;
            if (isAdjacent) {
                // If we are on the first column, we get out on the right (to interior)
                if (colFrom === 0) {
                    sideFrom = 'right';
                    sideTo   = (colTo === 1) ? 'right' : 'left';
                }
                // If we are on the latest column, we get out on the left
                else if (colFrom === columns - 1) {
                    sideFrom = 'left';
                    sideTo   = (colTo === columns - 2) ? 'left' : 'right';
                }
                else {
                    // Normal comportament for internal adjacents
                    sideFrom = direction === 'rightToLeft' ? 'right' : 'left';
                    sideTo   = direction === 'rightToLeft' ? 'left'  : 'right';
                }
            } else {
                // Separated columns -> Classic Z
                sideFrom = direction === 'rightToLeft' ? 'right' : 'left';
                sideTo   = direction === 'rightToLeft' ? 'left'  : 'right';
            }
        }

        const from = getCoords(maxRect, sideFrom);
        const to   = getCoords(minRect, sideTo);

        const offset = 14;
        let d: string;

        if (sideFrom === sideTo) {
            // U-shape
            const isRight = sideFrom === 'right';
            const elbowX = isRight
                ? Math.max(from.x, to.x) + offset
                : Math.min(from.x, to.x) - offset;
            d = `M ${from.x},${from.y} L ${elbowX},${from.y} L ${elbowX},${to.y} L ${to.x},${to.y}`;
        } else {
            // Z-shape
            const midX = (from.x + to.x) / 2;
            d = `M ${from.x},${from.y} L ${midX},${from.y} L ${midX},${to.y} L ${to.x},${to.y}`;
        }

        path.setAttribute('d', d);
    }
}
