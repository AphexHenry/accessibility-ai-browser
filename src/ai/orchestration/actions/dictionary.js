'use strict';

const ACTION_DICTIONARY = Object.freeze([
  { name: 'highlight', args: ['selector'], risk: 'safe' },
  { name: 'scrollTo', args: ['selector'], risk: 'safe' },
  { name: 'focusElement', args: ['selector'], risk: 'safe' },
  { name: 'fillInput', args: ['selector', 'value'], risk: 'confirm' },
  { name: 'clickElement', args: ['selector'], risk: 'confirm' },
  { name: 'selectOption', args: ['selector', 'value'], risk: 'confirm' },
  { name: 'injectCSS', args: ['css'], risk: 'confirm' },
  { name: 'removeHighlights', args: [], risk: 'safe' },
  { name: 'copyToClipboard', args: ['text'], risk: 'safe' },
]);

function getActionSpec(name) {
  return ACTION_DICTIONARY.find((action) => action.name === name) || null;
}

module.exports = { ACTION_DICTIONARY, getActionSpec };
