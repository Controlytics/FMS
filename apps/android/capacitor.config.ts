import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.digilog.filtermanagement',
  appName: 'DigiLog',
  webDir: '../web/dist',
  server: {
    url: 'http://192.168.1.22:5175/m',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
