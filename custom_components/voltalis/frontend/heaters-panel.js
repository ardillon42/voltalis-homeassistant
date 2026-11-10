import { LitElement, html, css } from "https://unpkg.com/lit@2.8.0/index.js?module";

class VoltalisPanel extends LitElement {
    static get properties() {
        return {
            hass: { type: Object },
        };
    }

    constructor() {
        super();
        this._cards = new Map();
        this._helpers = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._loadHelpers();
    }

    async _loadHelpers() {
        if (this._helpers) return;
        if (window.loadCardHelpers) {
            this._helpers = await window.loadCardHelpers();
            this.requestUpdate();
        }
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (!this._helpers) {
            this._loadHelpers();
        }
        if (changedProperties.has("hass") && this.hass) {
            for (const card of this._cards.values()) {
                card.hass = this.hass;
            }
        }
    }

    _getOrCreateThermostatCard(climate) {
        const entityId = climate.entity_id;

        let thermostatCard = this._cards.get(entityId);
        if (!thermostatCard) {
            thermostatCard = document.createElement("hui-thermostat-card");
            thermostatCard.setConfig({
                type: "thermostat",
                entity: entityId,
                name: "",
                features: [],
            });
            thermostatCard.hass = this.hass;
            this._cards.set(entityId, thermostatCard);
        } else {
            thermostatCard.hass = this.hass;
        }
        return thermostatCard;
    }

    _openMoreInfo(entityId) {
        const event = new CustomEvent("hass-more-info", {
            bubbles: true,
            composed: true,
            detail: { entityId },
        });
        this.dispatchEvent(event);
    }

    _t(key, fallback, values = {}) {
        if (this.hass?.localize) {
            let translated = this.hass.localize(`component.voltalis.${key}`, values);
            if (translated) return translated;
            translated = this.hass.localize(key, values);
            if (translated) return translated;
        }
        let res = fallback;
        for (const [k, v] of Object.entries(values)) {
            res = res.replace(`{${k}}`, v);
        }
        return res;
    }

    render() {
        if (!this.hass) {
            return html`
              <div class="loading">
                <ha-circular-progress active indeterminate size="large"></ha-circular-progress>
                <p>${this._t("panel.radiators.loading", "Loading data...")}</p>
              </div>
            `;
        }

        const radiateurs = Object.keys(this.hass.states)
            .filter((entityId) => {
                if (!entityId.startsWith("climate.")) return false;
                if (this.hass.entities && this.hass.entities[entityId]) {
                    return this.hass.entities[entityId].platform === "voltalis";
                }
                return true;
            })
            .map((entityId) => this.hass.states[entityId]);

        return html`
          <div class="container">
            <header class="header">
              <div class="header-title">
                <h1>${this._t("panel.radiators.title", "Voltalis Heaters")}</h1>
                <span class="radiator-count">
                  ${this._t("panel.radiators.devices_count", `${radiateurs.length} device(s)`, {
                    count: radiateurs.length,
                  })}
                </span>
              </div>
            </header>

            ${radiateurs.length === 0
              ? html`
                <div class="empty-state">
                  <p>${this._t("panel.radiators.empty", "No Voltalis heaters detected.")}</p>
                </div>
              `
              : html`
                <div class="grid">
                  ${radiateurs.map((rad) => this._renderRadiateurCard(rad))}
                </div>
              `}
          </div>
        `;
    }

