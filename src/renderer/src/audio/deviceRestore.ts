// Przywracanie zapisanych urzadzen audio do silnika (start aplikacji, spike,
// soundcheck). Zapisany deviceId potrafi sie zmienic miedzy uruchomieniami —
// dopasowanie przez resolveDevice (id -> label+groupId -> label), best-effort.
import type { SettingsDto } from '../../../shared/ipc';
import type { AudioEngine } from './audioEngine';
import { resolveDevice, type AudioDeviceInfo, type SavedDevice } from './deviceRegistry';

type OutputEngine = Pick<AudioEngine, 'getOutputContext' | 'getOutputSinkId' | 'startOutput'>;
type RestoreEngine = Pick<AudioEngine, 'getInputStream' | 'startInput'> & OutputEngine;

/**
 * Gwarantuje dzialajacy tor wyjsciowy przed spike/soundcheck — bez sesji.
 * Gdy zapisany glosnik zniknal albo odmawia startu, gra na domyslnym wyjsciu
 * systemowym (dla pomiaru latencji to wystarczy). Kontekst wpiety na sink,
 * ktory zniknal z systemu (odpiety glosnik PA), gra "w prozni" — wykrywamy to
 * i restartujemy tor; zawieszony kontekst dobudzamy zamiast restartowac.
 */
export async function ensureOutputStarted(
  engine: OutputEngine,
  devices: AudioDeviceInfo[],
  saved: SavedDevice,
  gain: number,
): Promise<void> {
  const ctx = engine.getOutputContext();
  if (ctx) {
    const sinkId = engine.getOutputSinkId();
    const sinkPresent =
      sinkId === null || devices.some((d) => d.kind === 'audiooutput' && d.deviceId === sinkId);
    if (sinkPresent) {
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
      return;
    }
    // sink zniknal — leci restart nizej (zapisany glosnik albo domyslny)
  }
  const resolved = resolveDevice(devices, 'audiooutput', saved);
  try {
    await engine.startOutput(resolved?.deviceId ?? null, gain);
  } catch {
    await engine.startOutput(null, gain); // fallback: domyslne wyjscie systemowe
  }
}

/**
 * Przywraca zapisane urzadzenia do silnika przy starcie aplikacji — bez tego
 * dropdowny pokazuja urzadzenia z ustawien, a tor audio jest martwy (ton
 * testowy / soundcheck / spike koncza sie "nie uruchomione").
 * Zwraca patch ustawien: re-pin nowego deviceId po dopasowaniu po nazwie albo
 * wyczyszczenie samego id gdy start sie nie powiodl (label+groupId zostaja,
 * zeby przyszle dopasowanie po nazwie nadal dzialalo).
 */
export async function restoreSavedDevices(
  engine: RestoreEngine,
  devices: AudioDeviceInfo[],
  settings: SettingsDto,
): Promise<Partial<SettingsDto>> {
  const patch: Partial<SettingsDto> = {};

  if (settings.inputDeviceId && !engine.getInputStream()) {
    const dev = resolveDevice(devices, 'audioinput', {
      deviceId: settings.inputDeviceId,
      label: settings.inputDeviceLabel,
      groupId: settings.inputDeviceGroupId,
    });
    if (dev) {
      try {
        await engine.startInput(dev.deviceId, settings.inputGain);
        if (dev.deviceId !== settings.inputDeviceId) {
          patch.inputDeviceId = dev.deviceId;
          patch.inputDeviceGroupId = dev.groupId;
        }
      } catch {
        patch.inputDeviceId = null; // dropdown pokaze brak wyboru — stan zgodny z prawda
      }
    }
  }

  if (settings.outputDeviceId && !engine.getOutputContext()) {
    const dev = resolveDevice(devices, 'audiooutput', {
      deviceId: settings.outputDeviceId,
      label: settings.outputDeviceLabel,
      groupId: settings.outputDeviceGroupId,
    });
    if (dev) {
      try {
        await engine.startOutput(dev.deviceId, settings.outputGain);
        if (dev.deviceId !== settings.outputDeviceId) {
          patch.outputDeviceId = dev.deviceId;
          patch.outputDeviceGroupId = dev.groupId;
        }
      } catch {
        patch.outputDeviceId = null; // dropdown pokaze brak wyboru — stan zgodny z prawda
      }
    }
  }

  return patch;
}
