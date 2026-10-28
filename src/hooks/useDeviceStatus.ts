import { useCallback, useEffect, useState } from 'react';
import type { DeviceInfo } from '../types/devices';
import { useServices } from '../services/ServicesContext';

export interface DeviceStatusMap {
  phoneCamera: DeviceInfo | null;
  phoneMicrophone: DeviceInfo | null;
  metaGlasses: DeviceInfo | null;
}

export function useDeviceStatus() {
  const { devices } = useServices();
  const [status, setStatus] = useState<DeviceStatusMap>({ phoneCamera: null, phoneMicrophone: null, metaGlasses: null });

  const refresh = useCallback(async () => {
    const [phoneCamera, phoneMicrophone, metaGlasses] = await Promise.all([
      devices.phoneCamera.getInfo(),
      devices.phoneMicrophone.getInfo(),
      devices.metaGlasses.getInfo(),
    ]);
    setStatus({ phoneCamera, phoneMicrophone, metaGlasses });
  }, [devices]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, refresh };
}
