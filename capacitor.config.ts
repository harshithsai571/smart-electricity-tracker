import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.smart.electricitytracker",
  appName: "Smart Electricity Tracker",
  webDir: "www",
  server: {
    url: "https://harshithsai571.github.io/Smart-Electricity-Tracker/",
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
