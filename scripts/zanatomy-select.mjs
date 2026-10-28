// Chooses the Z-Anatomy structures the app takes in, names them the BodyParts3D way and writes scripts/zanatomy-parts.json,
// which scripts/blender/export.py exports and scripts/build-atlas.mjs merges into the atlas.
// A structure is taken when the atlas has nothing of that name: names are compared first (Z-Anatomy's muscles were reshaped by
// an illustrator, so shape alone mistakes the gluteus maximus and others for new), then the synonym and coverage lists below,
// and finally anything the shape test still finds in the atlas is reported for a look.
// Usage: node scripts/zanatomy-select.mjs   (reads work/zanatomy/candidates.json from scripts/blender/classify.py)
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {loadAtlas,root} from './lib/atlas-geometry.mjs';

const candidates=JSON.parse(await readFile(new URL('work/zanatomy/candidates.json',root),'utf8'));
const atlas=await loadAtlas(),fixes=JSON.parse(await readFile(new URL('scripts/source-fixes.json',root),'utf8'));
const removed=new Set(fixes.remove.map(r=>r.id));

// Z-Anatomy names carry the side as .l/.r; a name in brackets is one the template keeps out of its label list.
const split=z=>{const m=z.match(/^(.*)\.(l|r)$/);return {base:(m?m[1]:z).replace(/^\((.*)\)$/,'$1'),side:m?{l:'left',r:'right'}[m[2]]:''};};
const canon=s=>s.toLowerCase().replace(/[()]/g,'').replace(/\b(left|right) /g,'').replace(/\bmuscles?\b/g,'').replace(/^set of /,'').replace(/\bcolli\b/g,'cervicis').replace(/\s+/g,' ').trim();
const inAtlas=new Map();for(const p of atlas.parts)if(!removed.has(p.id)&&p.source!=='z-anatomy')inAtlas.set(canon(p.name),p.name.replace(/\b(Left|Right|left|right) /g,''));

