/* @mp-consulting/homebridge-unifi-access Custom UI. */
import { $, showScreen } from "./modules/dom-helpers.js";
import { getControllers, state } from "./modules/state.js";
import { handleSetupSubmit, openAddController, renderControllers } from "./modules/controllers.js";
import { PLUGIN_NAME } from "./modules/constants.js";
import { handleDiscover } from "./modules/discovery.js";
import { renderOptions } from "./modules/feature-options.js";

// Search & toolbar.
let searchTimeout = null;

$("optionsSearch").addEventListener("input", () => {


  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderOptions(), 300);
});

$("clearSearchBtn").addEventListener("click", () => {


  $("optionsSearch").value = "";
  renderOptions();
});

$("scopeSelect").addEventListener("change", () => renderOptions());
$("modifiedOnlyToggle").addEventListener("change", () => renderOptions());

// Event listeners.
$("discoverBtn").addEventListener("click", handleDiscover);
$("manualEntryBtn").addEventListener("click", () => openAddController());
$("cancelDiscoveryBtn").addEventListener("click", () => {


  showScreen("controllersScreen");
  renderControllers();
});
$("addControllerBtn").addEventListener("click", () => {


  if(getControllers().length) {


    showScreen("discoveryScreen");
    $("cancelDiscoveryBtn").style.display = "inline-block";
  } else {


    showScreen("discoveryScreen");
  }
});
$("setupForm").addEventListener("submit", handleSetupSubmit);
$("cancelSetupBtn").addEventListener("click", () => {


  if(getControllers().length) {


    showScreen("controllersScreen");
    renderControllers();
  } else {


    showScreen("discoveryScreen");
  }
});
$("backFromOptionsBtn").addEventListener("click", () => {


  showScreen("controllersScreen");
  renderControllers();
});
$("backFromSupportBtn").addEventListener("click", () => {


  showScreen("controllersScreen");
  renderControllers();
});
$("supportBtn").addEventListener("click", () => showScreen("supportScreen"));

// Initialization.
state.pluginConfig = await homebridge.getPluginConfig();

if(!state.pluginConfig.length) {


  state.pluginConfig = [{ name: PLUGIN_NAME }];
  await homebridge.updatePluginConfig(state.pluginConfig);
}

state.pluginConfig[0].name ||= PLUGIN_NAME;

// Show the right screen.
if(getControllers().length) {


  showScreen("controllersScreen");
  renderControllers();
} else {


  showScreen("discoveryScreen");
  $("cancelDiscoveryBtn").style.display = "none";
}
