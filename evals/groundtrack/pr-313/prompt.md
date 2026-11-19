---
max_turns: 60
allowed_tools: [Read, Glob, Grep, Write, Bash, Skill]
---

/groundtrack

Here is PR #313 of a 3D bookcase site, "the woodwork sheet is a menu". The files it changes are packages/site/src/shelf/woodwork.ts, packages/site/src/shelf/scene.ts, packages/site/public/wood/sapele-diff-512.jpg (new), gates/one-sheet.test.ts (new), gates/sheet-size.test.ts, gates/woodwork-readback.test.ts (new), packages/site/src/shelf/woodwork.test.ts (new), packages/site/src/shelf/debug-panel.ts, packages/site/src/shelf/shelf-settings.ts, packages/site/src/shelf/shelf-url.test.ts, gates/repo-hygiene.test.ts, docs/adr/0081-the-woodwork-sheet-is-a-menu-and-the-shelf-says-what-it-resolved.md, docs/adr/README.md, docs/gate-register.md, docs/gates.md, docs/log/2026-08-30-the-species-menu-and-the-read-back.md and docs/progress.md. The description and the changed source follow. Draw the graph for the entry point `buildShelf` (first paint) only, validate it, and render the page to the scratch folder.

## PR #313: the woodwork sheet is a menu

Before this PR the shelf bound one hard-coded woodwork sheet and the fibre was laid by a module-level default constant. Now the woodwork is a roster: `rosewood`, `sapele` and `flat`. The species is a new settings key, `materials.woodSpecies`, set from the debug panel or from `?tune=materials.woodSpecies=sapele`. It is the first string-valued key in the settings record.

The point of the change is that the species is resolved in one place (`resolveWoodwork`), and an entry nobody selects is never fetched. The sheet is bound where the material is made (`buildShelf`), so a roster of any size costs a default page exactly one woodwork sheet.

What else changed:

- `sapele-diff-512.jpg` is the second roster entry, and the first committed sheet a default page never fetches.
- `flat` binds no map at all. It is laid by the default sheet's world-unit period, which is what makes it a control and not a fourth look.
- A species that is not on the roster (a typo in `?tune=`) is not dropped at parse. It resolves to the default and carries a `refused` message, so the report says what happened. A dropped value looks exactly like a value that was applied.
- The fibre texture is now laid by the same sheet as the figure (`lay.unitsPerTile / 0.5` tiles). Laid by the default constant it was 4.8x wrong under sapele, with every whole-frame number still in the normal range. This is #297's crossed-fibre defect, one surface over.
- A sheet that fails to load is warned about, not thrown, because a sheet that never arrives looks like a sheet that was never bound.
- `applySettings` gains a fifth report list, `resolved`. The other four (applied, needsRebuild, needsReload, refused) are transitions, and a transition cannot describe a configuration that was wrong from the first frame. `resolved` states what is running on every apply, whether or not anything moved. A species change is rebuild-class: `worldSpaceUvs` overwrites the UVs in place, so re-laying needs new geometry.
- The backboard keeps its own sheet. It is a constant, not a knob: #297 measured all 41 veneers and the darkness constraint leaves one.

### Texture requests on the wire (what a page fetches for the woodwork)

| Page | Woodwork sheet | Backboard sheet | Notes |
| --- | --- | --- | --- |
| default (no `?tune=`) | `/wood/rosewood-diff-1024.jpg` | `/wood/darkwood-diff-512.jpg` | two requests |
| `?tune=materials.woodSpecies=sapele` | `/wood/sapele-diff-512.jpg` | `/wood/darkwood-diff-512.jpg` | fibre re-laid at 1.6 world units |
| `?tune=materials.woodSpecies=flat` | none | `/wood/darkwood-diff-512.jpg` | one request |
| `?tune=materials.woodSpecies=walnut` | `/wood/rosewood-diff-1024.jpg` | `/wood/darkwood-diff-512.jpg` | refused, shows the default |