// The same structure under another name in BodyParts3D.
const SAME={
 'External abdominal oblique muscle':'external oblique','Clavicular head of pectoralis major muscle':'clavicular part of pectoralis major',
 'Sternocostal head of pectoralis major muscle':'sternocostal part of pectoralis major','Scapular spinal part of deltoid muscle':'spinal part of deltoid',
 'Inferior gemellus muscle':'gemellus inferior','Superior gemellus muscle':'gemellus superior','Iliocostalis colli muscle':'iliocostalis cervicis',
 'Obliquus inferior capitis muscle':'obliquus capitis inferior','Obliquus superior capitis muscle':'obliquus capitis superior',
 'Rectus anterior capitis muscle':'rectus capitis anterior','Rectus lateralis capitis muscle':'rectus capitis lateralis',
 'Rectus posterior major capitis muscle':'rectus capitis posterior major','Rectus posterior minor capitis muscle':'rectus capitis posterior minor',
 'Flexor digiti minimi of foot':'flexor digiti minimi brevis of foot','Flexor digiti minimi of hand':'flexor digiti minimi brevis of hand',
 'Opponens digiti minimi muscle of foot':'opponens digiti minimi of foot','Opponens digiti minimi muscle of hand':'opponens digiti minimi of hand',
 'Quadratus plantae muscle':'flexor accessorius','Pubo-analis muscle':'puborectalis','External anal sphincter':'external anal sphincter',
 'Interspinales thoracis muscles':'interspinalis thoracis','Interspinales colli muscles':'set of interspinales cervicis',
 'Ventral parts of lateral intertransversarii lumborum muscles':'lateral lumbar intertransversarius',
 'Dorsal parts of lateral intertransversarii lumborum muscles':'lateral lumbar intertransversarius',
 'Levatores breves costarum':'set of levatores costarum breves','Levatores longi costarum':'set of levatores costarum longi',
 'Ary-epiglottic part of oblique arytenoid muscle':'aryepiglotticus','Straight part of cricothyroid muscle':'straight part of cricothyroid',
 'Lateral crico-arytenoid muscle':'lateral crico-arytenoid','Posterior crico-arytenoid muscle':'posterior crico-arytenoid',
 'Inferior pharyngeal constrictor':'inferior pharyngeal constrictor','Middle pharyngeal constrictor':'middle pharyngeal constrictor','Superior pharyngeal constrictor':'superior pharyngeal constrictor',
 'Intermediate tendon of digastric muscle':'intermediate tendon','Trochlea of superior oblique muscle':'trochlea of superior oblique',
 'Lumbrical muscles of hand':'set of lumbricals of hand','Palmar interossei muscles':'set of palmar interossei of hand','Sesamoid bones of foot':'sesamoid bone of foot',
 'Inferior nasal concha bone':'inferior nasal concha','Nasal septal cartilage':'septal nasal cartilage',
 'Optic nerve (II)':'optic nerve','Trochlear nerve (IV)':'trochlear nerve','Ophthalmic nerve':'ophthalmic nerve','Coccygeus muscle':'coccygeus',
};
// Parts of a muscle that BodyParts3D draws as one piece (or the other way round), so it is already there.
const COVERED={
 'Anterior belly of digastric muscle':'digastric','Posterior belly of digastric muscle':'digastric','Deep head of flexor pollicis brevis':'flexor pollicis brevis',
 'Humeral head of extensor carpi ulnaris':'extensor carpi ulnaris','Ulnar head of extensor carpi ulnaris':'extensor carpi ulnaris',
 'Humero-ulnar head of flexor digitorum superficialis':'flexor digitorum superficialis','Radial head of flexor digitorum superficialis':'flexor digitorum superficialis',
 'Superficial head of pronator teres':'humeral head of pronator teres','Deep head of pronator teres':'ulnar head of pronator teres',
 'Lumbrical muscles of foot':'first–fourth lumbrical of foot','Plantar interossei muscles':'first–third plantar interosseous of foot',
 'External part of thyro-arytenoid muscle':'thyro-arytenoid','Thyro-epiglottic part of thyro-arytenoid muscle':'thyro-arytenoid',
 'Spinalis colli muscle':'spinalis','Spinalis capitis muscle':'spinalis','Longus colli muscle':'longus colli (three parts)',
 'Tendon of extensor digitorum longus':'extensor digitorum longus (drawn with its tendons)',
 'Tensor fasciae latae':'tensor fasciae latae (a muscle)',
};
const SAME_PATTERN=[[/^Intervertebral disc /,'intervertebral disk of the same level'],[/^(Upper|Lower) .*(incisor|canine|premolar|molar)/,'the tooth of the same name']];
// Left out on purpose.
const OUT={
 'Triradiate cartilage':'growth cartilage of the child acetabulum; the model is an adult',
 'Common tendinous ring':'orbit (sense organs stay with BodyParts3D)','Superior tarsus':'eyelid','Inferior tarsus':'eyelid',
 'Quadrangular membrane':'larynx (viscera stay with BodyParts3D)','Cricopharyngeal ligament':'larynx',
 'Palatopharyngeus muscle':'pharynx','Stylopharyngeus muscle':'pharynx',
 'Olfactory nerve (I)':'drawn with the olfactory bulb and tract, which are brain','Vestibular nerve':'inner ear, whose model is non-commercial',
 'Incus':'middle ear, next to the non-commercial inner ear model','Malleus':'middle ear','Stapes':'middle ear',
 'Lateral process of nasal septal cartilage':'nose',
};
const OUT_PATTERN=[[/ cells of ethmoid bone$|^Sinus of /,'air sinus']];
// Attachment patches left out, by muscle or by patch.
const ATTACHMENT_OUT={
 'Long plantar ligament':'where the long plantar ligament itself attaches, not a muscle',
 'Articularis genus muscle':'neither model has the articularis genus itself',
 'Spinalis capitis muscle':'the spinalis capitis blends with the semispinalis capitis, and the card leaves it out',
 'Extensor carpi ulnaris.el':'lies on the wrist capsule and triquetrum, short of the fifth metacarpal; the insertion is worked out instead',
 'Extensor carpi ulnaris.er':'lies on the wrist capsule and triquetrum, short of the fifth metacarpal; the insertion is worked out instead',
 'Rectus abdominis muscle.el':'runs the whole length of the linea alba; the origin on the pubic crest is worked out instead',
 'Rectus abdominis muscle.er':'runs the whole length of the linea alba; the origin on the pubic crest is worked out instead',
 'Patellar ligament.ol':'apex of the patella, where the patellar ligament itself starts','Patellar ligament.or':'apex of the patella, where the patellar ligament itself starts',
 'Deep head of flexor pollicis brevis.o1l':'on the shaft of the first metacarpal, where neither head of the flexor pollicis brevis attaches',
 'Deep head of flexor pollicis brevis.o1r':'on the shaft of the first metacarpal, where neither head of the flexor pollicis brevis attaches',
};

