import {termKey} from './names.ts';
import type {Atlas,SystemId} from './anatomy';
/** Structures the source packaging put in the wrong system (these muscles were drawn as bone or connective tissue,
 * the heart's papillary muscles as skeletal muscle, and two fibrous bands as bone or sense organ). */
const FIXES:Record<string,SystemId>={
 'fibularis brevis':'muscular','fibularis longus':'muscular','fibularis tertius':'muscular',
 'tibialis anterior':'muscular','tibialis posterior':'muscular',
 'subscapularis':'muscular','levator scapulae':'muscular','tensor fasciae latae':'muscular',
 'anterior papillary muscle of ventricle':'cardiac','posterior papillary muscle of ventricle':'cardiac','septal papillary muscle of ventricle':'cardiac',
 'lateral papillary muscle of ventricle':'cardiac','anterolateral head of lateral papillary muscle of ventricle':'cardiac',
 'iliotibial tract':'connective','flexor retinaculum of wrist':'connective',
};
export function fixSystems(atlas:Atlas){let fixed=0;for(const p of atlas.parts){const system=FIXES[termKey(p.name)];if(system&&p.system!==system){p.system=system;fixed++;}}return fixed;}
