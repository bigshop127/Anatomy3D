import {termKey} from './names.ts';
import type {Atlas,SystemId} from './anatomy';
/** Structures the source packaging put in the wrong system (these muscles were drawn as bone or connective tissue). */
const FIXES:Record<string,SystemId>={
 'fibularis brevis':'muscular','fibularis longus':'muscular','fibularis tertius':'muscular',
 'tibialis anterior':'muscular','tibialis posterior':'muscular',
 'subscapularis':'muscular','levator scapulae':'muscular','tensor fasciae latae':'muscular',
};
export function fixSystems(atlas:Atlas){let fixed=0;for(const p of atlas.parts){const system=FIXES[termKey(p.name)];if(system&&p.system!==system){p.system=system;fixed++;}}return fixed;}