Rosewood tiles at 7.68 world units, sapele at 1.6, the backboard at 2.4.

### Gates

- G52 (sheet size) is widened from `SHIPPED_SHEETS` to `ALL_SHEETS`: the two are now different sets.
- G53 (new): a default page resolves to exactly one woodwork sheet.
- G54 (new): the read-back is asserted on `describeWoodwork`, which sits in a module with no Three.js in it, so it needs no WebGL context. The first draft matched the species by bare substring and was green on a read-back naming no species at all, because `rosewood` and `sapele` each appear inside their own URL. Anchoring to `woodwork sheet: <name> (` reddened six clauses.
- G13 (repo hygiene) gains sapele's sheet by filename.

Not covered by vitest: `fibreMapFor` has no seam and no spec reaches it. Only `smoke:render` does, in a real browser with nothing substituted.

## Changed source

### packages/site/src/shelf/woodwork.ts

```ts
import * as THREE from 'three';

export type Species = 'rosewood' | 'sapele' | 'flat';

export interface Sheet {
  url: string;
  unitsPerTile: number; // world units one repeat of the sheet covers
}

export interface ResolvedWoodwork {
  species: string;
  sheet: Sheet | null; // null means no map is bound
  lay: Sheet;          // the sheet that sets the UV period and the fibre period
  refused: string | null;
}

export interface SheetBinding {
  url: string;
  bound: boolean;
}

export interface WoodworkReadBack {
  resolved: string[];
  refused: string[];
}

export const WOODWORK_ROSTER: readonly string[] = ['rosewood', 'sapele', 'flat'];
export const DEFAULT_SPECIES = 'rosewood';

// `flat` is on the roster and deliberately has no entry here.
export const WOODWORK_SHEETS: Record<string, Sheet> = {
  rosewood: { url: '/wood/rosewood-diff-1024.jpg', unitsPerTile: 7.68 },
  sapele: { url: '/wood/sapele-diff-512.jpg', unitsPerTile: 1.6 },
};

export const BACKBOARD_SHEET: Sheet = {
  url: '/wood/darkwood-diff-512.jpg',
  unitsPerTile: 2.4,
};

// woodwork.ts:432
export function resolveWoodwork(requested: string): ResolvedWoodwork {
  // The error list is empty on purpose. A bad species is a value this returns, not a throw.
  // A find over the roster, not `requested in WOODWORK_SHEETS`: an object lookup answers true for toString.
  const species = WOODWORK_ROSTER.find((n) => n === requested) ?? null;
  if (species === null) {
    // Refused in the report, never dropped at parse: a dropped value looks exactly like a value that was applied.
    return {
      species: DEFAULT_SPECIES,
      sheet: WOODWORK_SHEETS[DEFAULT_SPECIES],
      lay: WOODWORK_SHEETS[DEFAULT_SPECIES],
      refused:
        'woodwork sheet: "' + requested + '" is not a sheet anybody has rendered, so the woodwork is showing ' +
        DEFAULT_SPECIES + '. The roster is ' + WOODWORK_ROSTER.join(', '),
    };
  }
  const sheet = WOODWORK_SHEETS[species] ?? null;
  // flat is laid by the DEFAULT sheet: that is what makes it a control rather than a fourth look.
  return { species, sheet, lay: sheet ?? WOODWORK_SHEETS[DEFAULT_SPECIES], refused: null };
}

// woodwork.ts:482
export function speciesPending(built: string, wanted: string): boolean {
  // Compared AFTER resolution, never as raw strings: everything off-roster resolves to the default,
  // so walnut and rosewood name one shelf. Comparing the requests would offer a rebuild a rebuild cannot make.
  const a = resolveWoodwork(built);
  const b = resolveWoodwork(wanted);
  return a.species !== b.species;
}

// woodwork.ts:539
// Pure, and in a module with no Three.js types in its signature, so G54 can assert on it without a WebGL context.
export function describeWoodwork(
  wanted: ResolvedWoodwork,
  built: string,
  fibreInForce: number,
  fibreAsked: number,
): WoodworkReadBack {
  const sheet =
    wanted.sheet === null
      ? 'no map — the mean-matched flat twin'
      : wanted.sheet.url + ', laid at ' + wanted.lay.unitsPerTile + ' world units';
  const waiting = wanted.species === built ? '' : ' — built with ' + built + ', rebuild to change it';
  const lines = [
    'woodwork sheet: ' + wanted.species + ' (' + sheet + ')' + waiting,
    'wood fibre: ' + fibreInForce + (fibreInForce === fibreAsked ? '' : ' (asked for ' + fibreAsked + ')'),
  ];
  // refused AND reported, never silently defaulted
  return { resolved: lines, refused: wanted.refused === null ? [] : [wanted.refused] };
}

// woodwork.ts:650
// Writes each member's world-space period into the UVs of `geometry` IN PLACE. The 0..1 values are gone,
// so re-laying means new geometry: a species change is rebuild-class and there is no live path to offer.
export function worldSpaceUvs(geometry: THREE.BufferGeometry, sheet: Sheet, grain: 'x' | 'y'): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const along = grain === 'x' ? pos.getX(i) : pos.getY(i);
    const across = grain === 'x' ? pos.getY(i) : pos.getX(i);
    uv.setXY(i, along / sheet.unitsPerTile, across / sheet.unitsPerTile);
  }
  uv.needsUpdate = true;
}

// woodwork.ts:780
export function bindSheet(
  url: string,
  loader: THREE.TextureLoader = new THREE.TextureLoader(), // the seam: specs pass fakeLoader()
): SheetBinding {
  try {
    // Fetches the image over the network. A 404 or a decode failure throws SheetMissing.
    const texture = loader.load(url);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return { url, bound: true };
  } catch (err) {
    if (!(err instanceof SheetMissing)) throw err;
    // Said out loud rather than thrown, because a sheet that never arrives looks like a sheet that was
    // never bound. That absorption is why callers never see an error from here.
    console.warn(`woodwork: ${url} did not load; the surface keeps its flat colour`);
    return { url, bound: false };
  }
}

class SheetMissing extends Error {
  constructor(public url: string, cause?: unknown) {
    super(`sheet missing: ${url}`, { cause });
  }
}

// woodwork.ts:1161
// The fibre rides the SAME UVs the figure does. Laid by the module's default constant it is 4.8x wrong
// under sapele, with every whole-frame number still in the normal range. #297's crossed-fibre defect,
// one surface over. No seam, and no vitest spec reaches this: only smoke:render does.
export function fibreMapFor(lay: Sheet): THREE.CanvasTexture | null {
  const tiles = lay.unitsPerTile / 0.5;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  // Bakes the 256-square fibre: `tiles` repeats of the strand pattern across the canvas.
  drawFibre(ctx, 256, tiles);
  return new THREE.CanvasTexture(canvas);
}

// woodwork.ts:1246
export function applyWoodFibre(
  scale: number,
  lay: Sheet,
  bake: (lay: Sheet) => THREE.CanvasTexture | null = fibreMapFor, // specs pass () => fibre
): number {
  const map = bake(lay);
  if (map === null) {
    // no 2D context: reported as refused, never silently smooth
    return 0;
  }
  woodMaterial.bumpMap = map;
  woodMaterial.bumpScale = scale;
  // returns the scale IN FORCE, so no call site can report the one that was asked for
  return scale;
}
```

