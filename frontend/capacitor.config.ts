import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ke.co.rentflow.app',
  appName: 'RentFlow',
  webDir: 'build',
  server: {
    url: 'https://rent-flow-eight-wine.vercel.app',
    cleartext: false,
  },
};

export default config;