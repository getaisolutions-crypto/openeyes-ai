import type { DeviceInfo, DeviceProvider, DeviceState } from '../../types/devices';

type MediaKind = 'videoinput' | 'audioinput';

async function queryPermission(name: 'camera' | 'microphone'): Promise<PermissionState | undefined> {
  try {
    if (!navigator.permissions?.query) return undefined;
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return undefined;
  }
}

async function hasMediaInput(kind: MediaKind): Promise<boolean | undefined> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === kind);
  } catch {
    return undefined;
  }
}

async function resolveState(kind: MediaKind, permission: 'camera' | 'microphone'): Promise<{ state: DeviceState; detail: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { state: 'unavailable', detail: 'This browser does not support access to this device.' };
  }
  const [present, permissionState] = await Promise.all([hasMediaInput(kind), queryPermission(permission)]);
  if (present === false) return { state: 'unavailable', detail: 'No device of this type was found.' };
  if (permissionState === 'denied') {
    return { state: 'permission-denied', detail: 'Access is blocked. You can allow it in your browser or phone settings.' };
  }
  if (permissionState === 'granted') return { state: 'available', detail: 'Ready. Access already allowed.' };
  return { state: 'available', detail: 'Ready. OpenEyes will ask for permission the first time you use it.' };
}

export function createPhoneCameraDevice(): DeviceProvider {
  return {
    kind: 'phone-camera',
    async getInfo(): Promise<DeviceInfo> {
      const { state, detail } = await resolveState('videoinput', 'camera');
      return { kind: 'phone-camera', label: 'Phone Camera', state, detail, capabilities: ['camera'] };
    },
  };
}

export function createPhoneMicrophoneDevice(): DeviceProvider {
  return {
    kind: 'phone-microphone',
    async getInfo(): Promise<DeviceInfo> {
      const { state, detail } = await resolveState('audioinput', 'microphone');
      return { kind: 'phone-microphone', label: 'Phone Microphone', state, detail, capabilities: ['microphone'] };
    },
  };
}
