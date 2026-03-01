import { SCREENS } from "./constants.js";

export const $ = (id) => document.getElementById(id);

export const showScreen = (screenId) => {


  SCREENS.forEach((id) => {


    $(id).style.display = id === screenId ? "block" : "none";
  });
};

export const setButtonLoading = (btn, loading, loadingText = "Loading...") => {


  if(loading) {


    btn.dataset.originalContent = btn.innerHTML;
    btn.disabled = true;
    /* eslint-disable-next-line no-restricted-syntax */
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
  } else {


    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalContent;
  }
};

export const escapeHtml = (str) => {


  const div = document.createElement("div");

  div.textContent = str;

  return div.innerHTML;
};
