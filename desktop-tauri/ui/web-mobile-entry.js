// Compatibility for cached HTML from the shared-panel experiment.
// Return to the dedicated mobile shell without changing its saved tab.
(() => { location.replace('/m' + location.search + location.hash); })();
