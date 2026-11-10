const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('kzRemoteAgent', {
  version: '1.0.0',
  platform: process.platform,
});
