import {css, html, LitElement, TemplateResult} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {HomeAssistant} from 'custom-card-helpers';
import {EntityKey} from '../const';
import {JkBmsCardConfig} from '../interfaces';
import {globalData} from '../helpers/globals';
import {configOrEnum, formatDeltaVoltage, getState, navigate} from '../helpers/utils';

@customElement('jk-bms-core-reactor-layout')
export class JkBmsCoreReactorLayout extends LitElement {
    @property() public hass!: HomeAssistant;
    @property() public config!: JkBmsCardConfig;

    minCellId: string = '';
    maxCellId: string = '';
    maxDeltaV: number = 0.000;
    shouldBalance: boolean = false;

    @property() private historyData: Record<string, any[]> = {};
    private _historyInterval?: number;

    static styles = css`
        :host {
            --primary-text-color: #e1e1e1;
            --secondary-text-color: #9b9b9b;
            --accent-color: #41cd52;
            --accent-color-dim: rgba(65, 205, 82, 0.2);
            --discharge-color: #3090c7;
            --discharge-color-dim: rgba(48, 144, 199, 0.2);
            --panel-bg: rgba(255, 255, 255, 0.05);
            --panel-border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .container {
            font-family: 'Roboto', sans-serif;
            color: var(--primary-text-color);
            padding: 8px;
            box-sizing: border-box;
            background: #1c1c1c; /* Fallback/Base dark */
            border-radius: var(--ha-card-border-radius, 12px);
        }

        .header {
            text-align: center;
            font-size: 1.1em;
            margin-bottom: 16px;
            color: var(--secondary-text-color);
        }

        .header b {
            color: var(--discharge-color);
        }

        /* Top Section: Flow & Reactor */

        .top-section {
            display: grid;
            grid-template-columns: 1fr 1.2fr 1fr;
            align-items: center;
            margin-bottom: 16px;
            position: relative;
            height: 180px;
        }

        .flow-node {
            display: flex;
            flex-direction: column;
            align-items: center;
            z-index: 2;
        }

        .icon-circle {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: 2px solid var(--secondary-text-color);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 4px;
            background: #2a2a2a;
        }

        .icon-circle ha-icon {
            --mdc-icon-size: 30px;
        }

        .node-label {
            font-size: 0.9em;
            color: var(--secondary-text-color);
        }

        .node-status {
            font-size: 0.85em;
        }

        .reactor-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
            z-index: 2;
        }

        .reactor-ring {
            width: 140px;
            height: 140px;
            border-radius: 50%;
            border: 6px solid var(--accent-color);
            box-shadow: 0 0 15px var(--accent-color-dim);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: radial-gradient(circle, rgba(65, 205, 82, 0.1) 0%, rgba(0, 0, 0, 0) 70%);
        }

        .soc-label {
            font-size: 0.9em;
            color: var(--secondary-text-color);
        }

        .soc-value {
            font-size: 2.2em;
            font-weight: bold;
            color: var(--accent-color);
        }

        .capacity-val {
            font-size: 0.85em;
            color: var(--secondary-text-color);
            margin-top: -4px;
        }

        /* Middle Grid */

        .middle-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 16px;
        }

        .stats-panel {
            background: var(--panel-bg);
            border: var(--panel-border);
            border-radius: 10px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }

        .stat-label {
            font-size: 0.85em;
            color: var(--secondary-text-color);
            margin-bottom: 4px;
        }

        .stat-value {
            font-size: 1.4em;
            font-weight: bold;
        }

        .stat-sub {
            font-size: 0.8em;
            color: var(--secondary-text-color);
            margin-top: 2px;
        }

        .val-white {
            color: #fff;
        }

        .val-green {
            color: var(--accent-color);
        }

        .val-blue {
            color: var(--discharge-color);
        }

        .val-orange {
            color: orange;
        }

        /* Cell Grid */

        .cell-grid {
            display: grid;
            gap: 6px;
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

        .cell-item {
            background: #2a2a2a;
            border-radius: 8px;
            padding: 4px 6px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            font-size: 0.85em;
            position: relative;
            overflow: hidden;
            z-index: 0;
        }

        .cell-item-vertical {
            flex-direction: column;
            justify-content: center;
            padding: 6px 4px;
            gap: 3px;
        }

        .cell-item-vertical .cell-id {
            margin-right: 0;
            margin-bottom: 2px;
        }

        .cell-item-bg {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: rgba(48, 144, 199, 0.2);
            z-index: -1;
            transition: width 0.5s ease-out;
        }

        .cell-id {
            display: inline-block;
            padding: 0.1rem 0.25rem;
            background-color: #195569;
            color: #e4f3f8;
            border-radius: 999px;
            font-weight: 500;
            font-size: 0.7em;
            min-width: 1.4rem;
            text-align: center;
            margin-right: 3px;
            flex-shrink: 0;
        }

        .cell-volts {
            color: #e1e1e1;
            font-family: monospace;
            font-size: 0.9em;
        }

        .cell-res {
            color: #90a4ae;
            font-size: 0.8em;
            font-family: monospace;
        }

        .cell-low {
            color: #FFA500;
        }

        /* Example warning color */

        .cell-high {
            color: var(--discharge-color);
        }

        .status-on {
            color: var(--accent-color);
            font-weight: bold;
        }

        .status-off {
            color: #666;
            font-weight: bold;
        }

        .clickable {
            cursor: pointer;
        }

        /* SVG Overlay for Lines */

        .flow-svg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }

        .flow-svg path {
            fill: none;
            stroke-width: 2;
            stroke-dasharray: 8;
            animation: flow 1s linear infinite;
        }

        .path-charge {
            stroke: var(--accent-color);
        }

        .path-discharge {
            stroke: var(--discharge-color);
        }

        .path-inactive {
            stroke: #444;
            stroke-dasharray: 0;
            animation: none;
        }

        @keyframes flow {
            from {
                stroke-dashoffset: 16;
            }
            to {
                stroke-dashoffset: 0;
            }
        }

        /* Sparkline CSS */
        /* Sparkline CSS */

        .metric-group {
            position: relative;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 8px 0;
            z-index: 1;
        }

        .sparkline-container {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            opacity: 0.3;
            z-index: -1;
            pointer-events: none;
        }

        .sparkline-svg {
            width: 100%;
            height: 100%;
        }

        .spark-line {
            fill: none;
            stroke-width: 2;
            vector-effect: non-scaling-stroke;
        }

        .spark-area {
            fill-opacity: 0.2;
            stroke: none;
        }
    `;