// App names follow BodyParts3D: "Left latissimus dorsi", and for parts of a muscle "Superficial part of left masseter".
const RENAME={
 'Internal abdominal oblique muscle':'Internal oblique','Levator nasolabialis':'Levator labii superioris alaeque nasi',
 'Multifidus colli muscle':'Multifidus cervicis','Dorsal interossei muscles of foot':'Set of dorsal interossei of foot','Rotatores':'Set of rotatores',
 'Tendon sheath - abd. pollicis longus - ext. pollicis brevis':'Tendon sheath of abductor pollicis longus and extensor pollicis brevis',
 'Iliopectineal bursa':'Iliopectineal bursa','Frenula capsulae':'Retinacula of capsule of hip joint',
};
const appName=(base,side,muscle)=>{
 let n=RENAME[base]??base.replace(/^Costal cartilage of (\w+) rib$/,'$1 costal cartilage').replace(/ \(([IVX]+)\)$/,'').replace(/ \((Lateral|Medial) meniscus\)$/,(_,m)=>` of ${m.toLowerCase()} meniscus`).replace(/ muscles?$/,'').replace(/ muscle of /,' of ');
 n=n[0].toUpperCase()+n.slice(1);
 if(!side)return n;
 const m=muscle&&n.match(/^(.+? (part|head|belly) of )(.+)$/);
 return m?`${m[1]}${side} ${m[3]}`:`${side[0].toUpperCase()+side.slice(1)} ${n[0].toLowerCase()+n.slice(1)}`;
};

// Fasciae and aponeuroses wrap whole muscle groups; they get their own system, off by default, so the muscles stay visible.
const FASCIA=/fascia|aponeurosis|intermuscular septum|intercostal membrane/i;
const systemOf=(r,base)=>{
 if(r.kind==='skeletal')return 'skeletal';
 if(r.kind==='nervous')return 'nervous';
 if(base==='Iliopectineal arch')return 'connective';
 if(r.kind==='connective'&&/^Nucleus pulposus/.test(base))return 'skeletal';// with the intervertebral disks it sits in
 if(r.kind==='connective'&&FASCIA.test(base))return 'fascia';
 return r.kind;
};
// Soft tissue that can end up inside bone after the warp; export.py pushes it back out.
const pushOut=system=>system==='connective';
// Z-Anatomy muscles that lie over BodyParts3D muscles are pushed out of them (the value is the muscles they go under instead).
const OVER_MUSCLES=[[/latissimus dorsi/i,'trapezius']];

