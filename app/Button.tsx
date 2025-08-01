import React from 'react';
import { GestureResponderEvent, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

type ButtonProps = {
  title: string;
  onPress: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  buttonColor?: string;
  disabled?: boolean;
};

const Button: React.FC<ButtonProps> = ({ title, onPress, style, buttonColor = '#F7EA48', disabled = false }) => (
  <TouchableOpacity
    style={[styles.container, style]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.7}>
    <View
      style={{
        ...styles.wrapper,
        backgroundColor: buttonColor,
        opacity: disabled ? 0.5 : 1,
      }}>
      <Text style={styles.text}>{title}</Text>
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    height: 50,
    width: '90%',
    backgroundColor: '#F7EA48',
    borderRadius: 20,
    marginVertical: 10,
  },
  wrapper: {
    flex: 1,
    width: '95%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  text: {
    color: '#000000',
    alignSelf: 'center',
    fontSize: 16,
    padding: 11,
    fontWeight: 'bold',
  },
});

export { Button };
