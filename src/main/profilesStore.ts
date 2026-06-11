// Biblioteka profili mowcow: nazwa + voice_id (ElevenLabs IVC) + notatka zgody (RODO).
// Plik: userData/profiles.json (bez sekretow — voice_id nie jest sekretem).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProfileDto } from '../shared/ipc';

export class ProfilesStore {
  private readonly filePath: string;
  private profiles: ProfileDto[];

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, 'profiles.json');
    this.profiles = this.load();
  }

  private load(): ProfileDto[] {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(raw) ? (raw as ProfileDto[]) : [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.profiles, null, 2), 'utf8');
  }

  list(): ProfileDto[] {
    return [...this.profiles];
  }

  save(profile: ProfileDto): ProfileDto[] {
    const idx = this.profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      this.profiles[idx] = profile;
    } else {
      this.profiles.push(profile);
    }
    this.persist();
    return this.list();
  }

  delete(id: string): ProfileDto[] {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    this.persist();
    return this.list();
  }
}