// A few one-sided structures carry no side in their name, and a few carry the wrong one (Z-Anatomy's lateral temporomandibular
// ligaments); a structure that lies wholly on one side takes that side (the patient's left is +x).
const sideOf=r=>{const [lo,hi]=r.bounds;return lo[0]>.005?'left':hi[0]<-.005?'right':'';};
const sides=[];
const idOf=(prefix,z)=>prefix+createHash('sha256').update(z).digest('hex').slice(0,8);
const parts=[],skipped={},review=[],attachments=[];
const skip=(why,z)=>{(skipped[why]??=[]).push(z);};
for(const r of candidates){
 const {base,side}=split(r.name);
 if(r.kind==='attachment'){
  // "Adductor longus.ol" is the origin on the left, ".e2r" the second insertion on the right (about fifty carry the wrong side,
  // which build-atlas.mjs corrects from where the patch lies).
  const m=r.name.match(/^(.*)\.([oe])(\d*)([lr])$/);if(!m)throw new Error(`Unexpected attachment name ${r.name}`);
  const muscle=m[1].replace(/^\((.*)\)$/,'$1'),out=ATTACHMENT_OUT[r.name]??ATTACHMENT_OUT[muscle];
  if(out){skip(`attachment left out: ${out}`,r.name);continue;}
  attachments.push({z:r.name,id:idOf('ZA',r.name),muscle,end:m[2]==='o'?'origin':'insertion',side:m[4]==='l'?'left':'right'});
  continue;
 }
 const out=OUT[base]??OUT_PATTERN.find(([re])=>re.test(base))?.[1];
 if(out){skip(`left out: ${out}`,r.name);continue;}
 const same=SAME[base]??COVERED[base]??inAtlas.get(canon(base))??SAME_PATTERN.find(([re])=>re.test(base))?.[1];
 if(same){skip(`already in the atlas`,`${r.name} = ${same}`);continue;}
 const system=systemOf(r,base),placed=sideOf(r)||side;
 if(placed!==side)sides.push(`${r.name}: ${side||'no side'} in Z-Anatomy, lies on the ${placed}`);
 parts.push({z:r.name,id:idOf('Z',r.name),name:appName(base,placed,system==='muscular'),system,...(pushOut(system)?{pushOut:true}:{}),...(system==='muscular'&&OVER_MUSCLES.some(([re])=>re.test(base))?{overMuscles:OVER_MUSCLES.find(([re])=>re.test(base))[1]}:{})});
 if(r.present)review.push(`${r.name} → ${parts.at(-1).name}: shape matches ${r.counterparts.slice(0,2).map(c=>c[0]).join(', ')}`);
}
// Attachment patches name their muscle the Z-Anatomy way; terms are the atlas muscles (lowercase, without the side) a patch
// belongs to. Most match by name. A patch of a whole muscle whose heads the atlas draws apart, or of a common tendon, belongs
// to all of them (WHOLE: one list, or one per end); PATCH settles single patches. Z-Anatomy has the descending and ascending
// parts of the trapezius the wrong way round. Origin and insertion follow the muscle cards (Neumann), so FLIP turns round the
// muscles Z-Anatomy draws the other way: shoulder-girdle muscles it takes to arise from the scapula or clavicle, and neck muscles
// it takes to arise from their upper end, which the cards make the insertion.
const QUADRICEPS=['rectus femoris','vastus lateralis','vastus medialis','vastus intermedius'];
const WHOLE={
 'Ascending part of trapezius muscle':['descending part of trapezius'],'Descending part of trapezius muscle':['ascending part of trapezius'],
 'Biceps brachii muscle':['long head of biceps brachii','short head of biceps brachii'],
 'Triceps brachii muscle':['long head of triceps brachii','lateral head of triceps brachii','medial head of triceps brachii'],
 'Deltoid muscle':['clavicular part of deltoid','acromial part of deltoid','spinal part of deltoid'],
 // Its origin patch lies on the clavicle; the sternocostal and abdominal parts have patches of their own.
 'Pectoralis major muscle':{origin:['clavicular part of pectoralis major'],insertion:['clavicular part of pectoralis major','sternocostal part of pectoralis major','abdominal part of pectoralis major']},
 // Its origin patch is on the medial epicondyle, where only the humeral head arises.
 'Pronator teres':{origin:['humeral head of pronator teres'],insertion:['humeral head of pronator teres','ulnar head of pronator teres']},
 'Flexor carpi ulnaris':['humeral head of flexor carpi ulnaris','ulnar head of flexor carpi ulnaris'],
 'Common flexor tendon':['flexor carpi radialis','palmaris longus','flexor digitorum superficialis','humeral head of flexor carpi ulnaris'],
 // Neumann has the extensor digiti minimi arise from the extensor digitorum, so the card leaves it out here.
 'Common extensor tendon':['extensor carpi radialis brevis','extensor digitorum','extensor carpi ulnaris'],
 'Erector spinae':['iliocostalis lumborum','longissimus thoracis'],
 'Iliopsoas muscle':['iliacus','psoas major'],
 'Quadriceps femoris muscle':QUADRICEPS,
 // The quadriceps reaches the tibial tuberosity through the patellar ligament.
 'Patellar ligament':{insertion:QUADRICEPS},
 'Triceps surae muscle':['medial head of gastrocnemius','lateral head of gastrocnemius','soleus','plantaris'],
 'Biceps femoris muscle':['long head of biceps femoris','short head of biceps femoris'],
 // The shared insertion on the medial side of the greater trochanter.
 'Trochanteric insertion':['gemellus superior','obturator internus','gemellus inferior'],
 'Masseter':['superficial part of masseter','deep part of masseter'],
 'Lateral pterygoid muscle':['superior head of lateral pterygoid','inferior head of lateral pterygoid'],
 'Anterior belly of digastric muscle':['digastric'],
 'Levator ani':['pubococcygeus','puborectalis','iliococcygeus'],
 'Adductor pollicis':['oblique head of adductor pollicis','transverse head of adductor pollicis'],
 'Deep head of flexor pollicis brevis':['flexor pollicis brevis','superficial head of flexor pollicis brevis'],
};
const FLIP=new Set(['Ascending part of trapezius muscle','Descending part of trapezius muscle','Transverse part of trapezius muscle',
 'Serratus anterior muscle','Pectoralis minor muscle','Subclavius muscle','Sternocostal head of pectoralis major muscle','Rectus abdominis muscle',
 'Scalenus anterior muscle','Scalenus medius muscle','Scalenus posterior muscle','Longus capitis muscle','Rectus anterior capitis muscle',
 'Rectus lateralis capitis muscle','Rectus posterior major capitis muscle','Rectus posterior minor capitis muscle','Obliquus superior capitis muscle',
 'Obliquus inferior capitis muscle','Thyrohyoid muscle','Anterior belly of digastric muscle','Transverse head of adductor hallucis']);