Signatures of the unchanged helpers these call (bodies not in this PR):

```ts
declare function drawFibre(ctx: CanvasRenderingContext2D, size: number, tiles: number): void;
declare const woodMaterial: THREE.MeshStandardMaterial; // the shared shelf wood material
```

### packages/site/src/shelf/scene.ts

```ts
import * as THREE from 'three';
import {
  resolveWoodwork, worldSpaceUvs, bindSheet, applyWoodFibre,
  speciesPending, describeWoodwork, BACKBOARD_SHEET,
  type Sheet, type SheetBinding,
} from './woodwork';
import type { ShelfSettings } from './shelf-settings';

export interface Woodwork {
  species: string;
  fibre: number;
  refused: string | null;
}

export interface Built {
  species: string;
  lay: Sheet;
  fibre: number;
}

export interface ApplyReport {
  applied: string[];
  needsRebuild: string[];
  needsReload: string[];
  refused: string[];
  resolved: string[]; // a statement of what is running, not a transition
}

// scene.ts:1625
// Called once per member while the shelf is assembled. Re-lays the member's UVs in world units.
function buildMember(member: Member, lay: Sheet): THREE.Mesh {
  worldSpaceUvs(member.geometry, lay, member.grain);
  return new THREE.Mesh(member.geometry, woodMaterial);
}

// scene.ts:1664
export function buildShelf(rowCount: number, settings: ShelfSettings): Woodwork {
  // The sheet is bound where the material is made, so a roster of any size costs a default page one sheet.
  const resolved = resolveWoodwork(settings.materials.woodSpecies);

  for (const member of membersFor(rowCount)) {
    shelfGroup.add(buildMember(member, resolved.lay));
  }

  if (resolved.sheet !== null) {
    const sheet: SheetBinding = bindSheet(resolved.sheet.url);
    woodMaterial.userData.sheet = sheet;
  }
  // else: flat binds no map at all, so nothing goes on the wire for the woodwork.

  const fibreInForce = applyWoodFibre(settings.materials.woodFibre, resolved.lay);

  // a constant, not a knob: #297 measured all 41 veneers and the darkness constraint leaves one
  const backSheet: SheetBinding = bindSheet(BACKBOARD_SHEET.url);
  backboardMaterial.userData.sheet = backSheet;

  return { species: resolved.species, fibre: fibreInForce, refused: resolved.refused };
}

// scene.ts:2225
// Only the woodwork slice of applySettings is shown.
export function applySettings(
  mountedWith: ShelfSettings,
  current: ShelfSettings,
  next: ShelfSettings,
  built: Built,
): ApplyReport {
  // Five report lists. applied / needsRebuild / needsReload / refused are transitions; resolved is a statement.
  let applied: string[] = [];
  let needsRebuild: string[] = [];
  let refused: string[] = [];
  let fibreInForce: number;

  if (current.materials.woodFibre !== next.materials.woodFibre) {
    // laid by the sheet the shelf was BUILT with, not by the module's default constant
    fibreInForce = applyWoodFibre(next.materials.woodFibre, built.lay);
    if (fibreInForce === next.materials.woodFibre) {
      applied = applied.concat(
        'wood fibre: ' + current.materials.woodFibre + ' → ' + fibreInForce,
      );
    } else {
      refused = refused.concat('wood fibre: there is no canvas to draw it on, so the woodwork stays smooth');
    }
  } else {
    // not applied and not asked for, but still reported, so a fibre that never bound says so on every
    // apply after the one that discovered it
    fibreInForce = built.fibre;
  }

  const pending = speciesPending(
    mountedWith.materials.woodSpecies,
    next.materials.woodSpecies,
  );
  if (pending) {
    needsRebuild = needsRebuild.concat(
      'woodwork sheet: ' + built.species + ' → ' + next.materials.woodSpecies,
    );
  }

  // resolved from `next`, NOT read off woodwork.resolved: the two differ exactly when a species change is
  // waiting for a rebuild, and a typo has to reach the report when the value is set, not one rebuild later
  const wanted = resolveWoodwork(next.materials.woodSpecies);
  const readBack = describeWoodwork(wanted, built.species, fibreInForce, next.materials.woodFibre);

  return {
    applied,
    needsRebuild,
    needsReload: [],
    refused: refused.concat(readBack.refused),
    resolved: readBack.resolved,
  };
}
```

