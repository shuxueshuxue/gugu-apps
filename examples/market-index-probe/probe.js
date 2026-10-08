// The probe page says which version is running: the version in the page's own markup is the version installed.
document.title = `市场探针 · ${document.querySelector('[data-probe-version]')?.textContent ?? '?'}`;
