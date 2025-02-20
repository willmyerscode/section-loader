class WMSectionLoaderManager {
  static states = {
    IDLE: "idle",
    LOADING: "loading",
    COMPLETE: "complete",
    ERROR: "error",
  };
  static defaultSettings = {
    cacheDuration: 5, // minutes
    hooks: {
      beforeInit: [],
      afterInit: [],
      beforeLoad: [],
      afterLoad: [],
    },
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
    this.cache = new Map();
    this.instances = new WeakMap();
    this.pendingFetches = new Map();
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

  isCacheValid(timestamp, duration) {
    const now = new Date().getTime();
    const cacheAge = (now - timestamp) / (1000 * 60); // Convert to minutes
    return cacheAge < duration;
  }

  async fetchAndInsert(el) {
    const src = el.dataset.source || el.dataset.target;
    if (!src) {
      console.warn("No source URL provided for section loader");
      return;
    }

    this.setState(el, WMSectionLoaderManager.states.LOADING);
    const instance = this.instances.get(el);

    try {
      // Check cache first
      const cached = this.cache.get(src);
      if (cached && this.isCacheValid(cached.timestamp, instance.settings.cacheDuration)) {
        el.innerHTML = cached.content;
        this.checkFullWidth(el);
        this.setState(el, WMSectionLoaderManager.states.COMPLETE);
        return;
      }

      // Check if there's already a pending fetch for this URL
      let fetchPromise = this.pendingFetches.get(src);
      let hasSelector = false;
      if (!fetchPromise) {
        // If no pending fetch, create a new one
        const [url, ...args] = src.split(' ');
        hasSelector = args.length > 0;
        fetchPromise = hasSelector
          ? wm$.getFragment(url, args.join(' '))
          : wm$.getFragment(url);
        this.pendingFetches.set(src, fetchPromise);
        
        // Clean up pending fetch after it completes
        fetchPromise.finally(() => {
          this.pendingFetches.delete(src);
        });
      }

      const html = await fetchPromise;  
      const content = html.isConnected ? html.cloneNode(true) : html;
      hasSelector ? el.appendChild(content) : content.querySelectorAll('#sections > *').forEach(child => el.appendChild(child));

      // Update cache
      this.cache.set(src, {
        content: html,
        timestamp: new Date().getTime(),
      });

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
          loader.dataset.loadingState === WMSectionLoaderManager.states.COMPLETE
        ) {
          resolve();
        } else {
          console.log('waiting on state change');
          loader.addEventListener(
            "stateChange",
            e => {
              console.log('stateChange', e.detail.state);
              if (e.detail.state === WMSectionLoaderManager.states.COMPLETE)
                resolve();
            },
            {once: true}
          );
        }
      });
    });

    await Promise.all(loadingPromises);
    await wm$.reloadSquarespaceLifecycle(Array.from(allLoaders));
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