const PATCH={
 // The slip from the inferior angle of the scapula is part of the latissimus dorsi's origin, the short head of the biceps femoris
 // arises from the femur, and the obliques run from the ribs to the hip bone and inguinal ligament (external) or the other way.
 'Latissimus dorsi muscle.el':{end:'origin'},'Latissimus dorsi muscle.er':{end:'origin'},'Short head of biceps femoris.el':{end:'origin'},
 ...Object.fromEntries(['o4l','o4r','o5l','o5r'].map(k=>[`External abdominal oblique muscle.${k}`,{end:'insertion'}])),
 ...Object.fromEntries(['ol','or','o1l','o1r','o2l','o2r','o4l','o4r'].map(k=>[`Internal abdominal oblique muscle.${k}`,{end:'insertion'}])),
 // Z-Anatomy calls the patch on the capitate an insertion; it is where the oblique head arises.
 'Adductor pollicis.el':{terms:['oblique head of adductor pollicis'],end:'origin'},'Adductor pollicis.er':{terms:['oblique head of adductor pollicis'],end:'origin'},
 // One patch per plantar interosseous: from the 3rd, 4th and 5th metatarsals to the proximal phalanges of the same toes.
 'Plantar interossei muscles.ol':{terms:['first plantar interosseous of foot']},'Plantar interossei muscles.o1l':{terms:['second plantar interosseous of foot']},
 'Plantar interossei muscles.o2l':{terms:['third plantar interosseous of foot']},'Plantar interossei muscles.el':{terms:['first plantar interosseous of foot']},
 'Plantar interossei muscles.e1l':{terms:['second plantar interosseous of foot']},'Plantar interossei muscles.e2l':{terms:['third plantar interosseous of foot']},
};
const muscleTerm=new Map(),allTerms=new Set();
for(const p of atlas.parts)if(p.system==='muscular'&&!removed.has(p.id)&&p.source!=='z-anatomy')muscleTerm.set(canon(p.name),p.name.toLowerCase().replace(/\b(left|right) /g,''));
for(const p of parts)if(p.system==='muscular')muscleTerm.set(canon(split(p.z).base),p.name.toLowerCase().replace(/\b(left|right) /g,''));
for(const t of muscleTerm.values())allTerms.add(t);
for(const a of attachments){
 const fix=PATCH[a.z],whole=WHOLE[a.muscle],name=muscleTerm.get(canon(SAME[a.muscle]??a.muscle));
 if(FLIP.has(a.muscle))a.end=a.end==='origin'?'insertion':'origin';
 if(fix?.end)a.end=fix.end;
 const terms=fix?.terms??(Array.isArray(whole)?whole:whole?.[a.end])??(name?[name]:null);
 if(!terms)throw new Error(`Attachment ${a.z} belongs to no atlas muscle: add it to WHOLE, PATCH or ATTACHMENT_OUT`);
 for(const t of terms)if(!allTerms.has(t))throw new Error(`Attachment ${a.z}: ${t} is not an atlas muscle`);
 a.terms=terms;
}
const ids=new Set(parts.map(p=>p.id));if(ids.size!==parts.length)throw new Error('Id collision');
const names=new Map();for(const p of parts){if(names.has(p.name))throw new Error(`Two structures named ${p.name}: ${names.get(p.name)}, ${p.z}`);names.set(p.name,p.z);}
parts.sort((a,b)=>a.z.localeCompare(b.z));attachments.sort((a,b)=>a.z.localeCompare(b.z));