    firstUpdated() {
        this.fetchHistory();
        this._historyInterval = window.setInterval(() => this.fetchHistory(), 60000); // Update every minute
    }

    private _navigate(event, entityId: EntityKey, type: "sensor" | "switch" | "number" = "sensor") {
        navigate(event, this.config, entityId, type);
    }

    updated(changedProps: Map<string, any>) {
        if (changedProps.has('hass')) {
            this._updateRealtimeHistory();
        }
    }

    private _updateRealtimeHistory() {
        if (!this.hass || !this.config) return;

        const keys = [
            EntityKey.total_voltage,
            EntityKey.current,
            EntityKey.power_tube_temperature,
            EntityKey.delta_cell_voltage
        ];

        let changed = false;
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000;

        keys.forEach(key => {
            const entityId = this._resolveEntityId(key);
            if (!entityId) return;

            const stateObj = this.hass.states[entityId];
            if (!stateObj) return;

            const val = parseFloat(stateObj.state);
            const time = new Date(stateObj.last_updated).getTime();

            if (isNaN(val)) return;

            const currentHistory = this.historyData[entityId] || [];
            const lastEntry = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1] : null;

            // Only append if it's a new update (time > last time)
            if (!lastEntry || time > lastEntry.time) {
                // Create new array to trigger reactivity if needed, or just push
                // For Lit reactivity on objects/arrays, purely pushing might not trigger unless we reassign or requestUpdate
                // But efficient way is:
                const newHistoryList = [...currentHistory, {state: val, time: time}];

                // Prune old
                while (newHistoryList.length > 0 && newHistoryList[0].time < oneHourAgo) {
                    newHistoryList.shift();
                }

                this.historyData = {...this.historyData, [entityId]: newHistoryList};
                changed = true;
            }
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._historyInterval) {
            clearInterval(this._historyInterval);
        }
    }

