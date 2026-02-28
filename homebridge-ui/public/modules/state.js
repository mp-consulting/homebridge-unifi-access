export const state = {


  pluginConfig: [],
  editingIndex: null,
  devices: [],
  categories: [],
  options: {},
  currentControllerIndex: null,
  openCategories: new Set()
};

export const getControllers = () => state.pluginConfig[0]?.controllers || [];

export const saveConfig = async () => {


  await homebridge.updatePluginConfig(state.pluginConfig);
  await homebridge.savePluginConfig();
};

export const saveConfigSilent = async () => {


  await homebridge.updatePluginConfig(state.pluginConfig);
};
