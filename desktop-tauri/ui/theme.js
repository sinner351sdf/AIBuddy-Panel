/* Shared custom-primary behavior for the classic preferences drawer and React settings. */
(function () {
  'use strict';
  var properties = [
    '--primary', '--primary-foreground', '--ui-primary', '--primary-hover',
    '--ui-primary-hover', '--primary-soft', '--primary-bd', '--primary-fg'
  ];

  function applyPrimaryColor(color) {
    var style = document.documentElement.style;
    if (!color) {
      properties.forEach(function (name) { style.removeProperty(name); });
      return;
    }
    var hex = /^#([0-9a-f]{6})$/i.exec(color);
    var foreground = 'oklch(0.985 0 0)';
    if (hex) {
      var channels = [0, 2, 4].map(function (offset) {
        var value = parseInt(hex[1].slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      var luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      foreground = luminance > 0.179 ? 'oklch(0.145 0 0)' : 'oklch(0.985 0 0)';
    }
    style.setProperty('--primary', color);
    style.setProperty('--ui-primary', color);
    style.setProperty('--primary-foreground', foreground);
    style.setProperty('--primary-hover', 'color-mix(in srgb, ' + color + ' 86%, var(--text))');
    style.setProperty('--ui-primary-hover', 'color-mix(in srgb, ' + color + ' 86%, var(--text))');
    style.setProperty('--primary-soft', 'color-mix(in srgb, ' + color + ' 14%, transparent)');
    style.setProperty('--primary-bd', 'color-mix(in srgb, ' + color + ' 38%, transparent)');
    style.setProperty('--primary-fg', 'color-mix(in srgb, ' + color + ' 70%, var(--text))');
  }

  window.wbTheme = { applyPrimaryColor: applyPrimaryColor };
})();