    _findRelatedEntities(climate) {
        const climateId = climate.entity_id;
        const states = this.hass.states;
        let switchEntity = null;
        let consumptionEntity = null;
        let modeEntity = null;
        let connectedEntity = null;

        if (this.hass.entities && this.hass.entities[climateId]) {
            const deviceId = this.hass.entities[climateId].device_id;
            if (deviceId) {
                const deviceEntities = Object.values(this.hass.entities).filter(
                    (e) => e.device_id === deviceId
                );
                for (const e of deviceEntities) {
                    const s = states[e.entity_id];
                    if (!s) continue;
                    if (e.entity_id.startsWith("switch.")) {
                        switchEntity = s;
                    } else if (
                        e.translation_key === "device_daily_consumption" ||
                        e.entity_id.includes("daily_consumption") ||
                        e.entity_id.includes("consommation_journaliere")
                    ) {
                        consumptionEntity = s;
                    } else if (
                        e.translation_key === "device_current_mode" ||
                        e.entity_id.includes("current_mode") ||
                        e.entity_id.includes("mode_actuel")
                    ) {
                        modeEntity = s;
                    } else if (
                        e.translation_key === "device_connected" ||
                        e.entity_id.includes("connected") ||
                        e.entity_id.includes("connecte")
                    ) {
                        connectedEntity = s;
                    }
                }
            }
        }

        const slug = climateId.replace("climate.", "");
        const baseName = slug.replace(/^radiateur_/, "");

        if (!switchEntity) {
            const switchId = Object.keys(states).find(
                (id) => id.startsWith("switch.") && (id.includes(slug) || id.includes(baseName))
            );
            if (switchId) switchEntity = states[switchId];
        }

        if (!consumptionEntity) {
            const consId = Object.keys(states).find(
                (id) =>
                    id.startsWith("sensor.") &&
                    (id.includes("daily_consumption") || id.includes("consommation")) &&
                    (id.includes(slug) || id.includes(baseName))
            );
            if (consId) consumptionEntity = states[consId];
        }

        if (!modeEntity) {
            const mId = Object.keys(states).find(
                (id) =>
                    id.startsWith("sensor.") &&
                    (id.includes("current_mode") || id.includes("mode_actuel")) &&
                    !id.includes("contract") &&
                    (id.includes(slug) || id.includes(baseName))
            );
            if (mId) modeEntity = states[mId];
        }

        if (!connectedEntity) {
            const connId = Object.keys(states).find(
                (id) =>
                    id.startsWith("sensor.") &&
                    (id.includes("device_connected") || id.includes("statut_de_la_connexion") || id.includes("connecte")) &&
                    (id.includes(slug) || id.includes(baseName))
            );
            if (connId) connectedEntity = states[connId];
        }

        return { switchEntity, consumptionEntity, modeEntity, connectedEntity };
    }

    _formatConsumption(consumptionEntity) {
        if (!consumptionEntity || consumptionEntity.state === "unavailable" || consumptionEntity.state === "unknown") {
            return "--";
        }
        const val = parseFloat(consumptionEntity.state);
        if (isNaN(val)) return consumptionEntity.state;
        const rounded = Math.round(val);
        const unit = consumptionEntity.attributes?.unit_of_measurement || "Wh";

        if (this.hass?.locale?.language) {
            try {
                const formatted = new Intl.NumberFormat(this.hass.locale.language, {
                    maximumFractionDigits: 0,
                }).format(rounded);
                return `${formatted} ${unit}`;
            } catch (e) {
                // Fallback below
            }
        }
        return `${rounded} ${unit}`;
    }

    _formatMode(modeEntity, climate) {
        const raw = modeEntity?.state || climate.attributes?.preset_mode;
        if (!raw || raw === "unknown" || raw === "unavailable") {
            return "--";
        }
        const lower = raw.toLowerCase();
        const localized = this._t(`entity.sensor.device_current_mode.state.${lower}`, null);
        if (localized) return localized;

        const fallbackMap = {
            comfort: "Comfort",
            eco: "Eco",
            away: "Away",
            temperature: "Manual",
            on: "On",
            none: "Off",
            heat: "Heat",
            auto: "Auto",
            off: "Off",
        };
        return fallbackMap[lower] || raw;
    }

    _formatConnection(connectedEntity) {
        if (!connectedEntity || connectedEntity.state === "unavailable" || connectedEntity.state === "unknown") {
            return {
                label: this._t("panel.radiators.connection.unknown", "Unknown"),
                class: "status-unknown",
                icon: "mdi:help-circle-outline",
            };
        }
        const raw = connectedEntity.state.toLowerCase();
        const localized = this._t(`entity.sensor.device_connected.state.${raw}`, null);

        if (raw === "ok" || raw === "connected") {
            return {
                label: localized || this._t("panel.radiators.connection.connected", "Connected"),
                class: "status-ok",
                icon: "mdi:wifi-check",
            };
        }
        if (raw === "test_in_progress") {
            return {
                label: localized || this._t("panel.radiators.connection.test_in_progress", "Test in progress"),
                class: "status-warning",
                icon: "mdi:progress-wrench",
            };
        }
        if (raw === "no_consumption") {
            return {
                label: localized || this._t("panel.radiators.connection.no_consumption", "No consumption"),
                class: "status-warning",
                icon: "mdi:wifi-alert",
            };
        }
        if (raw === "comm_error") {
            return {
                label: localized || this._t("panel.radiators.connection.comm_error", "Communication error"),
                class: "status-nok",
                icon: "mdi:wifi-alert",
            };
        }
        return {
            label: localized || this._t("panel.radiators.connection.disconnected", "Disconnected"),
            class: "status-nok",
            icon: "mdi:wifi-off",
        };
    }

