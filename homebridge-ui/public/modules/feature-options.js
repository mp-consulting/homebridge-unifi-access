import { $, escapeHtml, showScreen } from "./dom-helpers.js";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "./constants.js";
import { getControllers, saveConfigSilent, state } from "./state.js";

export const openFeatureOptions = async (controllerIndex) => {


  state.currentControllerIndex = controllerIndex;
  const ctrl = getControllers()[controllerIndex];

  showScreen("featureOptionsScreen");
  $("optionsLoading").style.display = "block";
  $("optionsContainer").innerHTML = "";
  $("deviceInfoPanel").style.display = "none";
  $("unsavedChanges").style.display = "none";
  $("optionsSearch").value = "";

  try {


    const [ optionsData, devices ] = await Promise.all([
      homebridge.request("/getOptions"),
      homebridge.request("/getDevices", { address: ctrl.address, password: ctrl.password, username: ctrl.username })
    ]);

    state.categories = optionsData.categories;
    state.options = optionsData.options;

    // Process devices.
    state.devices = [];

    if(devices?.length) {


      /* eslint-disable camelcase */
      devices[0].display_model = "controller";
      devices[0].ip = devices[0].host?.ip;
      devices[0].is_online = true;
      devices[0].mac = devices[0].host?.mac;
      devices[0].model = devices[0].host?.device_type;
      devices[0].unique_id = devices[0].host?.mac;
      /* eslint-enable camelcase */

      for(const device of devices) {


        device.name ||= device.alias || device.display_model;
        device.serialNumber = (device.mac || "").replace(/:/g, "").toUpperCase() +
          ((device.device_type === "UAH-Ent") ? "-" + (device.source_id || "").toUpperCase() : "");

        if((device.display_model === "controller") || device.capabilities?.includes("is_hub") || device.capabilities?.includes("is_reader")) {


          state.devices.push(device);
        }
      }
    }

    buildScopeSelector(ctrl);
    renderOptions();
  } catch(e) {


    homebridge.toast.error("Failed to load: " + e.message);
  } finally {


    $("optionsLoading").style.display = "none";
  }
};

const buildScopeSelector = (ctrl) => {


  const select = $("scopeSelect");

  select.innerHTML = "";

  const addOpt = (value, text) => {


    const opt = document.createElement("option");

    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
  };

  addOpt("global", "Global Options");
  addOpt("controller:" + ctrl.address, "Controller: " + (ctrl.name || ctrl.address));

  const hubs = state.devices.filter(d => (d.display_model !== "controller") && d.capabilities?.includes("is_hub"));
  const readers = state.devices.filter(d => (d.display_model !== "controller") && d.capabilities?.includes("is_reader"));

  const addGroup = (label, items) => {


    if(!items.length) { return; }
    const group = document.createElement("optgroup");

    group.label = label;
    items.forEach(d => {


      const opt = document.createElement("option");

      opt.value = "device:" + d.serialNumber;
      opt.textContent = d.name;
      group.appendChild(opt);
    });
    select.appendChild(group);
  };

  addGroup("Hubs", hubs);
  addGroup("Readers", readers);
};

const getCurrentScope = () => {


  const val = $("scopeSelect").value;

  if(val === "global") { return { device: null, id: null, type: "global" }; }

  const colonIdx = val.indexOf(":");
  const type = val.substring(0, colonIdx);
  const id = val.substring(colonIdx + 1);

  if(type === "controller") {


    return { device: null, id, type: "controller" };
  }

  const device = state.devices.find(d => d.serialNumber === id);

  return { device, id, type: "device" };
};

const SCOPE_ORDER = [ "global", "controller", "device" ];

const updateCascade = (scopeType) => {


  const activeIdx = SCOPE_ORDER.indexOf(scopeType);
  const cascade = $("scopeCascade");

  if(!cascade) { return; }

  // Update scope levels.
  cascade.querySelectorAll(".scope-level").forEach(el => {


    const level = el.dataset.scope;
    const levelIdx = SCOPE_ORDER.indexOf(level);

    el.classList.remove("active", "inherited");

    if(levelIdx === activeIdx) {


      el.classList.add("active");
    } else if(levelIdx < activeIdx) {


      el.classList.add("inherited");
    }
  });

  // Update connectors: active if they connect inherited/active levels.
  cascade.querySelectorAll(".scope-connector").forEach((conn, i) => {


    conn.classList.toggle("active", i < activeIdx);
  });

  // Update hints based on active scope.
  const hints = {


    controller: [ "Base values", "Editing this scope", "Inherits controller" ],
    device: [ "Base values", "Intermediate", "Editing this scope" ],
    global: [ "Editing this scope", "Inherits global", "Inherits global" ]
  };

  cascade.querySelectorAll(".scope-level").forEach((el, i) => {


    const hint = el.querySelector(".scope-hint");

    if(hint) { hint.textContent = hints[scopeType][i]; }
  });
};

