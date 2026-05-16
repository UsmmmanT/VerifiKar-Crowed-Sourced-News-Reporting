import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import React, { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config';
import { useTheme } from '../styles/ThemeContext';

const NOTIFICATIONS_KEY = '@verifikar_notifications_enabled';
const SHARE_LOCATION_KEY = '@verifikar_share_location';
const PUBLIC_PROFILE_KEY = '@verifikar_public_profile';
const BIOMETRIC_LOCK_KEY = '@verifikar_biometric_lock';
const TWO_FACTOR_KEY = '@verifikar_two_factor_auth';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { colors, isDark, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = React.useState(true);
  const [shareLocation, setShareLocation] = React.useState(true);
  const [publicProfile, setPublicProfile] = React.useState(false);
  const [biometricLock, setBiometricLock] = React.useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = React.useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = React.useState(false);
  const [securityModalVisible, setSecurityModalVisible] = React.useState(false);
  const [changePasswordModalVisible, setChangePasswordModalVisible] = React.useState(false);
  const [helpModalVisible, setHelpModalVisible] = React.useState(false);
  const [aboutModalVisible, setAboutModalVisible] = React.useState(false);
  const [expandedFaqIndex, setExpandedFaqIndex] = React.useState(0);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [changingPassword, setChangingPassword] = React.useState(false);

  const faqItems = [
    {
      question: 'How do I navigate the app?',
      answer:
        'Use the bottom tabs: Home for feed, Report to submit incidents, Discover to explore nearby activity, and Profile for your account. The top-right icons in Home open search, filters, and settings.',
    },
    {
      question: 'How do I submit a report?',
      answer:
        'Open the Report tab, add a clear description, attach media if available, and submit. The app sends your report to the backend where it enters the processing pipeline.',
    },
    {
      question: 'How are posts generated from reports?',
      answer:
        'After submission, background workers preprocess report text and media, generate embeddings, cluster similar reports, and create/update posts when significance thresholds are met.',
    },
    {
      question: 'Why does my report not appear immediately?',
      answer:
        'Reports may take time to process due to background queue steps, media analysis, and clustering. If workers or model services are offline, processing is delayed until services recover.',
    },
    {
      question: 'What does credibility mean in feed filters?',
      answer:
        'Credibility is a confidence-style score derived from signal checks in processing. Use the Trust Score filter in Home to hide lower-confidence posts and focus on stronger signals.',
    },
    {
      question: 'How do location and distance filters work?',
      answer:
        'The app uses your current location and selected radius to request nearby posts. You can adjust distance, categories, credibility, and time window from the filter panel in Home.',
    },
    {
      question: 'How do I troubleshoot network errors?',
      answer:
        'Confirm backend is running, API URL points to your current machine IP, phone and laptop are on the same Wi-Fi, and firewall allows backend port access.',
    },
    {
      question: 'How can I contact support?',
      answer:
        'Use the Contact Support button below to open your email app and send details. Include device type, error message, and steps to reproduce for faster help.',
    },
  ];

  // Load notifications preference on mount
  useEffect(() => {
    loadNotificationsPreference();
    loadPrivacyPreferences();
    loadSecurityPreferences();
  }, []);

  const loadNotificationsPreference = async () => {
    try {
      const saved = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
      if (saved !== null) {
        setNotificationsEnabled(saved === 'true');
      }
    } catch (error) {
      console.log('Error loading notifications preference:', error);
    }
  };

  const handleNotificationsToggle = async (value) => {
    setNotificationsEnabled(value);
    try {
      await AsyncStorage.setItem(NOTIFICATIONS_KEY, value.toString());
    } catch (error) {
      console.log('Error saving notifications preference:', error);
    }
  };

  const loadPrivacyPreferences = async () => {
    try {
      const savedShareLocation = await AsyncStorage.getItem(SHARE_LOCATION_KEY);
      const savedPublicProfile = await AsyncStorage.getItem(PUBLIC_PROFILE_KEY);

      if (savedShareLocation !== null) {
        setShareLocation(savedShareLocation === 'true');
      }
      if (savedPublicProfile !== null) {
        setPublicProfile(savedPublicProfile === 'true');
      }
    } catch (error) {
      console.log('Error loading privacy preferences:', error);
    }
  };

  const loadSecurityPreferences = async () => {
    try {
      const savedBiometricLock = await AsyncStorage.getItem(BIOMETRIC_LOCK_KEY);
      const savedTwoFactor = await AsyncStorage.getItem(TWO_FACTOR_KEY);

      if (savedBiometricLock !== null) {
        setBiometricLock(savedBiometricLock === 'true');
      }
      if (savedTwoFactor !== null) {
        setTwoFactorEnabled(savedTwoFactor === 'true');
      }
    } catch (error) {
      console.log('Error loading security preferences:', error);
    }
  };

  const handleShareLocationToggle = async (value) => {
    setShareLocation(value);
    try {
      await AsyncStorage.setItem(SHARE_LOCATION_KEY, value.toString());
    } catch (error) {
      console.log('Error saving share location setting:', error);
    }
  };

  const handlePublicProfileToggle = async (value) => {
    setPublicProfile(value);
    try {
      await AsyncStorage.setItem(PUBLIC_PROFILE_KEY, value.toString());
    } catch (error) {
      console.log('Error saving public profile setting:', error);
    }
  };

  const handleBiometricLockToggle = async (value) => {
    if (value) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        Alert.alert('Biometric Lock', 'This device does not support biometric authentication.');
        return;
      }

      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        Alert.alert('Biometric Lock', 'No biometric method is enrolled on this device.');
        return;
      }

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable biometric lock',
        fallbackLabel: 'Use device passcode',
      });

      if (!authResult.success) {
        Alert.alert('Biometric Lock', 'Authentication failed. Biometric lock was not enabled.');
        return;
      }
    }

    setBiometricLock(value);
    await AsyncStorage.setItem(BIOMETRIC_LOCK_KEY, value.toString());
  };

  const handleTwoFactorToggle = async (value) => {
    if (value && !biometricLock) {
      Alert.alert('Two-Factor Auth', 'Please enable Biometric Lock first to use 2FA.');
      return;
    }

    if (value) {
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable two-factor authentication',
        fallbackLabel: 'Use device passcode',
      });
      if (!authResult.success) {
        Alert.alert('Two-Factor Auth', 'Verification failed. 2FA was not enabled.');
        return;
      }
    }

    setTwoFactorEnabled(value);
    await AsyncStorage.setItem(TWO_FACTOR_KEY, value.toString());
  };

  const authenticateIfRequired = async (promptMessage) => {
    if (!twoFactorEnabled) {
      return true;
    }

    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use device passcode',
    });

    if (!authResult.success) {
      Alert.alert('Security Check', 'Verification failed. Please try again.');
      return false;
    }

    return true;
  };

  const openChangePasswordModal = async () => {
    const ok = await authenticateIfRequired('Verify before changing password');
    if (!ok) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChangePasswordModalVisible(true);
  };

  const submitPasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Change Password', 'Please fill all fields.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Change Password', 'New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Change Password', 'New password and confirm password do not match.');
      return;
    }

    try {
      setChangingPassword(true);
      const token = await AsyncStorage.getItem('authToken');
      if (!token) {
        Alert.alert('Change Password', 'You are not authenticated. Please login again.');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      const data = await response.json();
      if (response.status === 401) {
        Alert.alert(
          'Session Expired',
          'Your login session has expired. Please login again.',
          [
            {
              text: 'OK',
              onPress: async () => {
                setChangePasswordModalVisible(false);
                setSecurityModalVisible(false);
                await logout();
              },
            },
          ]
        );
        return;
      }

      if (!response.ok || !data.success) {
        const message = data?.detail?.details || data?.details || 'Unable to change password.';
        Alert.alert('Change Password', message);
        return;
      }

      Alert.alert('Change Password', 'Password changed successfully.');
      setChangePasswordModalVisible(false);
    } catch (error) {
      console.log('Error changing password:', error);
      Alert.alert('Change Password', 'Network error while changing password.');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleAccountPress = () => {
    Alert.alert(
      'Account',
      `Logged in as: ${user?.email || 'Unknown user'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Profile',
          onPress: () => navigation.navigate('Profile'),
        },
      ]
    );
  };

  const handleHelpPress = async () => {
    setHelpModalVisible(true);
  };

  const handleContactSupport = async () => {
    const supportEmail = 'mailto:support@verifikar.app?subject=VerifiKar%20Support';
    try {
      const canOpen = await Linking.canOpenURL(supportEmail);
      if (canOpen) {
        await Linking.openURL(supportEmail);
      } else {
        Alert.alert('Help & Support', 'Email app is not available on this device.');
      }
    } catch (error) {
      console.log('Error opening support email:', error);
      Alert.alert('Help & Support', 'Unable to open support right now. Please try again.');
    }
  };

  const handleAboutPress = () => {
    setAboutModalVisible(true);
  };

  const handleLogoutPress = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          const ok = await authenticateIfRequired('Verify to logout');
          if (ok) {
            logout();
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Theme Toggle */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <View style={styles.settingItem}>
          <View style={styles.settingLeft}>
            <Ionicons name="moon-outline" size={24} color={colors.text} />
            <Text style={[styles.settingText, { color: colors.text }]}>Dark Mode</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: colors.gray, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </View>
      </View>

      {/* Notifications */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <View style={styles.settingItem}>
          <View style={styles.settingLeft}>
            <Ionicons name="notifications-outline" size={24} color={colors.text} />
            <Text style={[styles.settingText, { color: colors.text }]}>Notifications</Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleNotificationsToggle}
            trackColor={{ false: colors.gray, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </View>
      </View>

      {/* Account Settings */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <TouchableOpacity style={styles.settingItem} onPress={handleAccountPress}>
          <View style={styles.settingLeft}>
            <Ionicons name="person-outline" size={24} color={colors.text} />
            <Text style={[styles.settingText, { color: colors.text }]}>Account</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.gray} />
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <TouchableOpacity style={styles.settingItem} onPress={() => setPrivacyModalVisible(true)}>
          <View style={styles.settingLeft}>
            <Ionicons name="lock-closed-outline" size={24} color={colors.text} />
            <Text style={[styles.settingText, { color: colors.text }]}>Privacy</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.gray} />
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <TouchableOpacity style={styles.settingItem} onPress={() => setSecurityModalVisible(true)}>
          <View style={styles.settingLeft}>
            <Ionicons name="shield-outline" size={24} color={colors.text} />
            <Text style={[styles.settingText, { color: colors.text }]}>Security</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.gray} />
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <TouchableOpacity style={styles.settingItem} onPress={handleHelpPress}>
          <View style={styles.settingLeft}>
            <Ionicons name="help-circle-outline" size={24} color={colors.text} />
            <Text style={[styles.settingText, { color: colors.text }]}>Help & Support</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.gray} />
        </TouchableOpacity>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <TouchableOpacity style={styles.settingItem} onPress={handleAboutPress}>
          <View style={styles.settingLeft}>
            <Ionicons name="information-circle-outline" size={24} color={colors.text} />
            <Text style={[styles.settingText, { color: colors.text }]}>About</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={colors.gray} />
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <TouchableOpacity style={styles.settingItem} onPress={handleLogoutPress}>
          <View style={styles.settingLeft}>
            <Ionicons name="log-out-outline" size={24} color="#ef4444" />
            <Text style={[styles.settingText, { color: '#ef4444' }]}>Logout</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Text style={[styles.version, { color: colors.gray }]}>Version 1.0.0</Text>

      <Modal
        animationType="slide"
        visible={privacyModalVisible}
        transparent
        onRequestClose={() => setPrivacyModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Privacy Settings</Text>
              <TouchableOpacity onPress={() => setPrivacyModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="location-outline" size={22} color={colors.text} />
                <Text style={[styles.settingText, { color: colors.text }]}>Share Location</Text>
              </View>
              <Switch
                value={shareLocation}
                onValueChange={handleShareLocationToggle}
                trackColor={{ false: colors.gray, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="eye-outline" size={22} color={colors.text} />
                <Text style={[styles.settingText, { color: colors.text }]}>Public Profile</Text>
              </View>
              <Switch
                value={publicProfile}
                onValueChange={handlePublicProfileToggle}
                trackColor={{ false: colors.gray, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        visible={securityModalVisible}
        transparent
        onRequestClose={() => setSecurityModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Security Settings</Text>
              <TouchableOpacity onPress={() => setSecurityModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="finger-print-outline" size={22} color={colors.text} />
                <Text style={[styles.settingText, { color: colors.text }]}>Biometric Lock</Text>
              </View>
              <Switch
                value={biometricLock}
                onValueChange={handleBiometricLockToggle}
                trackColor={{ false: colors.gray, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.settingItem}>
              <View style={styles.settingLeft}>
                <Ionicons name="key-outline" size={22} color={colors.text} />
                <Text style={[styles.settingText, { color: colors.text }]}>Two-Factor Auth</Text>
              </View>
              <Switch
                value={twoFactorEnabled}
                onValueChange={handleTwoFactorToggle}
                trackColor={{ false: colors.gray, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>

            <TouchableOpacity
              style={[styles.infoButton, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={openChangePasswordModal}
            >
              <Ionicons name="lock-open-outline" size={18} color={colors.text} />
              <Text style={[styles.infoButtonText, { color: colors.text }]}>Change Password</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        visible={changePasswordModalVisible}
        transparent
        onRequestClose={() => setChangePasswordModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Change Password</Text>
              <TouchableOpacity onPress={() => setChangePasswordModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.formBody}>
              <Text style={[styles.inputLabel, { color: colors.gray }]}>Current password</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.lightGray, backgroundColor: colors.background }]}
                secureTextEntry
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="Enter current password"
                placeholderTextColor={colors.gray}
              />

              <Text style={[styles.inputLabel, { color: colors.gray }]}>New password</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.lightGray, backgroundColor: colors.background }]}
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Minimum 8 characters"
                placeholderTextColor={colors.gray}
              />

              <Text style={[styles.inputLabel, { color: colors.gray }]}>Confirm new password</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.lightGray, backgroundColor: colors.background }]}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Re-enter new password"
                placeholderTextColor={colors.gray}
              />

              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                onPress={submitPasswordChange}
                disabled={changingPassword}
              >
                {changingPassword ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Update Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        visible={aboutModalVisible}
        transparent
        onRequestClose={() => setAboutModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>About VerifiKar</Text>
              <TouchableOpacity onPress={() => setAboutModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.aboutBrandBlock}>
              <View style={[styles.aboutBrandIcon, { backgroundColor: colors.primary + '18' }]}>
                <Ionicons name="shield-checkmark" size={34} color={colors.primary} />
              </View>
              <Text style={[styles.aboutTitle, { color: colors.text }]}>VerifiKar</Text>
              <Text style={[styles.aboutTagline, { color: colors.gray }]}>Credibility-first local incident reporting</Text>
            </View>

            <View style={[styles.aboutInfoCard, { backgroundColor: colors.background, borderColor: colors.lightGray }]}>
              <View style={styles.aboutInfoRow}>
                <Text style={[styles.aboutInfoLabel, { color: colors.gray }]}>Version</Text>
                <Text style={[styles.aboutInfoValue, { color: colors.text }]}>1.0.0</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.lightGray, marginLeft: 0 }]} />
              <View style={styles.aboutInfoRow}>
                <Text style={[styles.aboutInfoLabel, { color: colors.gray }]}>Platform</Text>
                <Text style={[styles.aboutInfoValue, { color: colors.text }]}>{Platform.OS}</Text>
              </View>
            </View>

            <View style={styles.aboutActions}>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.lightGray, backgroundColor: colors.background }]}
                onPress={() => Alert.alert('Legal', 'Terms and privacy policy links will be added in the next update.')}
              >
                <Ionicons name="document-text-outline" size={18} color={colors.text} />
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Terms & Privacy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.infoButton, { borderColor: colors.lightGray, backgroundColor: colors.background }]}
                onPress={handleContactSupport}
              >
                <Ionicons name="mail-outline" size={18} color={colors.text} />
                <Text style={[styles.infoButtonText, { color: colors.text }]}>Contact Support</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        visible={helpModalVisible}
        transparent
        onRequestClose={() => setHelpModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Help & Support</Text>
              <TouchableOpacity onPress={() => setHelpModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.helpBody} showsVerticalScrollIndicator={false}>
              <Text style={[styles.helpIntro, { color: colors.gray }]}>Frequently asked questions</Text>

              {faqItems.map((item, index) => {
                const isExpanded = expandedFaqIndex === index;
                return (
                  <View
                    key={item.question}
                    style={[styles.faqCard, { backgroundColor: colors.background, borderColor: colors.lightGray }]}
                  >
                    <TouchableOpacity
                      style={styles.faqHeader}
                      onPress={() => setExpandedFaqIndex(isExpanded ? -1 : index)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.faqQuestion, { color: colors.text }]}>{item.question}</Text>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.gray}
                      />
                    </TouchableOpacity>
                    {isExpanded && (
                      <Text style={[styles.faqAnswer, { color: colors.gray }]}>{item.answer}</Text>
                    )}
                  </View>
                );
              })}

              <TouchableOpacity
                style={[styles.infoButton, { borderColor: colors.lightGray, backgroundColor: colors.background }]}
                onPress={handleContactSupport}
              >
                <Ionicons name="mail-outline" size={18} color={colors.text} />
                <Text style={[styles.infoButtonText, { color: colors.text }]}>Contact Support</Text>
              </TouchableOpacity>

              <View style={{ height: 12 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginTop: 20,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginLeft: 52,
  },
  version: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: 20,
    marginBottom: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#0000001A',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  infoButton: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  infoButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  aboutBrandBlock: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  aboutBrandIcon: {
    height: 72,
    width: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  aboutTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  aboutTagline: {
    marginTop: 4,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  aboutInfoCard: {
    marginHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  aboutInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  aboutInfoLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  aboutInfoValue: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  aboutActions: {
    marginTop: 14,
    marginBottom: 16,
  },
  secondaryButton: {
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  helpBody: {
    maxHeight: 520,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  helpIntro: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  faqCard: {
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  faqQuestion: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  faqAnswer: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  formBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  primaryButton: {
    marginTop: 16,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});