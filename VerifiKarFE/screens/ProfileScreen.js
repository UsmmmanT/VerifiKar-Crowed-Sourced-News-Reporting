import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { API_BASE_URL } from "../config";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../styles/ThemeContext";

export default function ProfileScreen() {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState("My Submissions");
  const [submissions, setSubmissions] = useState([]);
  const [approvedPosts, setApprovedPosts] = useState([]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const displayName = useMemo(() => {
    if (user?.name && user.name.trim()) {
      return user.name.trim();
    }
    if (user?.email) {
      const localPart = user.email.split("@")[0] || "Name";
      return localPart
        .replace(/[._-]/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }
    return "Name";
  }, [user]);

  const loadProfileData = useCallback(async () => {
    try {
      setIsLoadingProfile(true);
      const token = await AsyncStorage.getItem("authToken");
      if (!token) {
        setSubmissions([]);
        setApprovedPosts([]);
        return;
      }

      const response = await fetch(`${API_BASE_URL}/profile/overview`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok || !data?.success) {
        setSubmissions([]);
        setApprovedPosts([]);
        return;
      }

      setSubmissions(data?.details?.submissions || []);
      setApprovedPosts(data?.details?.approved_posts || []);
    } catch {
      setSubmissions([]);
      setApprovedPosts([]);
    } finally {
      setIsLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  useFocusEffect(
    useCallback(() => {
      loadProfileData();
    }, [loadProfileData]),
  );

  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await loadProfileData();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadProfileData]);

  const approvedCount = approvedPosts.length;
  const contributionCount = approvedPosts.length;
  const currentList =
    activeTab === "My Submissions" ? submissions : approvedPosts;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <View
        style={[
          styles.profileCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.profileHeaderRow}>
          <View
            style={[
              styles.avatarWrap,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons name="person" size={30} color={colors.primary} />
          </View>
          <View style={styles.nameWrap}>
            <View style={styles.nameRow}>
              <Text
                style={[styles.name, { color: colors.text }]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={colors.primary}
              />
            </View>
            <Text
              style={[styles.email, { color: colors.gray }]}
              numberOfLines={1}
            >
              {user?.email || "email@example.com"}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.statNumber, { color: colors.text }]}>
              {submissions.length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.gray }]}>
              Submissions
            </Text>
          </View>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.statNumber, { color: colors.text }]}>
              {approvedCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.gray }]}>
              Approved
            </Text>
          </View>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.statNumber, { color: colors.text }]}>
              {contributionCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.gray }]}>
              Contributed
            </Text>
          </View>
        </View>

        <View style={styles.badgesWrap}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Badges
          </Text>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.badgeChip,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={14}
                color={colors.primary}
              />
              <Text style={[styles.badgeText, { color: colors.text }]}>
                Civic Helper
              </Text>
            </View>
            <View
              style={[
                styles.badgeChip,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons name="flash-outline" size={14} color={colors.primary} />
              <Text style={[styles.badgeText, { color: colors.text }]}>
                Active Reporter
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.listCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.listHeaderRow}>
          <Text style={[styles.listHeading, { color: colors.text }]}>
            Activity
          </Text>
          <TouchableOpacity
            style={[
              styles.refreshBtn,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
            onPress={handleRefresh}
            disabled={isRefreshing || isLoadingProfile}
          >
            <Ionicons name="refresh" size={14} color={colors.primary} />
            <Text style={[styles.refreshBtnText, { color: colors.primary }]}>
              Refresh
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabRow}>
          {["My Submissions", "Approved"].map((tab) => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: isActive
                      ? colors.primary
                      : colors.background,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: isActive ? "#fff" : colors.text },
                  ]}
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {isLoadingProfile ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : currentList.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.gray }]}>
            No submissions found for this section.
          </Text>
        ) : (
          currentList.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.submissionCard,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              activeOpacity={activeTab === "Approved" ? 0.8 : 1}
              onPress={() => {
                if (activeTab === "Approved") {
                  navigation.navigate("PostDetails", { postId: item.id });
                }
              }}
            >
              <Text
                style={[styles.submissionTitle, { color: colors.text }]}
                numberOfLines={2}
              >
                {activeTab === "My Submissions" ? item.raw_text : item.content}
              </Text>
              {activeTab === "My Submissions" ? (
                <View
                  style={[styles.statusBadge, { backgroundColor: "#2563eb20" }]}
                >
                  <Text
                    style={{
                      color: "#2563eb",
                      fontSize: 12,
                      fontWeight: "700",
                    }}
                  >
                    {String(item.status || "submitted").toUpperCase()}
                  </Text>
                </View>
              ) : (
                <View
                  style={[styles.statusBadge, { backgroundColor: "#16a34a20" }]}
                >
                  <Text
                    style={{
                      color: "#16a34a",
                      fontSize: 12,
                      fontWeight: "700",
                    }}
                  >
                    APPROVED
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
      </View>

      <TouchableOpacity
        style={[
          styles.logoutBtn,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        onPress={logout}
      >
        <Ionicons name="log-out-outline" size={22} color="#ff4444" />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 28,
  },
  profileCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  nameWrap: {
    flex: 1,
    marginLeft: 12,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  name: {
    fontSize: 20,
    fontWeight: "700",
  },
  email: {
    fontSize: 14,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 18,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  badgesWrap: {
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
  },
  badgeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  listCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  listHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  listHeading: {
    fontSize: 15,
    fontWeight: "700",
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  tabRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  tabChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tabText: {
    fontSize: 12,
    fontWeight: "700",
  },
  submissionCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  submissionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  emptyText: {
    fontSize: 13,
    marginTop: 6,
  },
  loaderWrap: {
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  logoutText: {
    color: "#ff4444",
    fontSize: 16,
    fontWeight: "600",
  },
});