    _renderRadiateurCard(climate) {
        const name = climate.attributes.friendly_name || climate.entity_id;
        const isOff = climate.state === "off";

        const { switchEntity, consumptionEntity, modeEntity, connectedEntity } =
            this._findRelatedEntities(climate);

        const isSwitchOn = switchEntity ? switchEntity.state === "on" : !isOff;
        const connectionInfo = this._formatConnection(connectedEntity);
        const consumptionStr = this._formatConsumption(consumptionEntity);
        const modeStr = this._formatMode(modeEntity, climate);

        const currentPreset = (climate.attributes.preset_mode || modeEntity?.state || "").toLowerCase();
        const thermostatCard = this._getOrCreateThermostatCard(climate);

        return html`
          <ha-card class="card ${!isSwitchOn ? "card-off" : ""}">
            <div class="card-header">
              <div
                class="card-title-group"
                role="button"
                tabindex="0"
                @click=${() => this._openMoreInfo(climate.entity_id)}
                title="${this._t("panel.radiators.more_info", "Show details")}"
              >
                <ha-icon icon="mdi:radiator" class="icon-radiator"></ha-icon>
                <h3 class="card-title">${name}</h3>
              </div>
              <span class="status-badge ${connectionInfo.class}">
                <ha-icon icon="${connectionInfo.icon}" class="status-icon"></ha-icon>
                ${connectionInfo.label}
              </span>
            </div>

            <div class="switch-row">
              <span class="switch-label">${this._t("panel.radiators.power", "Power")}</span>
              <ha-switch
                .checked=${isSwitchOn}
                @change=${() => this._toggleSwitch(switchEntity, climate, isSwitchOn)}
              ></ha-switch>
            </div>

            <div class="thermostat-wrapper">
              ${thermostatCard ||
              html`
                <div class="thermostat-placeholder">
                  <ha-circular-progress active indeterminate size="small"></ha-circular-progress>
                </div>
              `}
            </div>

            <div class="info-grid">
              <div class="info-item">
                <ha-icon icon="mdi:flash" class="info-icon"></ha-icon>
                <div class="info-content">
                  <span class="info-label">${this._t("panel.radiators.daily_consumption", "Daily consumption")}</span>
                  <strong class="info-value">${consumptionStr}</strong>
                </div>
              </div>

              <div class="info-item">
                <ha-icon icon="mdi:tune" class="info-icon"></ha-icon>
                <div class="info-content">
                  <span class="info-label">${this._t("panel.radiators.current_mode", "Current mode")}</span>
                  <strong class="info-value">${modeStr}</strong>
                </div>
              </div>
            </div>

            <div class="presets-row">
              <button
                class="preset-btn ${currentPreset === "comfort" ? "active" : ""}"
                ?disabled=${!isSwitchOn}
                @click=${() => this._setPreset(climate.entity_id, "comfort")}
              >
                ${this._t("panel.radiators.presets.comfort", "Comfort")}
              </button>
              <button
                class="preset-btn ${currentPreset === "eco" ? "active" : ""}"
                ?disabled=${!isSwitchOn}
                @click=${() => this._setPreset(climate.entity_id, "eco")}
              >
                ${this._t("panel.radiators.presets.eco", "Eco")}
              </button>
              <button
                class="preset-btn ${currentPreset === "away" ? "active" : ""}"
                ?disabled=${!isSwitchOn}
                @click=${() => this._setPreset(climate.entity_id, "away")}
              >
                ${this._t("panel.radiators.presets.away", "Away")}
              </button>
            </div>
          </ha-card>
        `;
    }

    _setPreset(entityId, presetMode) {
        this.hass.callService("climate", "set_preset_mode", {
            entity_id: entityId,
            preset_mode: presetMode,
        });
    }

    _toggleSwitch(switchEntity, climate, currentlyOn) {
        if (switchEntity) {
            this.hass.callService("switch", currentlyOn ? "turn_off" : "turn_on", {
                entity_id: switchEntity.entity_id,
            });
        } else {
            this.hass.callService("climate", "set_hvac_mode", {
                entity_id: climate.entity_id,
                hvac_mode: currentlyOn ? "off" : "heat",
            });
        }
    }

