'use strict';

const crypto = require('crypto');

class PageSnapshotCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.byTab = new Map();
  }

  createFingerprint(url, title) {
    return crypto
      .createHash('sha1')
      .update(`${url || ''}::${title || ''}`)
      .digest('hex');
  }

  get(tabId, url, title) {
    const key = String(tabId || 'active');
    const entry = this.byTab.get(key);
    if (!entry) return null;
    if (Date.now() > entry.createdAt + entry.ttlMs) {
      this.byTab.delete(key);
      return null;
    }
    if (entry.fingerprint !== this.createFingerprint(url, title)) {
      return null;
    }
    return entry.value;
  }

  set(tabId, url, title, value, ttlMs = this.ttlMs) {
    const key = String(tabId || 'active');
    this.byTab.set(key, {
      fingerprint: this.createFingerprint(url, title),
      createdAt: Date.now(),
      ttlMs,
      value,
    });
  }
}

module.exports = { PageSnapshotCache };