    async fetchHistory() {
        if (!this.hass || !this.config) return;

        const entitiesToFetch = [
            this._resolveEntityId(EntityKey.total_voltage),
            this._resolveEntityId(EntityKey.current),
            this._resolveEntityId(EntityKey.power_tube_temperature),
            this._resolveEntityId(EntityKey.delta_cell_voltage)
        ].filter(e => e);

        // Deduplicate
        const uniqueEntities = [...new Set(entitiesToFetch)];
        if (uniqueEntities.length === 0) return;

        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago

        try {
            // Using WebSocket API for history
            const response = await this.hass.callWS({
                type: 'history/history_during_period',
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                entity_ids: uniqueEntities,
                minimal_response: true,
                no_attributes: true
            });

            if (response) {
                const newHistory = {};
                // Response is an object: { "entity_id": [ { s: state, lu: last_updated_timestamp }, ... ] }
                // or just standard history objects depending on HA version, but 'minimal_response' gives shorthand.

                Object.keys(response).forEach(entityId => {
                    const historyList = response[entityId];
                    if (Array.isArray(historyList)) {
                        newHistory[entityId] = historyList.map(entry => ({
                            // 's' is state, 'lu' is last_updated (seconds since epoch)
                            state: parseFloat(entry.s || entry.state),
                            time: (entry.lu || new Date(entry.last_updated).getTime() / 1000) * 1000
                        })).filter(e => !isNaN(e.state));
                    }
                });
                this.historyData = {...this.historyData, ...newHistory};
            }
        } catch (e) {
            console.warn("JK BMS Card: Failed to fetch history via WS", e);
        }
    }

    configOrEnum(entityId: EntityKey) {
        return configOrEnum(this.config, entityId);
    }

    private _resolveEntityId(entityKey: EntityKey): string | undefined {
        const configValue = this.configOrEnum(entityKey);
        if (!configValue) return undefined;
        // Logic must match getState: if regular entity_id (contains dot), use as is.
        // Otherwise assume it's a suffix and prepend sensor.<prefix>_
        return configValue.includes('.') ? configValue : `sensor.${this.config.prefix}_${configValue}`;
    }