    static get styles() {
        return css`
          :host {
            display: block;
            background-color: var(--primary-background-color, #fafafa);
            min-height: 100vh;
            color: var(--primary-text-color, #212121);
            font-family: var(--ha-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
          }

          .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 24px 20px;
          }

          .header {
            margin-bottom: 28px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
          }

          .header-title {
            display: flex;
            align-items: baseline;
            gap: 12px;
          }

          .header-title h1 {
            font-size: 26px;
            font-weight: 600;
            margin: 0;
            color: var(--primary-text-color, #212121);
          }

          .radiator-count {
            font-size: 14px;
            color: var(--secondary-text-color, #757575);
          }

          .loading, .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 64px 16px;
            text-align: center;
            color: var(--secondary-text-color, #757575);
            font-size: 16px;
            gap: 16px;
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 20px;
          }

          .card {
            background: var(--ha-card-background, var(--card-background-color, #ffffff));
            border-radius: var(--ha-card-border-radius, 16px);
            padding: 20px;
            box-shadow: var(--ha-card-box-shadow, 0 2px 10px rgba(0, 0, 0, 0.05));
            border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, rgba(0, 0, 0, 0.08)));
            display: flex;
            flex-direction: column;
            gap: 16px;
            transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
          }

          .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
          }

          .card-off {
            opacity: 0.75;
          }

          .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .card-title-group {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            border-radius: 8px;
            padding: 2px 6px;
            margin-left: -6px;
            transition: background-color 0.15s ease;
          }

          .card-title-group:hover {
            background-color: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
          }

     
          .icon-radiator {
            --mdc-icon-size: 24px;
            color: var(--primary-color, #03a9f4);
          }

          .card-title {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
          }

          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 12px;
            font-weight: 500;
            padding: 4px 10px;
            border-radius: 20px;
          }

          .status-icon {
            --mdc-icon-size: 14px;
          }

          .status-ok {
            background-color: rgba(var(--rgb-success-color, 76, 175, 80), 0.15);
            color: var(--success-color, #2e7d32);
          }

          .status-nok {
            background-color: rgba(var(--rgb-error-color, 244, 67, 54), 0.15);
            color: var(--error-color, #c62828);
          }

          .status-warning {
            background-color: rgba(var(--rgb-warning-color, 255, 152, 0), 0.15);
            color: var(--warning-color, #ef6c00);
          }

          .status-unknown {
            background-color: rgba(var(--rgb-secondary-text-color, 158, 158, 158), 0.15);
            color: var(--secondary-text-color, #757575);
          }

          .switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: var(--secondary-background-color, #f5f5f5);
            border-radius: 10px;
          }

          .switch-label {
            font-size: 14px;
            font-weight: 500;
          }

          .thermostat-wrapper {
            --ha-card-border-width: 0px;
            --ha-card-box-shadow: none;
            --ha-card-background: transparent;
            --ha-card-border-radius: 0px;
            display: flex;
            justify-content: center;
            align-items: center;
            margin: -8px 0;
            overflow: hidden;
          }

          .thermostat-wrapper hui-thermostat-card,
          .thermostat-wrapper ha-card {
            width: 100%;
          }

          .thermostat-placeholder {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 180px;
            padding: 20px;
          }

          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .info-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background: var(--secondary-background-color, #f5f5f5);
            border-radius: 10px;
          }

          .info-icon {
            --mdc-icon-size: 20px;
            color: var(--primary-color, #03a9f4);
          }

          .info-content {
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .info-label {
            font-size: 11px;
            color: var(--secondary-text-color, #757575);
            text-transform: uppercase;
          }

          .info-value {
            font-size: 14px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .presets-row {
            display: flex;
            gap: 8px;
            margin-top: 4px;
          }

          .preset-btn {
            flex: 1;
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
            background: var(--secondary-background-color, #f5f5f5);
            color: var(--primary-text-color, #212121);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
          }

          .preset-btn:hover:not(:disabled) {
            border-color: var(--primary-color, #03a9f4);
            color: var(--primary-color, #03a9f4);
          }

          .preset-btn.active {
            background: var(--primary-color, #03a9f4);
            color: #ffffff;
            border-color: var(--primary-color, #03a9f4);
            font-weight: 600;
          }

          .preset-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
        `;
    }
}

customElements.define("voltalis-panel", VoltalisPanel);