export const renderOptions = () => {


  const container = $("optionsContainer");

  container.innerHTML = "";

  const scope = getCurrentScope();

  // Update the visual cascade diagram.
  updateCascade(scope.type);
  const searchTerm = ($("optionsSearch").value || "").toLowerCase();
  const modifiedOnly = $("modifiedOnlyToggle")?.checked || false;

  // Device info panel.
  if(scope.device && (scope.device.display_model !== "controller")) {


    $("deviceInfoPanel").style.display = "block";
    $("infoModel").textContent = scope.device.model || scope.device.display_model;
    $("infoMac").textContent = scope.device.serialNumber;
    $("infoIp").textContent = scope.device.ip || "N/A";
    const statusEl = $("infoStatus");

    statusEl.textContent = scope.device.is_online ? "Connected" : "Disconnected";
    statusEl.className = scope.device.is_online ? "text-success" : "text-danger";
  } else {


    $("deviceInfoPanel").style.display = "none";
  }

  let totalModified = 0;

  // Render each category as a card.
  state.categories.forEach((category) => {


    // Filter categories based on device type.
    if(scope.device && (scope.device.display_model !== "controller")) {


      const catModelKey = category.modelKey || [];
      const catCapability = category.hasCapability;

      if(!catModelKey.some(m => [ "all", scope.device.display_model ].includes(m))) { return; }

      if(catCapability && (!scope.device.capabilities || !catCapability.some(c => scope.device.capabilities.includes(c)))) { return; }
    }

    const categoryOptions = state.options[category.name] || [];

    if(!categoryOptions.length) { return; }

    // Filter options for this device and search.
    let validOptions = categoryOptions.filter(opt => {


      if(scope.device && (scope.device.display_model !== "controller")) {


        if(opt.hasCapability && (!scope.device.capabilities || !opt.hasCapability.some(c => scope.device.capabilities.includes(c)))) { return false; }

        if(opt.modelKey && (opt.modelKey !== "all") && !opt.modelKey.includes(scope.device.display_model)) { return false; }
      }

      if(searchTerm) {


        const text = (opt.name + " " + opt.description).toLowerCase();

        if(!text.includes(searchTerm)) { return false; }
      }

      return true;
    });

    if(!validOptions.length) { return; }

    // Count stats before filtering for "modified only".
    const modifiedCount = countModified(category.name, validOptions, scope);
    const enabledCount = countEnabled(category.name, validOptions, scope);

    totalModified += modifiedCount;

    // Apply "modified only" filter.
    if(modifiedOnly) {


      validOptions = validOptions.filter(opt => {


        const optionKey = category.name + (opt.name ? "." + opt.name : "");

        return isOptionModified(optionKey, scope.id);
      });

      if(!validOptions.length) { return; }
    }

    const icon = CATEGORY_ICONS[category.name] || "fa-cog";
    const color = CATEGORY_COLORS[category.name] || "#6c757d";
    const isOpen = state.openCategories.has(category.name) || ((modifiedCount > 0) && !state.openCategories.size) || !!searchTerm;

    // Build card.
    const card = document.createElement("div");

    card.className = "card mb-3 category-card";
    card.style.setProperty("--category-color", color);
    card.dataset.category = category.name;

    const header = document.createElement("div");

    header.className = "card-header bg-transparent d-flex justify-content-between align-items-center";
    header.style.cursor = "pointer";

    const progressPct = validOptions.length ? Math.round((enabledCount / categoryOptions.length) * 100) : 0;

    /* eslint-disable no-restricted-syntax */
    header.innerHTML = `
      <div class="d-flex align-items-center">
        <span class="category-icon" style="background-color: ${color}"><i class="fas ${icon}"></i></span>
        <span class="ms-2">${escapeHtml(category.description.replace(/ feature options\.?/i, ""))}</span>
      </div>
      <div class="d-flex align-items-center gap-2">
        <span class="category-summary d-none d-sm-flex align-items-center gap-2">
          <span>${enabledCount}/${categoryOptions.length} on</span>
          <span class="category-progress"><span class="category-progress-fill" style="width: ${progressPct}%"></span></span>
        </span>
        ${modifiedCount ? `<span class="badge bg-warning text-dark">${modifiedCount}</span>` : ""}
        <i class="fas fa-chevron-${isOpen ? "up" : "down"} toggle-icon"></i>
      </div>
    `;
    /* eslint-enable no-restricted-syntax */

    const body = document.createElement("div");

    body.className = "category-body" + (isOpen ? " open" : "");

    const optList = document.createElement("div");

    optList.className = "list-group list-group-flush";

    validOptions.forEach(opt => {


      const optionKey = category.name + (opt.name ? "." + opt.name : "");
      const optEl = createOptionItem(optionKey, opt, scope, category);

      optList.appendChild(optEl);
    });

    body.appendChild(optList);
    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);

    // Toggle collapse and persist state.
    header.addEventListener("click", () => {


      const wasOpen = body.classList.contains("open");

      body.classList.toggle("open");
      header.querySelector(".toggle-icon").className = "fas fa-chevron-" + (wasOpen ? "down" : "up") + " toggle-icon";

      if(wasOpen) {


        state.openCategories.delete(category.name);
      } else {


        state.openCategories.add(category.name);
      }
    });
  });

  // Update modified summary.
  const summaryEl = $("modifiedSummary");

  /* eslint-disable-next-line no-restricted-syntax */
  summaryEl.textContent = totalModified ? `(${totalModified})` : "";
  summaryEl.className = totalModified ? "text-warning" : "";
};

