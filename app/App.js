import React, { useState } from "react";
import { SafeAreaView, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import Constants from "expo-constants";

const WEB_URL = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.webUrl) || "";

export default function App() {
  useKeepAwake();
  const [key, setKey] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!WEB_URL) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Web URL not configured.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.text}>Can't reach SingStar Party. Check your internet connection.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => { setFailed(false); setKey(key + 1); }}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          key={key}
          source={{ uri: WEB_URL.replace(/\/$/, "") + "/mic.html?app=1" }}
          style={styles.root}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          startInLoadingState
          renderLoading={() => (
            <View style={styles.center}><ActivityIndicator color="#ffd23f" size="large" /></View>
          )}
          onError={() => setFailed(true)}
          bounces={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#120d2b" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#120d2b", padding: 24 },
  text: { color: "#fff", fontSize: 17, textAlign: "center", marginBottom: 16 },
  btn: { backgroundColor: "#ff4fa3", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
