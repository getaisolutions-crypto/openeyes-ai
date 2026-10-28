export type DeviceKind = 'phone-camera' | 'phone-microphone' | 'meta-glasses';

export type DeviceState =
  | 'available'
  | 'unavailable'
  | 'permission-denied'
  | 'not-connected'
  | 'connected'
  | 'checking';

export type DeviceCapability = 'camera' | 'microphone' | 'speaker';

export interface DeviceInfo {
  kind: DeviceKind;
  label: string;
  state: DeviceState;
  capabilities: DeviceCapability[];
  detail: string;
}

export type ConnectResult =
  | { ok: true; info: DeviceInfo }
  | { ok: false; reason: 'native-integration-unavailable' | 'failed'; message: string };

export interface DeviceProvider {
  readonly kind: DeviceKind;
  getInfo(): Promise<DeviceInfo>;
  connect?(): Promise<ConnectResult>;
}
