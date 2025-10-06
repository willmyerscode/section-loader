class WMSectionLoaderManager {
  static states = {
    IDLE: "idle",
    LOADING: "loading",
    COMPLETE: "complete",
    ERROR: "error",
  };
  static defaultSettings = {

    
  };
  static get userSettings() {
    return window["wmSectionLoaderSettings"] || {};
  }
  static instanceSettings(el) {
    const dataAttributes = {};

    function parseAttr(string) {
      if (string === "true") return true;
      if (string === "false") return false;
      const number = parseFloat(string);
      if (!isNaN(number) && number.toString() === string) return number;
      return string;
    }

    // Function to set value in a nested object based on key path
    const setNestedProperty = (obj, keyPath, value) => {
      const keys = keyPath.split("__");
      let current = obj;

      keys.forEach((key, index) => {
        if (index === keys.length - 1) {
          current[key] = parseAttr(value);
        } else {
          current = current[key] = current[key] || {};
        }
      });
    };

    for (let [attrName, value] of Object.entries(el.dataset)) {
      setNestedProperty(dataAttributes, attrName, value);
    }

    if (dataAttributes.metadataBelowExcerpt) {
      dataAttributes.metadataBelowExcerpt = dataAttributes.metadataBelowExcerpt
        .split(",")
        .map(item => item.trim().toLowerCase());
    }
    if (dataAttributes.metadataAboveTitle) {
      dataAttributes.metadataAboveTitle = dataAttributes.metadataAboveTitle
        .split(",")
        .map(item => item.trim().toLowerCase());
    }
    if (dataAttributes.metadataBelowTitle) {
      dataAttributes.metadataBelowTitle = dataAttributes.metadataBelowTitle
        .split(",")
        .map(item => item.trim().toLowerCase());
    }

    return dataAttributes;
  }

  constructor() {
    this.instances = new WeakMap();
  }

  setState(el, state) {
    el.dataset.loadingState = state;
    wm$.emitEvent("wmSectionLoader:stateChange", {el, state});
  }

  async init(onComplete) { 
    wm$.emitEvent("wmSectionLoader:beforeInit");
    const loadEls = document.querySelectorAll(
      '[data-wm-plugin="load"]:not([data-loading-state])'
    );
    if (!loadEls.length) {
      if (onComplete) onComplete();
      return;
    }

    const promises = Array.from(loadEls).map(el => {
      el.classList.add('wm-load-container');
      const settings = wm$.deepMerge(
        {},
        WMSectionLoaderManager.defaultSettings,
        WMSectionLoaderManager.userSettings,
        WMSectionLoaderManager.instanceSettings(el)
      );
      this.instances.set(el, {settings});
      return this.fetchAndInsert(el);
    });

    await Promise.all(promises);

    await this.finalizeLoad();

    wm$.emitEvent("wmSectionLoader:afterInit");
    wm$.emitEvent("wmSectionLoader:ready");
    if (onComplete) onComplete();
  }

  async fetchAndInsert(el) {
    const src = el.dataset.source || el.dataset.target;
    if (!src) {
      console.warn("No source URL provided for section loader");
      return;
    }

    this.setState(el, WMSectionLoaderManager.states.LOADING);

    try {
      const [url, ...args] = src.split(' ');
      const hasSelector = args.length > 0;
      
      const content = hasSelector
        ? await wm$.getFragment(url, args.join(' '))
        : await wm$.getFragment(url, "#sections");

      el.innerHTML = "";
      
      if (hasSelector) {
        el.appendChild(content);
      } else {
        // Append all sections from the fetched content
        content.querySelectorAll('section').forEach(section => {
          el.appendChild(section);
        });
      }

      this.checkFullWidth(el);
      this.setState(el, WMSectionLoaderManager.states.COMPLETE);
    } catch (error) {
      console.error("Error loading section:", error);
      el.innerHTML = "<p>Error loading content</p>";
      this.setState(el, WMSectionLoaderManager.states.ERROR);
    }
  }

  checkFullWidth(el) {
    const closestSection = el.closest(".page-section");
    if (closestSection?.classList.contains("background-width--full-bleed")) {
      el.dataset.isFullWidth = "true";
    }
  }

  async finalizeLoad() {
    // Wait for all loaders to complete
    const allLoaders = document.querySelectorAll('[data-wm-plugin="load"][data-loading-state]');
    const loadingPromises = Array.from(allLoaders).map(loader => {
      return new Promise(resolve => {
        if (
          loader.dataset.loadingState === WMSectionLoaderManager.states.COMPLETE ||
          loader.dataset.loadingState === WMSectionLoaderManager.states.ERROR
        ) {
          resolve();
        } else {
          loader.addEventListener(
            "stateChange",
            e => {
              if (
                e.detail.state === WMSectionLoaderManager.states.COMPLETE ||
                e.detail.state === WMSectionLoaderManager.states.ERROR
              ) {
                resolve();
              }
            },
            {once: true}
          );
        }
      });
    });

    await Promise.all(loadingPromises);
    await wm$.reloadSquarespaceLifecycle(Array.from(allLoaders));
    // await wm$.initializeAllPlugins()

  }

  getInstance(el) {
    return this.instances.get(el);
  }
}

// Create single instance
(function () {
  const loadManager = new WMSectionLoaderManager();

  // Export globally
  window.wmSectionLoader = {
    init: callback => loadManager.init(callback),
    getInstance: el => loadManager.getInstance(el),
  };

  // Auto-init
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => loadManager.init());
  } else {
    loadManager.init();
  }
})();
