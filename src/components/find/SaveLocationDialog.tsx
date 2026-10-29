import { useEffect, useId, useState } from 'react';
import { Dialog } from '../Dialog';
import { useServices } from '../../services/ServicesContext';
import { useAnnouncer } from '../../hooks/useAnnouncer';
import { locationMemoryText, normalizeItem } from '../../services/find/objectSearch';

interface SaveLocationDialogProps {
  open: boolean;
  item: string;
  /** Pre-filled place, which the user can change before saving. */
  initialLocation: string;
  onClose: () => void;
  onSaved?: () => void;
}

/** Saves an item location only after the user confirms it. */
export function SaveLocationDialog({ open, item, initialLocation, onClose, onSaved }: SaveLocationDialogProps) {
  const { memory } = useServices();
  const { announce } = useAnnouncer();
  const fieldId = useId();
  const [location, setLocation] = useState(initialLocation);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLocation(initialLocation);
      setError(null);
    }
  }, [open, initialLocation]);

  const save = async () => {
    if (!location.trim()) {
      setError('Describe where the item is.');
      return;
    }
    setSaving(true);
    try {
      await memory.create({
        text: locationMemoryText(item, location),
        category: 'object-location',
        subject: normalizeItem(item).toLowerCase(),
      });
      announce('Saved. You can review it in My Memories.');
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The location could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Remember this location?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
            Save location
          </button>
        </>
      }
    >
      <p>
        OpenEyes will save where {normalizeItem(item).toLowerCase() || 'the item'} is on this device only. It will always
        tell you this is something you saved, not what the camera sees now.
      </p>
      <label htmlFor={fieldId} className="label mt-4">
        Location
      </label>
      <input
        id={fieldId}
        className="field text-lg"
        value={location}
        maxLength={200}
        onChange={(e) => setLocation(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : undefined}
      />
      {error && (
        <p id={`${fieldId}-error`} role="alert" className="mt-2 font-bold text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
