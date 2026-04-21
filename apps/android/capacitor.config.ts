import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.digilog.filtermanagement',
  appName: 'DigiLog',
  webDir: '../web/dist',
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: { biometricAuth: false},
    },
  },
};

export default config;
