import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography } from '../styles/commonStyles';
import { useTheme } from '../styles/ThemeContext';

export default function SettingsDrawer({ navigation }) {
  const { isDark, toggleTheme, colors } = useTheme();

  return (
    <View style={[styles.container, isDark && styles.containerDark, { backgroundColor: colors.background }]}> 
      <View style={[styles.header, { borderBottomColor: colors.lightGray }]}> 
        <Ionicons name="menu-outline" size={24} color={colors.text} />
        <Text style={[styles.headerText, { color: colors.text }]}>Menu</Text>
      </View>

      <TouchableOpacity style={[styles.item, { borderBottomColor: colors.lightGray }] }>
        <View style={styles.itemContent}>
          <Ionicons name="person-outline" size={24} color={colors.text} />
          <Text style={[styles.text, { color: colors.text }]}>Account</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.item, { borderBottomColor: colors.lightGray }] }>
        <View style={styles.itemContent}>
          <Ionicons name="notifications-outline" size={24} color={colors.text} />
          <Text style={[styles.text, { color: colors.text }]}>Notifications</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.item, { borderBottomColor: colors.lightGray }] }>
        <View style={styles.itemContent}>
          <Ionicons name="lock-closed-outline" size={24} color={colors.text} />
          <Text style={[styles.text, { color: colors.text }]}>Privacy</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.item, { borderBottomColor: colors.lightGray }] }>
        <View style={styles.itemContent}>
          <Ionicons name="help-circle-outline" size={24} color={colors.text} />
          <Text style={[styles.text, { color: colors.text }]}>Help & Support</Text>
        </View>
      </TouchableOpacity>

      <View style={[styles.item, { borderBottomColor: colors.lightGray }] }>
        <View style={styles.itemContent}>
          <Ionicons name="moon-outline" size={24} color={colors.text} />
          <Text style={[styles.text, { color: colors.text }]}>Dark Mode</Text>
          <Switch
            style={styles.switch}
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: '#767577', true: colors.primary }}
            thumbColor={isDark ? colors.surface : '#f4f3f4'}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.item, styles.closeButton]}
        onPress={() => navigation.closeDrawer()}
      >
        <View style={styles.itemContent}>
          <Ionicons name="close-circle-outline" size={24} color={colors.primary} />
          <Text style={[styles.text, { color: colors.primary }]}>Close</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  containerDark: {
    // dark variant handled via inline backgroundColor from theme
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
    paddingBottom: 15,
    borderBottomWidth: 1,
  },
  headerText: {
    ...typography.header,
    marginLeft: 10,
  },
  item: {
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    ...typography.body,
    marginLeft: 15,
    flex: 1,
  },
  textDark: {
    // dark text override handled inline
  },
  switch: {
    marginLeft: 'auto',
  },
  closeButton: {
    marginTop: 30,
    borderBottomWidth: 0,
  },
});
