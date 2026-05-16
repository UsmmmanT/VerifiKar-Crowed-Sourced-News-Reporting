import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { API_BASE_URL } from "../config";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const parseJsonSafely = async (response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const getAuthBaseCandidates = () => {
    const candidates = new Set([API_BASE_URL]);
    const expoHost = Constants.expoConfig?.hostUri?.split(":")?.[0];
    const isPhysicalDevice = Device.isDevice === true || Constants.isDevice === true;
    const isAndroidEmulator = Platform.OS === "android" && isPhysicalDevice === false;

    if (expoHost) {
      candidates.add(`http://${expoHost}:8000`);
    }

    if (isAndroidEmulator) {
      candidates.add("http://10.0.2.2:8000");
      candidates.add("http://10.0.3.2:8000");
    }

    if (!isPhysicalDevice || Platform.OS === "web") {
      candidates.add("http://localhost:8000");
    }

    return Array.from(candidates).filter(Boolean);
  };

  const authFetchWithFallback = async (path, options) => {
    const candidates = getAuthBaseCandidates();
    let lastError = null;

    for (const baseUrl of candidates) {
      try {
        console.log("Auth request:", `${baseUrl}${path}`);
        return await fetchWithTimeout(`${baseUrl}${path}`, options, 10000);
      } catch (error) {
        lastError = error;
        console.log("Auth endpoint failed:", baseUrl, error?.name || error);
      }
    }

    throw lastError || new Error("All auth endpoints failed");
  };

  useEffect(() => {
    checkLoginStatus();
  }, []);

  const refreshSession = async (tokenToRefresh) => {
    try {
      const response = await authFetchWithFallback("/auth/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refresh_token: tokenToRefresh }),
      });

      const data = await parseJsonSafely(response);
      if (!response.ok || !data?.success) {
        await AsyncStorage.removeItem("authToken");
        await AsyncStorage.removeItem("refreshToken");
        return false;
      }

      const tokenData = data.details || data;
      if (tokenData.access_token) {
        await AsyncStorage.setItem("authToken", tokenData.access_token);
      }
      if (tokenData.refresh_token) {
        await AsyncStorage.setItem("refreshToken", tokenData.refresh_token);
      }

      return true;
    } catch (error) {
      console.log("Refresh token error:", error);
      return false;
    }
  };

  const checkLoginStatus = async () => {
    try {
      const token = await AsyncStorage.getItem("authToken");
      const refreshToken = await AsyncStorage.getItem("refreshToken");
      const userData = await AsyncStorage.getItem("userData");

      if (refreshToken) {
        // New logic: refresh session on app start to avoid forced logins.
        const refreshed = await refreshSession(refreshToken);
        if (refreshed && userData) {
          setUser(JSON.parse(userData));
        } else {
          // Token refresh failed - clear everything and force login
          await AsyncStorage.removeItem("authToken");
          await AsyncStorage.removeItem("refreshToken");
          await AsyncStorage.removeItem("userData");
          setUser(null);
        }
        return;
      }

      if (token && userData) {
        setUser(JSON.parse(userData));
      }
    } catch (error) {
      console.log("Error checking login status:", error);
      // On error, clear auth state to be safe
      try {
        await AsyncStorage.removeItem("authToken");
        await AsyncStorage.removeItem("refreshToken");
        await AsyncStorage.removeItem("userData");
      } catch (clearError) {
        console.log("Error clearing auth state:", clearError);
      }
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const getValidAccessToken = async () => {
    const token = await AsyncStorage.getItem("authToken");
    const refreshToken = await AsyncStorage.getItem("refreshToken");

    if (!refreshToken) {
      return token;
    }

    const refreshed = await refreshSession(refreshToken);
    if (!refreshed) {
      return null;
    }

    return await AsyncStorage.getItem("authToken");
  };

  const login = async (email, password) => {
    try {
      console.log("Login started for:", email);

      // OAuth2 password flow requires application/x-www-form-urlencoded
      const formData = new URLSearchParams();
      formData.append("username", email.trim()); // OAuth2 uses 'username' field
      formData.append("password", password);
      formData.append("grant_type", "password");

      // Send login request to backend using OAuth2 format
      const response = await authFetchWithFallback("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const data = await parseJsonSafely(response);
      console.log("Login response:", response.status, data);

      if (response.ok) {
        // Success - Store token and user data from the response
        const tokenData = data.details || data;

        if (tokenData.access_token) {
          await AsyncStorage.setItem("authToken", tokenData.access_token);
        }
        if (tokenData.refresh_token) {
          await AsyncStorage.setItem("refreshToken", tokenData.refresh_token);
        }

        // Store user data
        const userData = {
          email: email,
          // Add any additional user data from backend if available
        };

        await AsyncStorage.setItem("userData", JSON.stringify(userData));
        setUser(userData);

        console.log("Login successful!");
        return { success: true };
      } else {
        // Server returned an error
        const errorDetail = data.detail || {};
        const errorMessage =
          errorDetail.details?.message ||
          errorDetail.message ||
          "Invalid email or password";
        console.log("Login failed:", errorMessage);
        return { success: false, message: errorMessage };
      }
    } catch (error) {
      console.log("Login error:", error);
      return {
        success: false,
        message:
          error?.name === "AbortError"
            ? "Login request timed out. Please check that the backend is running and reachable."
            : "Unable to connect to the server. Please check your internet connection.",
      };
    }
  };

  const signup = async (name, email, password) => {
    try {
      console.log("Signup started for:", email);

      // Send signup request to backend
      const response = await authFetchWithFallback("/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
        }),
      });

      const data = await parseJsonSafely(response);
      console.log("Signup response:", response.status, data);

      if (response.ok) {
        // Signup successful! Now automatically log the user in to get a token
        console.log("Signup successful! Now logging in...");

        // Call the login function to get the JWT token
        const loginResult = await login(email, password);

        if (loginResult.success) {
          console.log("Auto-login after signup successful!");
          return { success: true };
        } else {
          // Signup succeeded but login failed - user needs to login manually
          console.log(
            "Signup succeeded but auto-login failed:",
            loginResult.message,
          );
          return {
            success: true,
            message: "Account created! Please log in to continue.",
          };
        }
      } else {
        // Server returned an error
        const errorMessage =
          data.detail || data.message || "Signup failed. Please try again.";
        console.log("Signup failed:", errorMessage);
        return { success: false, message: errorMessage };
      }
    } catch (error) {
      console.log("Signup error:", error);
      return {
        success: false,
        message:
          error?.name === "AbortError"
            ? "Signup request timed out. Please check that the backend is running and reachable."
            : "Unable to connect to the server. Please check your internet connection.",
      };
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem("authToken");
      await AsyncStorage.removeItem("refreshToken");
      await AsyncStorage.removeItem("userData");
      setUser(null);
    } catch (error) {
      console.log("Error logging out:", error);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, login, signup, logout, getValidAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
