import type { ConnectResult, DeviceInfo, DeviceProvider } from '../../types/devices';

export const GLASSES_UNAVAILABLE_MESSAGE =
  'Meta glasses cannot be connected yet. Connecting requires the OpenEyes Android app built with the official Meta Wearables Device Access Toolkit, which is planned but not available in this version. OpenEyes works fully with your phone camera and microphone in the meantime.';

/** Always reports "Not Connected" until the native Android integration (Phase 2+) exists. */
export function createMetaGlassesDevice(): DeviceProvider {
  const info: DeviceInfo = {
    kind: 'meta-glasses',
    label: 'Meta Glasses',
    state: 'not-connected',
    capabilities: ['camera', 'microphone', 'speaker'],
    detail: 'Native integration not yet available.',
  };
  return {
    kind: 'meta-glasses',
    async getInfo() {
      return info;
    },
    async connect(): Promise<ConnectResult> {
      return { ok: false, reason: 'native-integration-unavailable', message: GLASSES_UNAVAILABLE_MESSAGE };
    },
  };
}
