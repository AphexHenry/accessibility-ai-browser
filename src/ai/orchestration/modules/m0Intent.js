'use strict';

function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function assessIntent(userMessage) {
  const text = String(userMessage || '').trim().toLowerCase();
  if (!text) {
    return {
      intent: 'unknown',
      allow_shared_actions: false,
      rationale: 'empty message',
    };
  }

  const navNeedles = [
    'search for ',
    'look up ',
    'go to ',
    'open ',
    'bring me to',
    'navigate to',
    'take me to',
    'visit ',
    'back',
    'forward',
    'reload',
    'refresh',
  ];

  const settingsNeedles = [
    'settings',
    'setup',
    'configuration',
    'config',
    'preferences',
    'model setup',
  ];

  if (includesAny(text, settingsNeedles)) {
    return {
      intent: 'app_settings',
      allow_shared_actions: true,
      rationale: 'request references app setup/settings controls',
    };
  }

  if (includesAny(text, navNeedles)) {
    return {
      intent: 'navigation',
      allow_shared_actions: true,
      rationale: 'request contains navigation-style phrasing',
    };
  }

  return {
    intent: 'analysis',
    allow_shared_actions: false,
    rationale: 'no shared-action navigation/settings signals detected',
  };
}

module.exports = { assessIntent };