// --- Search concepts. Every structure gets one for its side and one for both sides, as in BodyParts3D; the groups below gather
// the parts of one muscle, ligament complex, joint or nerve tree. build-atlas.mjs adds the parts to an existing concept of the
// same name instead of making a second one (spinal cord, cranial nerve).
const term=n=>n.toLowerCase().replace(/\b(left|right) /g,'').replace(/\s+/g,' ').trim();
const sideWord=n=>n.match(/\b(left|right)\b/i)?.[1].toLowerCase()??'';
const slug=name=>'Z:'+name.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const concepts=new Map();
const addTo=(name,id)=>{const c=concepts.get(name)??{id:slug(name),name,elements:[]};if(!c.elements.includes(id))c.elements.push(id);concepts.set(name,c);};
for(const p of parts){const t=term(p.name);addTo(t,p.id);if(sideWord(p.name))addTo(p.name.toLowerCase(),p.id);p.concept=slug(sideWord(p.name)?p.name.toLowerCase():t);}
const groupsOf=new Map(candidates.map(r=>[r.name,r.groups]));
// Z-Anatomy's joint collections, except that a structure named after another joint goes to that one.
const inJoint=joint=>p=>{const t=term(p.name),own=t.match(/ of (.+ joint)$/)?.[1]?.replace('wrist joint','radiocarpal joint');return p.system==='connective'&&(own?own===joint.toLowerCase():groupsOf.get(p.z).includes(joint));};
const named=re=>p=>re.test(term(p.name));
const nerve=re=>p=>p.system==='nervous'&&re.test(term(p.name));
const GROUPS=[
 ['brachial plexus',nerve(/brachial plexus$/)],
 ['median nerve and branches',nerve(/median nerve|^anterior interosseous nerve of forearm$/)],
 ['ulnar nerve and branches',nerve(/ulnar nerve/)],
 ['radial nerve and branches',nerve(/radial nerve|^posterior interosseous nerve of forearm$|^posterior antebrachial cutaneous nerve$|^inferior lateral brachial cutaneous nerve$/)],
 ['axillary nerve and branches',nerve(/(^| )axillary nerve|^superior lateral brachial cutaneous nerve$/)],
 ['musculocutaneous nerve and branches',nerve(/^musculocutaneous nerve$|^lateral antebrachial cutaneous nerve$/)],
 ['femoral nerve and branches',nerve(/\bfemoral nerve$|saphenous nerve/)],
 ['obturator nerve and branches',nerve(/obturator nerve/)],
 ['tibial nerve and branches',nerve(/tibial nerve|plantar nerve|^medial sural cutaneous nerve$|^sural nerve$/)],
 ['common fibular nerve and branches',nerve(/fibular nerve|dorsal cutaneous nerve of foot$/)],
 ['sciatic nerve and branches',nerve(/sciatic nerve|tibial nerve|plantar nerve|fibular nerve|sural|dorsal cutaneous nerve of foot$/)],
 ['trigeminal nerve and branches',nerve(/trigeminal nerve|maxillary nerve|mandibular nerve|^(buccal|inferior alveolar|lingual|mental) nerve$|^nerve to mylohyoid$/)],
 ['cranial nerve',nerve(/^(oculomotor|abducens|trigeminal|facial|glossopharyngeal|vagus|accessory|hypoglossal) nerve$/)],
 ['spinal cord',nerve(/^(white matter|anterior horn|posterior horn) of spinal cord$/)],
 ['multifidus',named(/^multifidus /)],['masseter',named(/part of masseter$/)],['lateral pterygoid',named(/head of lateral pterygoid$/)],
 ['orbicularis oculi',named(/part of orbicularis oculi$/)],['thoracolumbar fascia',named(/layer of thoracolumbar fascia$/)],
 ['tibial collateral ligament',named(/part of tibial collateral ligament$/)],['iliofemoral ligament',named(/part of iliofemoral ligament$/)],
 ['coracoclavicular ligament',named(/^(conoid|trapezoid) ligament$/)],['glenohumeral ligaments',named(/glenohumeral ligament$/)],
 ['deltoid ligament',named(/^(tibionavicular|tibiocalcaneal|posterior tibiotalar) ligament$/)],
 ['lateral collateral ligament of ankle joint',named(/^(anterior talofibular|calcaneofibular|posterior talofibular) ligament$/)],
 ['bifurcate ligament',named(/^(calcaneocuboid|calcaneonavicular) ligament$/)],
 ...['Knee joint','Hip joint','Glenohumeral joint','Elbow joint','Ankle joint','Sacro-iliac joint','Temporomandibular joint','Acromioclavicular joint',
  'Sternoclavicular joint','Radiocarpal joint','Distal radio-ulnar joint','Superior tibiofibular joint'].map(j=>[j.toLowerCase(),inJoint(j)]),
];
for(const [name,test] of GROUPS){
 const members=parts.filter(test);if(members.length<2)throw new Error(`Group ${name} has ${members.length} members`);
 for(const p of members){addTo(name,p.id);const s=sideWord(p.name);if(s)addTo(`${s} ${name}`,p.id);}
}

const manifest={note:'Generated by scripts/zanatomy-select.mjs: the Z-Anatomy structures merged into the atlas (z is the object name in Z-Anatomy\'s Startup.blend, id the atlas part id), the origin and insertion patches kept for muscle cards, and what was left out and why.',
 source:{name:'Z-Anatomy',license:'CC BY-SA 4.0',url:'https://www.z-anatomy.com/',repository:'https://github.com/Z-Anatomy/Models-of-human-anatomy',file:'Startup.blend'},
 parts,concepts:[...concepts.values()],attachments,skipped};
await writeFile(new URL('scripts/zanatomy-parts.json',root),JSON.stringify(manifest,null,1)+'\n');
const bySystem={};for(const p of parts)bySystem[p.system]=(bySystem[p.system]??0)+1;
console.log(`Z-Anatomy: ${parts.length} structures to add ${JSON.stringify(bySystem)}, ${attachments.length} attachment patches; skipped ${Object.values(skipped).flat().length}.`);
if(review.length)console.log(`Taken although their shape matches existing parts (check these):\n${review.join('\n')}`);
if(sides.length)console.log(`Side taken from where the structure lies:\n${sides.join('\n')}`);