const countModified = (categoryName, options, scope) => {


  let count = 0;

  for(const opt of options) {


    const optionKey = categoryName + (opt.name ? "." + opt.name : "");

    if(isOptionModified(optionKey, scope.id)) { count++; }
  }

  return count;
};

const countEnabled = (categoryName, options, scope) => {


  let count = 0;

  for(const opt of options) {


    const optionKey = categoryName + (opt.name ? "." + opt.name : "");
    const optState = getOptionState(optionKey, opt, scope);

    if(optState.enabled) { count++; }
  }

  return count;
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isOptionModified = (optionKey, scopeId) => {


  const configuredOptions = state.pluginConfig[0].options || [];
  const regex = scopeId ?
    new RegExp("^(Enable|Disable)\\." + escapeRegex(optionKey) + "\\." + escapeRegex(scopeId) + "(\\..*)?$", "i") :
    new RegExp("^(Enable|Disable)\\." + escapeRegex(optionKey) + "$", "i");

  return configuredOptions.some(o => regex.test(o));
};

const getOptionState = (optionKey, opt, scope) => {


  const configuredOptions = state.pluginConfig[0].options || [];
  const scopeId = scope.id;

  // Check current scope first.
  if(scopeId) {


    const regex = new RegExp("^(Enable|Disable)\\." + escapeRegex(optionKey) + "\\." + escapeRegex(scopeId) + "$", "i");

    for(const entry of configuredOptions) {


      const match = regex.exec(entry);

      if(match) { return { enabled: match[1].toLowerCase() === "enable", explicit: true, scope: scope.type }; }
    }
  }

  // Check controller scope when viewing a device.
  if(scope.type === "device") {


    const ctrl = getControllers()[state.currentControllerIndex];

    if(ctrl) {


      const regex = new RegExp("^(Enable|Disable)\\." + escapeRegex(optionKey) + "\\." + escapeRegex(ctrl.address) + "$", "i");

      for(const entry of configuredOptions) {


        const match = regex.exec(entry);

        if(match) { return { enabled: match[1].toLowerCase() === "enable", explicit: false, scope: "controller" }; }
      }
    }
  }

  // Check global.
  const globalRegex = new RegExp("^(Enable|Disable)\\." + escapeRegex(optionKey) + "$", "i");

  for(const entry of configuredOptions) {


    const match = globalRegex.exec(entry);

    if(match) { return { enabled: match[1].toLowerCase() === "enable", explicit: scope.type === "global", scope: "global" }; }
  }

  return { enabled: opt.default, explicit: false, scope: "default" };
};

const createOptionItem = (optionKey, opt, scope, category) => {


  const el = document.createElement("div");
  const optState = getOptionState(optionKey, opt, scope);
  const switchId = "sw-" + optionKey.replace(/[^a-zA-Z0-9]/g, "-");
  const isGrouped = opt.group && (opt.name !== opt.group);

  // Build class list with scope-based styling.
  let scopeClass = "";

  if(optState.explicit) {


    scopeClass = "scope-" + scope.type;
  } else if(optState.scope === "controller") {


    scopeClass = "scope-controller";
  } else if((optState.scope === "global") && (scope.type !== "global")) {


    scopeClass = "scope-global";
  } else if(optState.enabled !== opt.default) {


    scopeClass = "non-default";
  }

  el.className = "list-group-item option-item " + scopeClass + (isGrouped ? " option-grouped" : "");

  // Scope indicator badge.
  let scopeIndicator = "";

  if(optState.explicit) {


    const scopeColor = scope.type === "device" ? "info" : scope.type === "controller" ? "success" : "warning";
    const scopeLabel = scope.type === "device" ? "device" : scope.type === "controller" ? "controller" : "global";

    /* eslint-disable-next-line no-restricted-syntax */
    scopeIndicator = `<span class="badge bg-${scopeColor} ms-1">${scopeLabel}</span>`;
  } else if(optState.scope === "controller") {


    scopeIndicator = "<span class=\"badge bg-success bg-opacity-50 ms-1\"><i class=\"fas fa-arrow-down\" style=\"font-size:0.55rem\"></i> controller</span>";
  } else if((optState.scope === "global") && (scope.type !== "global")) {


    scopeIndicator = "<span class=\"badge bg-secondary bg-opacity-50 ms-1\"><i class=\"fas fa-arrow-down\" style=\"font-size:0.55rem\"></i> global</span>";
  }

  // Display name: use option name or category name for the unnamed device option.
  const displayName = opt.name || category.description.replace(/ feature options\.?/i, "");

  // Default value indicator.
  /* eslint-disable no-restricted-syntax */
  const defaultIndicator =
    `<span class="default-indicator ${opt.default ? "default-on" : "default-off"} ms-2">default: ${opt.default ? "on" : "off"}</span>`;

  const resetButton = optState.explicit ?
    "<button class=\"btn btn-outline-secondary btn-sm reset-option-btn flex-shrink-0 mt-1\" title=\"Reset to inherited value\">" +
      "<i class=\"fas fa-undo\"></i></button>" :
    "";

  el.innerHTML = `
    <div class="d-flex justify-content-between align-items-start">
      <div class="me-3 flex-grow-1">
        <div class="form-check form-switch mb-1">
          <input class="form-check-input" type="checkbox" id="${switchId}" ${optState.enabled ? "checked" : ""}>
          <label class="form-check-label d-flex align-items-center flex-wrap" for="${switchId}">
            <span class="option-name">${escapeHtml(displayName)}</span>
            ${defaultIndicator}
            ${scopeIndicator}
          </label>
        </div>
        <div class="option-description text-muted ms-4">${escapeHtml(opt.description)}</div>
      </div>
      ${resetButton}
    </div>
  `;

  el.querySelector(`#${switchId}`).addEventListener("change", function() { /* eslint-enable no-restricted-syntax */

    setOption(optionKey, this.checked, scope, opt);
  });

  const resetBtn = el.querySelector(".reset-option-btn");

  if(resetBtn) {


    resetBtn.addEventListener("click", (e) => {


      e.stopPropagation();
      removeOption(optionKey, scope);
    });
  }

  return el;
};

const setOption = (optionKey, enabled, scope, opt) => {


  state.pluginConfig[0].options ||= [];

  const scopeId = scope.id;
  const suffix = scopeId ? "." + scopeId : "";

  // Remove existing entry at this scope.
  const removeRegex = new RegExp("^(Enable|Disable)\\." + escapeRegex(optionKey) + (scopeId ? "\\." + escapeRegex(scopeId) : "") + "$", "i");

  state.pluginConfig[0].options = state.pluginConfig[0].options.filter(o => !removeRegex.test(o));

  // Only add an explicit entry if the value differs from the inherited/default state.
  const inherited = opt ? getOptionState(optionKey, opt, scope) : null;

  if(!inherited || (inherited.enabled !== enabled)) {

    state.pluginConfig[0].options.push((enabled ? "Enable" : "Disable") + "." + optionKey + suffix);
  }

  saveConfigSilent();
  $("unsavedChanges").style.display = "block";
  renderOptions();
};

const removeOption = (optionKey, scope) => {


  if(!state.pluginConfig[0].options) { return; }

  const scopeId = scope.id;
  const removeRegex = new RegExp("^(Enable|Disable)\\." + escapeRegex(optionKey) + (scopeId ? "\\." + escapeRegex(scopeId) : "") + "$", "i");

  state.pluginConfig[0].options = state.pluginConfig[0].options.filter(o => !removeRegex.test(o));

  saveConfigSilent();
  $("unsavedChanges").style.display = "block";
  renderOptions();
};
