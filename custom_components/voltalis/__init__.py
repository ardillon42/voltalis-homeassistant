"""Initialization of the Voltalis integration in Home Assistant."""
import os

from homeassistant.core import HomeAssistant
from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig

from custom_components.voltalis.apps.home_assistant.entities.config_entry_data import (
    VoltalisConfigEntry,
)
from custom_components.voltalis.apps.home_assistant.home_assistant_module import VoltalisHomeAssistantModule
try:
    from custom_components.voltalis.const import (
        CONFIG_SCHEMA,
        DOMAIN,
        CONF_ENABLE_PANEL,
        DEFAULT_ENABLE_PANEL,
    )
except ImportError:
    from custom_components.voltalis.const import (
        CONFIG_SCHEMA,
        DOMAIN,
    )
    CONF_ENABLE_PANEL = "enable_panel"
    DEFAULT_ENABLE_PANEL = True

PLATFORMS = VoltalisHomeAssistantModule.PLATFORMS
PANEL_URL_PATH = "voltalis"

__all__ = ["CONFIG_SCHEMA"]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Voltalis component."""
    # Register the static frontend path once during component setup
    panel_path = os.path.join(os.path.dirname(__file__), "frontend")
    panel_url = f"/{DOMAIN}_panel"
    
    await hass.http.async_register_static_paths([
        StaticPathConfig(panel_url, panel_path, cache_headers=False)
    ])
    return True


async def async_setup_entry(hass: HomeAssistant, entry: VoltalisConfigEntry) -> bool:
    """Set up Voltalis from a config entry."""
    home_assistant_module = VoltalisHomeAssistantModule()
    setup_ok = await home_assistant_module.async_setup_entry(hass=hass, entry=entry)

    if setup_ok:
        # Register custom sidebar panel only if enabled in options (default: false)
        if entry.options.get(CONF_ENABLE_PANEL, DEFAULT_ENABLE_PANEL):
            panel_url = f"/{DOMAIN}_panel"
            panel_file = os.path.join(os.path.dirname(__file__), "frontend", "heaters-panel.js")
            mtime = int(os.path.getmtime(panel_file)) if os.path.exists(panel_file) else 1
            await panel_custom.async_register_panel(
                hass,
                webcomponent_name="voltalis-panel",
                frontend_url_path=PANEL_URL_PATH,
                sidebar_title="pannel.heaters.title",
                sidebar_icon="mdi:radiator",
                module_url=f"{panel_url}/heaters-panel.js?v={mtime}",
                embed_iframe=False,
                require_admin=False,
            )

        async def _update_listener(hass: HomeAssistant, entry: VoltalisConfigEntry) -> None:
            """Handle options updates by reloading the config entry."""
            await hass.config_entries.async_reload(entry.entry_id)

        entry.async_on_unload(entry.add_update_listener(_update_listener))

    return setup_ok


async def async_unload_entry(hass: HomeAssistant, entry: VoltalisConfigEntry) -> bool:
    """Unload a config entry."""
    # Unregister custom panel from sidebar
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return await entry.runtime_data.voltalis_home_assistant_module.async_unload_entry()
