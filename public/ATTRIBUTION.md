# Anatomy data attribution

The model files in `models/` combine two sources. As a whole they are distributed under **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/), which the Z-Anatomy material requires of adaptations; the BodyParts3D material in them is also available on its own under CC BY 4.0 as described below. See also `models/LICENSE.md`.

## BodyParts3D

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

- License: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html (updated 2025-02-27)
- Dataset: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html
- License terms: https://creativecommons.org/licenses/by/4.0/
- Source geometry: `isa_BP3D_4.0_obj_99.zip`, BodyParts3D 4.0.
- English names and relationships: IS-A and PART-OF concept, element, and inclusion tables from the same archive.
- Publication: Mitsuhashi et al. (2009), BodyParts3D: 3D structure database for anatomical concepts. https://doi.org/10.1093/nar/gkn613

Adaptations: axes and units converted from millimeters/Z-up to meters/Y-up; translated to rest at the stage; geometry simplified using meshoptimizer with 0.2% relative error limit per structure; positions quantized to 0.05 mm, normals to 8-bit octahedral, and both compressed with meshoptimizer into binary chunks; curated display system groupings and colors. The source contains 2,234 individual OBJ meshes; 2,223 are included: five are exact duplicates of included meshes, and six (the cervical, thoracic and lumbar "rotator" meshes, left and right, whose shape and position are those of the multifidus) are replaced by the Z-Anatomy multifidus and rotatores. Labels corrected where the source contradicts the geometry (left/right swaps, one unnamed intervertebral disk, one misnamed vein), listed in scripts/source-fixes.json in the source repository. The combined hierarchy contains 3,432 named FMA concepts, which may reference multiple meshes. Original source identity is preserved in the manifest.

Source OBJ comments mention an older CC BY-SA 2.1 Japan license. The official current database license linked above supersedes that legacy text and explicitly permits redistribution and adaptation under CC BY 4.0.

BodyParts3D represents an adult male reference anatomy based on TARO MRI and anatomical illustration refinements. It is not a complete model of every possible human anatomical structure or variation. This interface is educational and is not a clinical tool.

## Z-Anatomy

Z-Anatomy - The libre 3D atlas of anatomy - CC BY-SA 4.0. Design, 3D and anatomy by Gauthier Kervyn; Blender add-on by Marcin Zielinski; based in part on BodyParts3D (Kousaku Okubo, The Database Center for Life Science).

- Project: https://www.z-anatomy.com/
- Source: Blender template `Startup.blend` (2023-05-02) from https://github.com/Z-Anatomy/Models-of-human-anatomy
- License terms: https://creativecommons.org/licenses/by-sa/4.0/
- The cranial nerves in the template come from *Cranial Nerves and Foramina* by the University of Dundee, CAHID, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).

Included: 898 structures BodyParts3D lacks: muscles (such as latissimus dorsi, rectus abdominis, internal oblique, transversus abdominis, quadratus lumborum, multifidus, rotatores, the muscles of mastication and the facial muscles), ligaments, joint capsules, discs, labra and menisci, bursae, tendon sheaths, retinacula, fasciae, the spinal cord, cauda equina, and the peripheral, autonomic and cranial nerves; plus 705 muscle origin and insertion patches (`models/attachments.json`). The list of included structures, and of the ones left out with the reason, is `scripts/zanatomy-parts.json` in the source repository. Not included: the inner ear (CC BY-NC-SA 4.0 in the template), the kidney (CC BY-NC 4.0), the brain (partly from other sources), the sense organs, the viscera, and structures already in BodyParts3D.

Adaptations: each Z-Anatomy bone was fitted to the corresponding BodyParts3D bone (rigid fit, then the remaining surface difference), and the included structures were moved with the resulting bone-driven displacement field so that they follow the BodyParts3D skeleton, which is posed and proportioned differently (up to about 3 cm); ligaments and similar structures left inside bone by that warp were moved back to the bone surface, and attachment patches were placed on it; axes converted from Blender Z-up to Y-up; coincident vertices welded, geometry simplified with meshoptimizer (0.2% of the structure's size, at most 0.1 mm for nerves and 0.25 mm otherwise), normals recomputed; positions quantized and compressed as for BodyParts3D; names rewritten in the BodyParts3D style (side words from the geometry where Z-Anatomy gives none or the wrong one, such as the lateral temporomandibular ligaments), grouped for search, and given display systems and colors. Z-Anatomy labels the descending and ascending parts of the trapezius the other way round; the attachment patches follow the BodyParts3D labels.

## Historical assets (not included in the current release)

Earlier repository revisions included female reference anatomy: Kristen Browne and Heidi Schlehlein, Human Reference Atlas / HuBMAP, *3D Reference Organ Set for Female v1.5* (2023). CC BY 4.0. Geometry adapted for this viewer.

- Source DOI: https://doi.org/10.48539/HBM352.BTSQ.586
- Dataset: https://lod.humanatlas.io/ref-organ/united-female/v1.5
- Original GLB: https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/v1.5/assets/3d-vh-f-united.glb
- License: https://creativecommons.org/licenses/by/4.0/

Adaptations: translated native meter/Y-up coordinates onto the stage, coincident vertices welded and source normals averaged, geometry simplified with a 0.2% per-structure relative error bound, and normals quantized. Colors and display systems are curated for this interface. All 888 source meshes are represented, with 1,073 source nodes available as selectable individual or compound concepts.

This is a reference assembly with whole-body surface and selected organs, including female reproductive anatomy. Its skeleton and muscle coverage is partial. It is not a complete model of every human structure or a single-person scan. Eight placenta/umbilical structures are classified under Pregnancy reference and hidden by default.