Unchanged helpers scene.ts calls, as signatures only:

```ts
declare function membersFor(rowCount: number): Member[];
declare const shelfGroup: THREE.Group;
declare const woodMaterial: THREE.MeshStandardMaterial;
declare const backboardMaterial: THREE.MeshStandardMaterial;
interface Member { geometry: THREE.BufferGeometry; grain: 'x' | 'y' }
```

### packages/site/src/shelf/shelf-settings.ts

```ts
export interface ShelfSettings {
  materials: {
    woodSpecies: string; // new: the first string-valued key in this record
    woodFibre: number;
  };
  // ...the other numeric groups are unchanged
}

export const DEFAULTS: ShelfSettings = {
  materials: { woodSpecies: 'rosewood', woodFibre: 0.5 },
};
```

### gates/one-sheet.test.ts (excerpt)

```ts
import { describe, it, expect } from 'vitest';
import { resolveWoodwork, bindSheet, WOODWORK_ROSTER, WOODWORK_SHEETS } from '../packages/site/src/shelf/woodwork';
import { fakeLoader } from './helpers/fake-loader';

// G53: a default page resolves to exactly one woodwork sheet.
describe('G53 one woodwork sheet on a default page', () => {
  it('resolves the default species to the rosewood sheet and nothing else', () => {
    const r = resolveWoodwork('rosewood');
    expect(r.sheet?.url).toBe('/wood/rosewood-diff-1024.jpg');
    expect(r.refused).toBeNull();
  });

  it('never asks for a roster entry nobody selected', () => {
    const loader = fakeLoader();
    const r = resolveWoodwork('rosewood');
    if (r.sheet !== null) bindSheet(r.sheet.url, loader);
    expect(loader.requested).toEqual(['/wood/rosewood-diff-1024.jpg']);
    for (const name of WOODWORK_ROSTER) {
      const other = WOODWORK_SHEETS[name];
      if (other && name !== 'rosewood') expect(loader.requested).not.toContain(other.url);
    }
  });
});
```

