import type { DeviceInfo } from '../../types/devices';

/**
 * Contract a future native Android shell (Kotlin + official Meta Wearables Device Access Toolkit)
 * is expected to expose to this web UI. Nothing implements it in Phase 1.
 */
export interface NativeGlassesBridge {
  isAvailable(): Promise<boolean>;
  connect(): Promise<DeviceInfo>;
  disconnect(): Promise<void>;
  getInfo(): Promise<DeviceInfo>;
  /** Requests a single still frame from the glasses camera, returned as JPEG bytes. */
  captureFrame(): Promise<Blob>;
}
