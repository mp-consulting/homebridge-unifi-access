/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * controllers.js: Controller management UI.
 */
import { $, el, escapeHtml, setButtonLoading, showScreen } from './dom-helpers.js';
import { getControllers, saveConfig, state } from './state.js';
import { openFeatureOptions } from './feature-options.js';

export const renderControllers = () => {


  const controllers = getControllers();
  const list = $('controllersList');
  const noMsg = $('noControllersMessage');

  if(!controllers.length) {


    noMsg.style.display = 'block';
    list.style.display = 'none';

    return;
  }

  noMsg.style.display = 'none';
  list.style.display = 'block';
  list.innerHTML = '';

  controllers.forEach((ctrl, index) => {


    const li = document.createElement('li');

    li.className = 'list-group-item';
     
    li.innerHTML = `
      <div class="d-flex w-100 justify-content-between align-items-center">
        <div>
          <h6 class="mb-1">
            <i class="bi bi-server me-2"></i> ${escapeHtml(ctrl.name || ctrl.address)}
            <span class="status-badge badge rounded-pill bg-secondary ms-2" style="font-size: 0.65rem;">
              <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
            </span>
          </h6>
          <small class="text-muted"><i class="bi bi-hdd-network me-1"></i> ${escapeHtml(ctrl.address)}</small>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-primary feature-options-btn"><i class="bi bi-sliders"></i> Options</button>
          <button class="btn btn-sm btn-secondary edit-ctrl-btn"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-sm btn-danger delete-ctrl-btn"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    `;
     

    li.querySelector('.feature-options-btn').addEventListener('click', () => openFeatureOptions(index));
    li.querySelector('.edit-ctrl-btn').addEventListener('click', () => openEditController(index));
    li.querySelector('.delete-ctrl-btn').addEventListener('click', async function() {


      setButtonLoading(this, true, '...');

      try {

        controllers.splice(index, 1);
        await saveConfig();
        homebridge.toast.success('Controller removed');
      } catch(e) {

        homebridge.toast.error('Unable to remove the controller: ' + e.message);
      }

      renderControllers();
    });

    list.appendChild(li);

    // Check controller status asynchronously.
    const badge = li.querySelector('.status-badge');

    const updateBadge = (colorClass, icon, label) => {


      badge.className = 'status-badge badge rounded-pill bg-' + colorClass + ' ms-2';
      badge.style.fontSize = '0.65rem';
      badge.textContent = '';
      badge.appendChild(el('i', { className: 'bi bi-' + icon }));
      badge.appendChild(document.createTextNode(' ' + label));
    };

    homebridge.request('/checkStatus', { address: ctrl.address }).then((result) => {

      updateBadge(result?.online ? 'success' : 'danger', result?.online ? 'check-circle' : 'x-circle', result?.online ? 'Online' : 'Offline');
    }).catch(() => {

      updateBadge('warning', 'question-circle', 'Unknown');
    });
  });
};

// Populate the advanced settings section of the setup form, expanding it when any of the settings differ from their defaults.
const fillAdvancedSettings = (ctrl) => {

  $('inputName').value = ctrl.name || '';
  $('inputVerifyTls').checked = ctrl.verifyTls === true;
  $('inputMqttUrl').value = ctrl.mqttUrl || '';
  $('inputMqttTopic').value = ctrl.mqttTopic || '';
  $('inputMqttVerifyTls').checked = ctrl.mqttVerifyTls !== false;
  $('advancedSettings').open = !!(ctrl.name || ctrl.verifyTls || ctrl.mqttUrl || ctrl.mqttTopic || (ctrl.mqttVerifyTls === false));
};

// Apply the advanced settings from the setup form to a controller configuration, leaving out anything at its default so the config stays tidy.
const applyAdvancedSettings = (controllerData, hostname) => {

  const settings = {

    mqttTopic: $('inputMqttTopic').value.trim(),
    mqttUrl: $('inputMqttUrl').value.trim(),
    mqttVerifyTls: $('inputMqttVerifyTls').checked ? undefined : false,

    // Default the name to the controller's hostname when the user hasn't chosen one.
    name: $('inputName').value.trim() || hostname,
    verifyTls: $('inputVerifyTls').checked ? true : undefined,
  };

  for(const [ key, value ] of Object.entries(settings)) {

    if((value === undefined) || (value === '')) {

      delete controllerData[key];
    } else {

      controllerData[key] = value;
    }
  }

  return controllerData;
};

export const openAddController = (prefillAddress) => {


  state.editingIndex = null;
  $('setupTitle').textContent = 'Add UniFi Access Controller';
  $('setupSubtitle').textContent = 'Enter your UniFi Access controller details and login credentials.';
  $('inputAddress').value = prefillAddress || '';
  $('inputUsername').value = '';
  $('inputPassword').value = '';
  fillAdvancedSettings({});
  $('setupError').style.display = 'none';
  $('cancelSetupBtn').style.display = getControllers().length ? 'inline-block' : 'none';
  showScreen('setupScreen');

  if(prefillAddress) {


    $('inputUsername').focus();
  }
};

export const openEditController = (index) => {


  state.editingIndex = index;
  const ctrl = getControllers()[index];

  $('setupTitle').textContent = 'Edit Controller';
  $('setupSubtitle').textContent = 'Editing ' + (ctrl.name || ctrl.address);
  $('inputAddress').value = ctrl.address || '';
  $('inputUsername').value = ctrl.username || '';
  $('inputPassword').value = ctrl.password || '';
  fillAdvancedSettings(ctrl);
  $('setupError').style.display = 'none';
  $('cancelSetupBtn').style.display = 'inline-block';
  showScreen('setupScreen');
};

export const handleSetupSubmit = async (event) => {


  event.preventDefault();
  event.stopPropagation();

  const address = $('inputAddress').value.trim();
  const username = $('inputUsername').value.trim();
  // Passwords may legitimately begin or end with whitespace, so we take them verbatim.
  const password = $('inputPassword').value;

  if(!address || !username || !password) {


    $('setupErrorText').textContent = 'Please fill in all fields.';
    $('setupError').style.display = 'block';

    return;
  }

  const btn = $('saveControllerBtn');

  setButtonLoading(btn, true, 'Validating...');
  $('setupError').style.display = 'none';

  try {


    const devices = await homebridge.request('/getDevices', { address, password, username, verifyTls: $('inputVerifyTls').checked });

    if(!devices?.length) {


      const errorDetail = await homebridge.request('/getErrorMessage');

      $('setupErrorText').textContent = 'Unable to connect. ' + (errorDetail || 'Check your address and credentials.');
      $('setupError').style.display = 'block';
      setButtonLoading(btn, false);

      return;
    }

    state.pluginConfig[0].controllers ||= [];

    const existing = (state.editingIndex !== null) ? state.pluginConfig[0].controllers[state.editingIndex] : {};
    const controllerData = applyAdvancedSettings({ ...existing, address, password, username }, devices[0]?.host?.hostname);

    if(state.editingIndex !== null) {

      state.pluginConfig[0].controllers[state.editingIndex] = controllerData;
    } else {


      state.pluginConfig[0].controllers.push(controllerData);
    }

    await saveConfig();
    homebridge.toast.success(state.editingIndex !== null ? 'Controller updated' : 'Controller added successfully!');
    showScreen('controllersScreen');
    renderControllers();
  } catch(e) {


    $('setupErrorText').textContent = 'Error: ' + e.message;
    $('setupError').style.display = 'block';
  } finally {


    setButtonLoading(btn, false);
  }
};
