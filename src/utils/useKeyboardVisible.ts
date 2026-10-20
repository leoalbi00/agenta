import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Keyboards are at least this tall; smaller viewport changes are browser toolbars */
const MIN_KEYBOARD_HEIGHT = 150;

/** True while the on-screen keyboard is open (on the web: while it shrinks the visual viewport). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
      if (!viewport) return;
      const update = () => setVisible(window.innerHeight - viewport.height > MIN_KEYBOARD_HEIGHT);
      viewport.addEventListener('resize', update);
      return () => viewport.removeEventListener('resize', update);
    }
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}
