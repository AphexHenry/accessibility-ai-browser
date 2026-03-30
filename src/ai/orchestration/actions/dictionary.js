'use strict';

const ACTION_DICTIONARY = Object.freeze([
  { name: 'navigateTo', args: ['target'], risk: 'safe', availability: 'shared' },
  { name: 'goBack', args: [], risk: 'safe', availability: 'shared' },
  { name: 'goForward', args: [], risk: 'safe', availability: 'shared' },
  { name: 'reloadPage', args: [], risk: 'safe', availability: 'shared' },
  { name: 'openSetup', args: [], risk: 'safe', availability: 'shared' },
  { name: 'copyToClipboard', args: ['text'], risk: 'safe', availability: 'shared' },
  { name: 'highlight', args: ['selector'], risk: 'safe', availability: 'page_only' },
  { name: 'scrollTo', args: ['selector'], risk: 'safe', availability: 'page_only' },
  { name: 'focusElement', args: ['selector'], risk: 'safe', availability: 'page_only' },
  { name: 'fillInput', args: ['selector', 'value'], risk: 'confirm', availability: 'page_only' },
  { name: 'clickElement', args: ['selector'], risk: 'confirm', availability: 'page_only' },
  { name: 'selectOption', args: ['selector', 'value'], risk: 'confirm', availability: 'page_only' },
  { name: 'injectCSS', args: ['css'], risk: 'confirm', availability: 'page_only' },
  { name: 'removeHighlights', args: [], risk: 'safe', availability: 'page_only' },
]);

function getActionSpec(name) {
  return ACTION_DICTIONARY.find((action) => action.name === name) || null;
}

function getActionsByAvailability(availability) {
  if (!availability) return ACTION_DICTIONARY;
  return ACTION_DICTIONARY.filter((action) => action.availability === availability);
}

module.exports = { ACTION_DICTIONARY, getActionSpec, getActionsByAvailability };