### gates/woodwork-readback.test.ts (excerpt)

```ts
import { describeWoodwork, resolveWoodwork } from '../packages/site/src/shelf/woodwork';

// G54: the read-back names the species. Anchored to `woodwork sheet: <name> (`, because bare substrings
// match inside the URLs.
it('names sapele, and says the shelf was built with rosewood', () => {
  const rb = describeWoodwork(resolveWoodwork('sapele'), 'rosewood', 0.5, 0.5);
  expect(rb.resolved[0]).toMatch(/^woodwork sheet: sapele \(/);
  expect(rb.resolved[0]).toContain('built with rosewood, rebuild to change it');
  expect(rb.refused).toEqual([]);
});

it('refuses a typo and reports it', () => {
  const rb = describeWoodwork(resolveWoodwork('walnut'), 'rosewood', 0.5, 0.5);
  expect(rb.refused[0]).toContain('"walnut" is not a sheet anybody has rendered');
  expect(rb.resolved[0]).toMatch(/^woodwork sheet: rosewood \(/);
});
```

### gates/sheet-size.test.ts (the widened part)

```ts
// G52: was SHIPPED_SHEETS. The two sets differ now: ALL_SHEETS includes the sheets a default page never fetches.
const ALL_SHEETS = [
  ...Object.values(WOODWORK_SHEETS).map((s) => s.url),
  BACKBOARD_SHEET.url,
];
it.each(ALL_SHEETS)('%s stays under the size budget', (url) => {
  expect(statSync('packages/site/public' + url).size).toBeLessThanOrEqual(SHEET_BUDGET_BYTES);
});
```

### Test doubles used in woodwork.test.ts

```ts
// woodwork.test.ts:483
const loader = fakeLoader();            // stands in for THREE.TextureLoader
expect(bindSheet('/wood/sapele-diff-512.jpg', loader)).toEqual({ url: '/wood/sapele-diff-512.jpg', bound: true });

// woodwork.test.ts:827
const fibre = new FakeCanvasTexture();
expect(applyWoodFibre(0.5, WOODWORK_SHEETS.sapele, () => fibre)).toBe(0.5); // stands in for CanvasTexture
```
