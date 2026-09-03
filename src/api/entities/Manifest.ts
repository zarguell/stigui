import Checklist from '@/api/entities/Checklist';
import Stig, { StigWrapper } from '@/api/entities/Stig';
import {
    Convert,
    Profile as IProfile,
    Stig as IStig,
} from '@/api/generated/Stig';
import type { LibraryStig } from '@/api/entities/upload';
import { API_BASE } from '@/api/entities/api';

interface IManifest {
    id: string;
    title: string;
    description: string;
    version: string;
    date: string;
}

export class ManifestStore {
    private manifest: IManifest[] = [];
    private _byId: Record<string, IManifest> = {};

    constructor(manifest: IManifest[]) {
        this.manifest = manifest;
        this._byId = manifest.reduce((acc, element) => {
            acc[element.id] = element;
            return acc;
        }, {} as Record<string, IManifest>);
    }

    get elements() {
        return this.manifest;
    }

    byId(stigId: string) {
        const record = this._byId[stigId];
        if (!record) {
            throw new Error(`Stig ${stigId} not found`);
        }
        return record;
    }

    /** Like byId, but undefined for STIGs that aren't in the static
     * manifest (e.g. imported ones). */
    maybeById(stigId: string) {
        return this._byId[stigId];
    }

    async getStig(stigId: string) {
        const uploaded = await getUploaded(stigId);
        if (uploaded) {
            return new StigWrapper(Convert.toStig(uploaded.benchmark));
        }
        return await Stig.read(`${stigId}.json`);
    }

    async getRule(stigId: string, ruleId: string) {
        const stig = await this.getStig(stigId);
        return stig?.groups.find((group) => {
            return group.rule.id === ruleId;
        });
    }
    async getGroup(stigId: string, groupId: string) {
        const stig = await this.getStig(stigId);
        return stig?.groups.find((group) => {
            return group.id === groupId;
        });
    }

    async toChecklist(stig: IStig, profiles: IProfile[]) {
        return Checklist.fromStig(stig, profiles);
    }
}

let manifestPromise = fetch(
    `${API_BASE}/data/stigs/manifest.json?${process.env.NEXT_PUBLIC_MANIFEST_VERSION}`
)
    .then((r) => r.json())
    .catch((error) => {
        // A missing or unreachable manifest must never take the whole
        // client down; imported STIGs keep working regardless.
        console.error('Failed to load STIG manifest', error);
        return [];
    });
let cache: ManifestStore | null = null;

/**
 * Look up an imported STIG in the browser-side library, if we're in a
 * browser at all. Resolves to undefined when the STIG isn't imported.
 */
export async function getUploaded(
    stigId: string
): Promise<LibraryStig | undefined> {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const { IDB } = await import('@/app/db');
    return await IDB.library.get(stigId);
}

/** Manifest-style metadata for every STIG in the imported library. */
export async function uploadedElements(): Promise<IManifest[]> {
    if (typeof window === 'undefined') {
        return [];
    }
    const { IDB } = await import('@/app/db');
    const entries = await IDB.library.getAll();
    return entries.map((entry) => ({
        id: entry.stig_id,
        title: entry.title,
        description: entry.description,
        version: entry.version,
        date: entry.date,
    }));
}

export class Manifest {
    static async init() {
        if (cache) {
            return cache;
        }
        cache = new ManifestStore((await manifestPromise) as IManifest[]);
        return cache;
    }
}