    _renderSparkline(entityKey: EntityKey, color: string): TemplateResult {
        const entityId = this._resolveEntityId(entityKey);
        if (!entityId || !this.historyData[entityId] || this.historyData[entityId].length < 2) {
            return html`
                <div style="height: 30px;"></div>`;
        }

        const data = this.historyData[entityId];
        // Calculate min/max for scaling
        let min = Infinity;
        let max = -Infinity;
        data.forEach(d => {
            const cState = Number(Number(d.state).toFixed(3));
            if (cState < min) min = cState;
            if (cState > max) max = cState;
        });

        // Add 5% padding to min/max to avoid flatlining at edges unless flat
        let range = max - min;
        // Enforce min_ange to prevent noise amplification
        const MIN_RANGE = 1.0;

        if (range < MIN_RANGE) {
            const center = (min + max) / 2;
            min = center - MIN_RANGE / 2;
            max = center + MIN_RANGE / 2;
        } else {
            min -= range * 0.05;
            max += range * 0.05;
        }

        const startTime = data[0].time;
        const endTime = data[data.length - 1].time;
        const timeRange = endTime - startTime;

        if (timeRange <= 0) return html``;

        let pathD = '';
        data.forEach((pt, i) => {
            const x = ((pt.time - startTime) / timeRange) * 100;
            const y = 100 - ((pt.state - min) / (max - min)) * 100;
            pathD += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)} `;
        });

        return html`
            <div class="sparkline-container">
                <svg class="sparkline-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path class="spark-line" d="${pathD}" stroke="${color}"/>
                    <path class="spark-area" d="${pathD} L 100,100 L 0,100 Z" fill="${color}"/>
                </svg>
            </div>
        `;
    }

    private getState(entityKey: EntityKey, precision: number = 2, defaultValue = '', type: "sensor" | "switch" | "number" = "sensor"): string {
        return getState(this.hass, this.config, entityKey, precision, defaultValue, type);
    }

    protected render() {
        globalData.hass = this.hass;
        if (!this.hass || !this.config) return html``;

        const title = this.config.title || 'Bat 1';
        const runtime = this.getState(EntityKey.total_runtime_formatted);
        const header = runtime && runtime != "unknown" ? html` | Time: <b>${runtime.toUpperCase()}</b>` : '';

        const current = parseFloat(this.getState(EntityKey.current));

        // Flow Logic: 
        // Charge (Grid -> SOC) when current > 0
        // Discharge (SOC -> Load) when current < 0
        const isChargingFlow = current > 0;
        const isDischargingFlow = current < 0;
        const isCharging = this.getState(EntityKey.charging, 0, '', 'switch') === 'on';
        const isDischarging = this.getState(EntityKey.discharging, 0, '', 'switch') === 'on';

        // Stats
        const soc = this.getState(EntityKey.state_of_charge);
        const capacityVal = this.getState(EntityKey.total_battery_capacity_setting);
        // const current = parseFloat(this.getState(EntityKey.current)); // Already fetched above
        const totalVolts = this.getState(EntityKey.total_voltage);
        const mosTemp = this.getState(EntityKey.power_tube_temperature);

        this.calculateDynamicMinMax();

        return html`
            <ha-card class="container">
                <div class="header clickable" @click=${(e) => this._navigate(e, EntityKey.total_runtime_formatted)}>
                    ${title} ${header}
                </div>

                <div class="top-section">
                    <!-- Solar/Grid Node -->
                    <div class="flow-node">
                        <div class="icon-circle clickable"
                             @click=${(e) => this._navigate(e, EntityKey.charging, 'switch')}>
                            <ha-icon icon="mdi:solar-power"></ha-icon>
                        </div>
                        <div class="node-label">Grid/Solar</div>
                        <div class="node-status">
                            Charge: <span
                                class="${isCharging ? 'status-on' : 'status-off'}">${isCharging ? 'ON' : 'OFF'}</span>
                        </div>
                    </div>

                    <!-- Reactor (SOC) -->
                    <div class="reactor-container">
                        <div class="reactor-ring clickable"
                             @click=${(e) => this._navigate(e, EntityKey.state_of_charge)}>
                            <div class="soc-label">SOC:</div>
                            <div class="soc-value">${soc}%</div>
                            <div class="capacity-val clickable"
                                 @click=${(e) => this._navigate(e, EntityKey.capacity_remaining)}>
                                Remaining:<br>${this.getState(EntityKey.capacity_remaining)} Ah
                            </div>
                        </div>
                    </div>

                    <!-- Load Node -->
                    <div class="flow-node">
                        <div class="icon-circle clickable"
                             @click=${(e) => this._navigate(e, EntityKey.discharging, 'switch')}>
                            <ha-icon icon="mdi:power-plug"></ha-icon>
                        </div>
                        <div class="node-label">Load</div>
                        <div class="node-status">
                            Discharge: <span
                                class="${isDischarging ? 'status-on' : 'status-off'}">${isDischarging ? 'ON' : 'OFF'}</span>
                        </div>
                    </div>

                    <!-- SVG Flow Lines -->
                    <svg class="flow-svg" viewBox="0 0 400 180" preserveAspectRatio="none">
                        <!-- Left path (Charge) - Rough coordinates for now, will refine -->
                        <path d="M 60,70 Q 120,70 125,90" class="${isChargingFlow ? 'path-charge' : 'path-inactive'}"/>
                        <!-- Right path (Discharge) -->
                        <path d="M 275,90 Q 280,70 340,70"
                              class="${isDischargingFlow ? 'path-discharge' : 'path-inactive'}"
                              marker-end="url(#arrow)"/>

                        <defs>
                            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"
                                    markerUnits="strokeWidth">
                                <path d="M0,0 L0,6 L9,3 z" fill="${isDischarging ? '#3090c7' : '#444'}"/>
                            </marker>
                        </defs>
                    </svg>
                </div>

                <!-- Stats Panels -->
                <div class="middle-grid">
                    <div class="stats-panel">
                        <div class="metric-group">
                            ${this._renderSparkline(EntityKey.total_voltage, '#41CD52')}
                            <div class="stat-label">Total Voltage:</div>
                            <div class="stat-value val-white clickable"
                                 @click=${(e) => this._navigate(e, EntityKey.total_voltage)}>${totalVolts} V
                            </div>
                        </div>

                        <div class="metric-group">
                            ${this._renderSparkline(EntityKey.current, '#3090c7')}
                            <div class="stat-label">Current:</div>
                            <div class="stat-value val-white clickable"
                                 @click=${(e) => this._navigate(e, EntityKey.current)}>${current} A
                            </div>
                        </div>
                    </div>

                    <div class="stats-panel">
                        <div class="metric-group">
                            ${this._renderSparkline(EntityKey.power_tube_temperature, '#FFA500')}
                            <div class="stat-label">MOS Temp:</div>
                            <div class="stat-value val-white clickable"
                                 @click=${(e) => this._navigate(e, EntityKey.power_tube_temperature)}>${mosTemp} °C
                            </div>
                        </div>

                        <div class="metric-group">
                            ${this._renderSparkline(EntityKey.delta_cell_voltage, '#41CD52')}
                            <div class="stat-label">Delta ${this.config.deltaVoltageUnit || 'V'}:</div>
                            <div class="stat-value val-green clickable"
                                 @click=${(e) => this._navigate(e, EntityKey.delta_cell_voltage)}>
                                ${formatDeltaVoltage(this.config.deltaVoltageUnit, this.maxDeltaV)}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Cells -->
                <div class="cell-grid grid-${this.config.cellColumns ?? 2}">
                    ${this._renderCells()}
                </div>

            </ha-card>
        `;
    }

    private calculateDynamicMinMax() {
        // Logic reused/adapted from default layout to find min/max cell for highlighting
        let minV = Infinity;
        let maxV = -Infinity;
        let minId = '';
        let maxId = '';
        const count = this.config.cellCount || 16;

        for (let i = 1; i <= count; i++) {
            const vStr = this.getState(EntityKey[`cell_voltage_${i}`] as EntityKey, 3, '');
            const v = parseFloat(vStr);
            if (!isNaN(v)) {
                if (v < minV) {
                    minV = v;
                    minId = String(i);
                }
                if (v > maxV) {
                    maxV = v;
                    maxId = String(i);
                }
            }
        }

        if (minV === Infinity || maxV === -Infinity) {
            this.maxDeltaV = 0;
            this.minCellId = '';
            this.maxCellId = '';
        } else {
            this.minCellId = minId;
            this.maxCellId = maxId;
            this.maxDeltaV = parseFloat((maxV - minV).toFixed(3));
        }
    }

    private _renderCells(): TemplateResult[] {
        const cells: TemplateResult[] = [];
        const bankMode = this.config.cellLayout === 'bankMode';
        const columns = this.config.cellColumns || 2;
        const totalCells = this.config.cellCount || 16;
        const bankOffset = Math.floor(totalCells / columns);
        const end = bankMode ? Math.ceil(totalCells / columns) : totalCells;
        const uneven = totalCells % columns;

        for (let i = 1; i <= end; i++) {
            // Determine which cells to render for this iteration
            const cellsToRender: number[] = [];

            if (bankMode) {
                if (uneven && i === end) {
                    cellsToRender.push(totalCells);
                } else {
                    for (let col = 0; col < columns; col++) {
                        const cellNum = i + (bankOffset * col);
                        if (cellNum <= totalCells) {
                            cellsToRender.push(cellNum);
                        }
                    }
                }
            } else {
                cellsToRender.push(i);
            }

            // Render each cell
            for (const cellNum of cellsToRender) {
                this._renderSingleCell(cells, cellNum);
            }
        }

        return cells;
    }

    private _renderSingleCell(cells: TemplateResult[], i: number): void {
        const v = this.getState(EntityKey[`cell_voltage_${i}`] as EntityKey, 3, '0.000');
        const r = this.getState(EntityKey[`cell_resistance_${i}`] as EntityKey, 3, '0.000');

        // Highlight logic
        const isMin = String(i) === this.minCellId;
        const isMax = String(i) === this.maxCellId;
        let valClass = isMin ? 'cell-low' : isMax ? 'cell-high' : 'val-white';

        // Custom pill background if needed for highlighting min/max row?
        // For now just standard

        // Voltage-based styling
        const vParam = parseFloat(v);
        const minLimit = this.config.minCellVoltage ?? 2.8; // Configurable or default LFP lower voltage
        const maxLimit = this.config.maxCellVoltage ?? 3.65; // Configurable or default LFP upper voltage
        let percent = 0;
        if (!isNaN(vParam)) {
            percent = ((vParam - minLimit) / (maxLimit - minLimit)) * 100;
            if (percent < 0) percent = 0;
            if (percent > 100) percent = 100;
        }

        const rParam = parseFloat(r);
        const showResistance = !isNaN(rParam) && rParam > 0;

        const colorMode = this.config.cellColorMode || 'progress';
        let cellStyle = '';

        if (colorMode === 'gradient') {
            // 5-color gradient: dark red -> dark yellow -> dark green -> dark blue -> dark indigo
            const colors = [
                {r: 180, g: 60, b: 60},   // 0%: Dark red
                {r: 180, g: 180, b: 50},  // 25%: Dark yellow
                {r: 60, g: 180, b: 60},   // 50%: Dark green
                {r: 60, g: 120, b: 200},  // 75%: Dark blue
                {r: 90, g: 60, b: 200}    // 100%: Dark indigo
            ];

            let colorIndex = Math.floor(percent / 25);
            if (colorIndex >= 4) colorIndex = 3; // Cap at last transition

            const localPercent = (percent % 25) / 25; // 0-1 within current color segment
            const color1 = colors[colorIndex];
            const color2 = colors[colorIndex + 1];

            const red = Math.round(color1.r + (color2.r - color1.r) * localPercent);
            const green = Math.round(color1.g + (color2.g - color1.g) * localPercent);
            const blue = Math.round(color1.b + (color2.b - color1.b) * localPercent);

            cellStyle = `background: rgba(${red}, ${green}, ${blue}, 0.85);`;
        }

        const textBgStyle = colorMode === 'gradient' ? 'background: rgba(0, 0, 0, 0.25); padding: 1px 3px; border-radius: 3px;' : '';
        const orientation = this.config.cellOrientation || 'horizontal';
        const cellClass = orientation === 'vertical' ? 'cell-item cell-item-vertical' : 'cell-item';

        cells.push(html`
            <div class="${cellClass}" style="${cellStyle}">
                ${colorMode === 'progress' ? html`
                    <div class="cell-item-bg" style="width: ${percent}%;"></div>` : ''}
                ${orientation === 'vertical' ? html`
                    <span class="cell-id">${String(i).padStart(2, '0')}</span>
                    <span class="cell-volts ${valClass} clickable" style="${textBgStyle}"
                          @click=${(e) => this._navigate(e, EntityKey[`cell_voltage_${i}`] as EntityKey)}>${v} V</span>
                    ${showResistance ? html`
                        <span class="cell-res clickable" style="${textBgStyle}"
                              @click=${(e) => this._navigate(e, EntityKey[`cell_resistance_${i}`] as EntityKey)}>${r} Ω</span>
                    ` : ''}
                ` : html`
                    <span class="clickable"
                          @click=${(e) => this._navigate(e, EntityKey[`cell_voltage_${i}`] as EntityKey)}>
                            <span class="cell-id">${String(i).padStart(2, '0')}</span>
                            <span class="cell-volts ${valClass}" style="${textBgStyle}">${v} V</span>
                        </span>
                    ${showResistance ? html`
                        <span class="cell-res clickable" style="${textBgStyle}"
                              @click=${(e) => this._navigate(e, EntityKey[`cell_resistance_${i}`] as EntityKey)}>/ ${r} Ω</span>
                    ` : ''}
                `}
            </div>
        `);
    }
}
