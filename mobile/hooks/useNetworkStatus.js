/**
 * hooks/useNetworkStatus.js
 *
 * Thin React hook wrapper around @react-native-community/netinfo for
 * components that want to render based on connectivity (e.g. disabling
 * the sync button, showing an offline banner). SyncService itself doesn't
 * use this hook — it receives NetInfo directly via startAutoSync() so it
 * can run outside any component — this hook is purely for UI.
 */

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * @returns {{
 *   isConnected: boolean,
 *   isInternetReachable: boolean,
 *   isWifi: boolean,
 *   type: string,
 * }}
 */
export function useNetworkStatus() {
  const [state, setState] = useState({
    isConnected: true, // optimistic default until the first NetInfo event arrives
    isInternetReachable: true,
    isWifi: false,
    type: 'unknown',
  });

  useEffect(() => {
    const applyNetInfoState = (netInfoState) => {
      setState({
        isConnected: Boolean(netInfoState.isConnected),
        // isInternetReachable can be null while NetInfo is still
        // determining it — treat "not yet known" as reachable rather
        // than flashing an incorrect "offline" state on every screen load.
        isInternetReachable: netInfoState.isInternetReachable !== false,
        isWifi: netInfoState.type === 'wifi',
        type: netInfoState.type,
      });
    };

    NetInfo.fetch().then(applyNetInfoState);
    const unsubscribe = NetInfo.addEventListener(applyNetInfoState);

    return () => unsubscribe();
  }, []);

  return state;
}
