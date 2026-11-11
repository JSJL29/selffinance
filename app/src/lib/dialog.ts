import { Alert, AlertButton, AlertOptions, Platform } from 'react-native';

/**
 * Comme Alert.alert, mais fonctionne aussi dans la version web
 * (react-native-web ne sait pas afficher Alert.alert : on passe par alert / confirm du navigateur).
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons, options);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  const actions = (buttons ?? []).filter((b) => b.style !== 'cancel');
  const cancel = (buttons ?? []).find((b) => b.style === 'cancel');
  if (actions.length === 0) {
    window.alert(text);
    return;
  }
  if (window.confirm(text)) actions[0].onPress?.();
  else {
    cancel?.onPress?.();
    options?.onDismiss?.();
  }
}
