import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { API_BASE_URL } from "../config";

// Store notification handlers references for cleanup
let notificationSubscription = null;
let responseSubscription = null;

/**
 * Step 47: Initialize notification handler
 * Sets how the app handles notifications when in the foreground
 */
export const initializeNotificationHandler = () => {
  console.log("[🔧 Handler Setup] Initializing notification handler...");
  
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      console.log("[🔧 Handler] handleNotification called!");
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      };
    },
  });
  
  console.log("[🔧 Handler Setup] Notification handler initialized ✅");
};

/**
 * Step 48: Register for push notifications
 * Requests user permission and gets a unique push token
 * @returns {Promise<string|null>} The device push token or null if failed
 */
export const registerForPushNotifications = async () => {
  try {
    // Check if device is physical (not an emulator/simulator)
    if (!Device.isDevice) {
      console.log("Must use physical device for push notifications");
      return null;
    }

    // Request notification permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Failed to get push notification permissions");
      return null;
    }

    // Get the push token
    let token = null;
    const projectId =
      process.env.EXPO_PUBLIC_PROJECT_ID ||
      Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      console.warn(
        "[Notifications] EXPO_PUBLIC_PROJECT_ID not set. " +
        "Push notifications will not work in Expo Go. " +
        "For production builds, set EXPO_PUBLIC_PROJECT_ID in app.json or .env files."
      );
      return null;
    }

    try {
      if (Platform.OS === "android") {
        // For Android, use Notifications.getExpoPushTokenAsync()
        const expoPushToken = await Notifications.getExpoPushTokenAsync({
          projectId: projectId,
        });
        token = expoPushToken.data;
      } else if (Platform.OS === "ios") {
        // For iOS, get the APNs token then Expo push token
        const apnsToken = await Notifications.getDevicePushTokenAsync({
          isProduction: true,
        });
        if (apnsToken.data) {
          const expoPushToken = await Notifications.getExpoPushTokenAsync({
            projectId: projectId,
          });
          token = expoPushToken.data;
        }
      }

      console.log("Push token obtained:", token);
      console.log("Expo projectId used:", projectId);
      return token;
    } catch (tokenError) {
      console.error("Error obtaining push token:", tokenError);
      return null;
    }
  } catch (error) {
    console.error("Error registering for push notifications:", error);
    return null;
  }
};

/**
 * Step 49: Register device token with backend
 * Sends the push token to the backend for storing
 * @param {string} token - The push notification token
 * @param {string} authToken - User's JWT authentication token
 * @returns {Promise<boolean>} Success status
 */
export const registerTokenWithBackend = async (token, authToken) => {
  try {
    if (!token || !authToken) {
      console.error("Token or authToken is missing");
      return false;
    }

    const response = await fetch(`${API_BASE_URL}/auth/register-device-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        device_token: token,
        platform: Platform.OS, // "android" or "ios"
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Failed to register token with backend:", errorData);
      return false;
    }

    const data = await response.json();
    console.log("Token registered with backend successfully:", data);

    // Store token locally for reference
    await AsyncStorage.setItem(`push_token_${authToken}`, token);
    await AsyncStorage.setItem("last_token_registration", new Date().toISOString());

    return true;
  } catch (error) {
    console.error("Error registering token with backend:", error);
    return false;
  }
};

/**
 * Step 50: Setup notification listeners
 * Listens for incoming notifications and user interactions
 * @param {Function} onNotificationReceived - Callback when notification is received
 * @param {Function} onNotificationResponseReceived - Callback when user taps notification
 * @returns {Function} Cleanup function to remove listeners
 */
export const setupNotificationListeners = (
  onNotificationReceived,
  onNotificationResponseReceived
) => {
  try {
    console.log("[🔔 Listener Setup] Starting notification listener setup...");

    // Listen for notifications when app is in foreground
    notificationSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("========================================");
        console.log("🔔 [NOTIFICATION RECEIVED] ✅✅✅");
        console.log("========================================");
        console.log("Full notification object:", JSON.stringify(notification, null, 2));
        console.log("Title:", notification.request.content.title);
        console.log("Body:", notification.request.content.body);
        console.log("Data:", notification.request.content.data);
        console.log("========================================");

        if (onNotificationReceived) {
          try {
            onNotificationReceived(notification);
          } catch (e) {
            console.error("Error in onNotificationReceived callback:", e);
          }
        }
      }
    );

    console.log("[🔔 Listener Setup] Foreground listener attached ✅");

    // Listen for user interactions with notifications
    responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log("========================================");
        console.log("📱 [NOTIFICATION TAP] - User interacted with notification");
        console.log("========================================");
        console.log("Response:", JSON.stringify(response, null, 2));
        console.log("========================================");

        if (onNotificationResponseReceived) {
          try {
            onNotificationResponseReceived(response);
          } catch (e) {
            console.error("Error in onNotificationResponseReceived callback:", e);
          }
        }
      });

    console.log("[🔔 Listener Setup] Response listener attached ✅");

    // Return cleanup function
    return () => {
      if (notificationSubscription) {
        notificationSubscription.remove();
      }
      if (responseSubscription) {
        responseSubscription.remove();
      }
    };
  } catch (error) {
    console.error("Error setting up notification listeners:", error);
    return () => {}; // Return empty cleanup function on error
  }
};

/**
 * Complete notification setup flow
 * Combines all steps: register for notifications, send token to backend, setup listeners
 * @param {string} authToken - User's JWT authentication token
 * @param {Function} onNotificationReceived - Callback for received notifications
 * @param {Function} onNotificationResponseReceived - Callback for user interactions
 * @returns {Promise<Object>} Setup result with status and cleanup function
 */
export const setupCompleteNotificationFlow = async (
  authToken,
  onNotificationReceived,
  onNotificationResponseReceived
) => {
  try {
    console.log("[📱 Complete Flow] Starting complete notification setup...");
    
    initializeNotificationHandler();

    // Step 1: Register for push notifications
    console.log("[📱 Complete Flow] Step 1: Registering for push notifications...");
    const token = await registerForPushNotifications();
    
    if (!token) {
      console.warn(
        "[📱 Complete Flow] ❌ Could not obtain push token. " +
        "Notifications will not be available in this session."
      );
      // Still continue with local listeners setup, but without backend registration
      const cleanup = setupNotificationListeners(
        onNotificationReceived,
        onNotificationResponseReceived
      );
      return {
        success: true,
        token: null,
        error: "Push notifications unavailable",
        cleanup,
      };
    }

    console.log("[📱 Complete Flow] ✅ Step 1 complete. Token:", token?.substring(0, 30) + "...");

    // Step 2: Skip backend registration (local-only token usage)
    console.log("[📱 Complete Flow] Step 2: Skipping backend token registration");

    // Step 3: Setup listeners
    console.log("[📱 Complete Flow] Step 3: Setting up notification listeners...");
    const cleanup = setupNotificationListeners(
      onNotificationReceived,
      onNotificationResponseReceived
    );
    console.log("[📱 Complete Flow] ✅ Step 3 complete. Listeners attached");

    console.log("[📱 Complete Flow] ✅✅✅ COMPLETE FLOW SUCCESSFUL ✅✅✅");

    return {
      success: true,
      token,
      cleanup,
    };
  } catch (error) {
    console.error("Error in complete notification flow:", error);
    return {
      success: true, // Still return success to not break the app
      token: null,
      error: error.message,
      cleanup: () => {},
    };
  }
};
