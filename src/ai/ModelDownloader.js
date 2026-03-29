'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

class ModelDownloader {
  /**
   * Download a file from url into destDir/filename.
   * onProgress(receivedBytes, totalBytes) is called periodically.
   * Returns the absolute path to the downloaded file.
   */
  download(url, destDir, filename, onProgress) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, filename);
      const file = fs.createWriteStream(dest);

      const request = (targetUrl) => {
        https.get(targetUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            file.close();
            return request(res.headers.location);
          }
          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(dest, () => {});
            return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;

          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress && total > 0) onProgress(received, total);
          });

          res.pipe(file);
          file.on('finish', () => file.close(() => resolve(dest)));
          file.on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
          });
        }).on('error', reject);
      };

      request(url);
    });
  }
}

module.exports = { ModelDownloader };
