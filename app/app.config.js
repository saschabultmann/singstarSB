// Values come from GitHub repository variables. The CI workflow writes them to
// build-config.json so the EAS build server sees the same values.
let cfg = {};
try { cfg = require("./build-config.json"); } catch (e) { cfg = {}; }
const env = (k) => cfg[k] || process.env[k];

module.exports = {
  expo: {
    name: "SingStar Mic",
    slug: env("EXPO_SLUG") || "singstar-mic",
    owner: env("EXPO_OWNER") || undefined,
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    backgroundColor: "#120d2b",
    splash: { image: "./assets/icon.png", resizeMode: "contain", backgroundColor: "#120d2b" },
    ios: {
      bundleIdentifier: env("BUNDLE_ID") || "de.sascha.singstarmic",
      supportsTablet: false,
      infoPlist: {
        NSMicrophoneUsageDescription: "SingStar Mic uses the microphone to detect your singing pitch. Audio is analysed on the phone and never recorded.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    extra: {
      webUrl: env("WEB_URL") || "",
      eas: { projectId: env("EAS_PROJECT_ID") || undefined },
    },
  },
};
