# Card Master: Menü-Teile als echte 3D-Renderings im Stil von Brett und Steinen.
# Gleiche Geometrie-Helfer, Materialien und Licht wie blender/build_assets.py (wird zuerst ausgeführt).
# Aufruf: blender -b -P blender/build_ui.py -- --view Standard --sun 1.6 --area 160 --world 0.22 [--only name] [--samples N]
import os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, 'build_assets.py')).read())   # Brett, Stein, Stecker, Materialien, Helfer
import bpy, bmesh
from mathutils import Vector

OUT = os.path.join(ROOT, 'public', 'assets', 'ui')
FONTS = {w: bpy.data.fonts.load(os.path.join(HERE, 'fonts', f'Inter-{w}.ttf')) for w in ('ExtraBold', 'Bold', 'SemiBold')}
ONLY = arg('--only', None)
SAMPLES = int(arg('--samples', 64))

# Brett und Vorlagen aus der Szene nehmen; nur Licht + Schattenfänger bleiben
for ob in (board, tile_proto, peg_h, peg_c): ob.hide_render = True
setup_world_and_light()
tbl = bpy.data.objects['Table']; tbl.is_shadow_catcher = True
scene.render.film_transparent = True

def wood_mat(name, tint='#ffffff', dark=1.0, rough=0.58, coat=0.1):
    m = principled(name, base_img='board_side.jpg', rough=rough, spec=0.42, coat=coat, coat_rough=0.4)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; t = [n for n in nt.nodes if n.type == 'TEX_IMAGE'][0]
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
    c = hex2lin(tint); mix.inputs[7].default_value = (c[0] * dark, c[1] * dark, c[2] * dark, 1)
    nt.links.new(t.outputs[0], mix.inputs[6]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m
M_WOOD = wood_mat('UIWood')
M_GROOVE = wood_mat('UIGroove', '#c9a27a', 0.78, rough=0.75, coat=0.0)
M_RED = principled('UIRed', base='#a8221f', rough=0.42, normal_img='tile_normal.png', normal_strength=0.3, coat=0.22, coat_rough=0.42, spec=0.5, sheen=0.15)
M_IVORY = principled('UIIvory', base='#e9dcc4', rough=0.46, normal_img='tile_normal.png', normal_strength=0.3, coat=0.22, coat_rough=0.42, spec=0.5, sheen=0.15)
M_TEAL = principled('UITeal', base=L['colors']['S'], rough=0.46, coat=0.22, coat_rough=0.42, spec=0.5)
M_INK = principled('UIInk', base='#5a4129', rough=0.7)

def wood_uv(ob, w, h):
    # Maserung längs, wie an der Brettkante
    planar_uv(ob, max(w, 6.0), max(h, 3.0))

def text_mesh(body, size, weight='Bold', align='CENTER', loc=(0, 0, 0), extrude=0.05, spacing=1.0):
    cu = bpy.data.curves.new('T_' + body, 'FONT'); cu.body = body; cu.font = FONTS[weight]; cu.size = size
    cu.align_x = align; cu.align_y = 'CENTER'; cu.extrude = extrude; cu.space_character = spacing; cu.resolution_u = 6
    ob = bpy.data.objects.new('T_' + body, cu); scene.collection.objects.link(ob); ob.location = loc
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.convert(target='MESH'); ob.select_set(False)
    return ob

def engrave(target, cutter, mat=None):
    if mat: cutter.data.materials.clear(); cutter.data.materials.append(mat)
    md = target.modifiers.new('engr', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = cutter; md.solver = 'EXACT'
    try: md.material_mode = 'TRANSFER'
    except Exception: pass
    bpy.context.view_layer.objects.active = target; bpy.ops.object.modifier_apply(modifier='engr')
    bpy.data.objects.remove(cutter)

def engrave_text(target, top_z, body, size, y, weight='Bold', depth=0.035, x=0.0, align='CENTER', spacing=1.0):
    t = text_mesh(body, size, weight, align, (x, y, top_z - depth), extrude=depth * 2, spacing=spacing)
    t.location.z = top_z  # extrude ist symmetrisch: Gravur reicht bis top_z - depth
    engrave(target, t, M_GROOVE)

def plaque(name, w, h, t=0.3, r=0.3, bevel=0.1, mat=None):
    ob = slab(name, w, h, t, r, bevel, 0.04, seg=16, bev_seg=6)
    add_smooth_by_angle(ob, 40)
    wood_uv(ob, w, h)
    ob.data.materials.append(mat or M_WOOD)
    return ob

import json, subprocess, tempfile
MASKDIR = tempfile.mkdtemp(prefix='ui_masks_')
def make_masks(spec):
    subprocess.run(['python3', os.path.join(HERE, 'ui_masks.py'), MASKDIR, json.dumps(spec)], check=True)

def engraved_mat(name, w, h, depth=0.035):
    # Holz + Gravur: Maske steuert echte Höhe (Bump), dunkleren Fugengrund und stumpfere Oberfläche
    m = wood_mat('M_' + name); nt = m.node_tree; b = nt.nodes['Principled BSDF']
    mix = [n for n in nt.nodes if n.type == 'MIX'][0]
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (0.5, 0.5, 0); mp.inputs['Scale'].default_value = (1 / w, 1 / h, 1)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    mk = nt.nodes.new('ShaderNodeTexImage'); mk.image = bpy.data.images.load(os.path.join(MASKDIR, name + '.png')); mk.image.colorspace_settings.name = 'Non-Color'
    mk.extension = 'CLIP'; mk.interpolation = 'Cubic'
    nt.links.new(mp.outputs[0], mk.inputs['Vector'])
    gr = nt.nodes.new('ShaderNodeMix'); gr.data_type = 'RGBA'; gr.blend_type = 'MULTIPLY'
    gr.inputs[7].default_value = (*[c * 0.72 for c in hex2lin('#b9875a')[:3]], 1)
    nt.links.new(mk.outputs[0], gr.inputs[0]); nt.links.new(mix.outputs[2], gr.inputs[6]); nt.links.new(gr.outputs[2], b.inputs['Base Color'])
    rg = nt.nodes.new('ShaderNodeMapRange'); rg.inputs[3].default_value = 0.55; rg.inputs[4].default_value = 0.82
    nt.links.new(mk.outputs[0], rg.inputs[0]); nt.links.new(rg.outputs[0], b.inputs['Roughness'])
    bp = nt.nodes.new('ShaderNodeBump'); bp.invert = True; bp.inputs['Strength'].default_value = 1.0; bp.inputs['Distance'].default_value = depth * 1.8
    nt.links.new(mk.outputs[0], bp.inputs['Height']); nt.links.new(bp.outputs[0], b.inputs['Normal'])
    # Gravur nur auf der Oberseite: Maske außerhalb (CLIP) = 0, Seiten liegen tiefer als z-Maske -> unkritisch
    return m

placed_ui = []
def clear():
    for ob in placed_ui:
        if ob.name in bpy.data.objects: bpy.data.objects.remove(ob)
    placed_ui.clear()

def camera_for(w, h, tilt=24, pad=0.12, res=None, ppu=200):
    cam = scene.camera
    if cam is None:
        cd = bpy.data.cameras.new('UICam'); cam = bpy.data.objects.new('UICam', cd); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.type = 'ORTHO'
    a = math.radians(tilt)
    hh = h * math.cos(a) + 0.35 * math.sin(a)             # sichtbare Höhe inkl. Kante
    cam.data.ortho_scale = max(w + 2 * pad, (hh + 2 * pad) * (w + 2 * pad) / (hh + 2 * pad)) if False else max(w + 2 * pad, 0)
    Wv, Hv = w + 2 * pad, hh + 2 * pad + 0.12
    rx, ry = res or (int(Wv * ppu), int(Hv * ppu))
    scene.render.resolution_x, scene.render.resolution_y = rx, ry
    cam.data.ortho_scale = max(Wv, Hv)
    d = Vector((0, -math.sin(a), math.cos(a)))
    cam.location = Vector((0, -0.06, 0.1)) + d * 30
    cam.rotation_euler = (a, 0, 0)
    cam.data.clip_end = 100

def render_to(fn):
    if ONLY and ONLY not in fn: return
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = SAMPLES; scene.cycles.use_denoising = True
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = arg('--view', 'Standard'); scene.view_settings.look = 'None'
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = os.path.join(OUT, fn); bpy.ops.render.render(write_still=True)

def tile(card, x, y, z=0.0, s=1.0, rot=0.0, face=True):
    ob = tile_proto.copy(); ob.data = tile_proto.data.copy(); scene.collection.objects.link(ob); ob.hide_render = False
    ob.data.materials.clear(); ob.data.materials.append(tile_material(card if face else 'back'))
    ob.location = (x, y, z); ob.scale = (s, s, s); ob.rotation_euler.z = math.radians(rot)
    placed_ui.append(ob); return ob

# ---------------------------------------------------------------- Tasten (9-Slice, quer dehnbar)
for name, mat in (('btn_red', M_RED), ('btn_ivory', M_IVORY), ('btn_wood', M_WOOD), ('btn_teal', M_TEAL)):
    if ONLY and ONLY not in name: continue
    clear()
    b = slab(name, 3.4, 0.95, 0.26, 0.26, 0.085, 0.04, seg=16, bev_seg=7); add_smooth_by_angle(b, 40)
    planar_uv(b, 3.4, 0.95) if mat is not M_WOOD else wood_uv(b, 3.4, 0.95)
    b.data.materials.append(mat); placed_ui.append(b)
    tbl.location.z = -0.001
    camera_for(3.4, 0.95, tilt=22, pad=0.14, ppu=200)
    render_to(name + '.png')

# ---------------------------------------------------------------- Gravur-Masken vorab
SPEC = [
    {'name': 'panel', 'w': 6.0, 'h': 7.6, 'items': [{'kind': 'frame', 'inset': 0.26, 'r': 0.3, 'width': 0.045}]},
    {'name': 'game_1001', 'w': 3.4, 'h': 2.7, 'items': [
        {'kind': 'text', 'text': '1001', 'size': 0.6, 'y': -0.5, 'weight': 'ExtraBold', 'spacing': 0.02},
        {'kind': 'text', 'text': '2 – 4 SPIELER', 'size': 0.19, 'y': -0.98, 'weight': 'Bold', 'spacing': 0.03}]},
]
for fn, title in (('game_romme', 'Rommé'), ('game_skat', 'Skat'), ('game_bridge', 'Bridge')):
    SPEC.append({'name': fn, 'w': 3.4, 'h': 2.7, 'items': [
        {'kind': 'text', 'text': title, 'size': 0.56, 'y': -0.5, 'weight': 'ExtraBold', 'spacing': 0.0},
        {'kind': 'text', 'text': 'BALD VERFÜGBAR', 'size': 0.19, 'y': -0.98, 'weight': 'Bold', 'spacing': 0.03}]})
make_masks(SPEC)

# ---------------------------------------------------------------- Tafel (9-Slice für Menüs)
if not ONLY or 'panel' in ONLY:
    clear()
    p = plaque('panel', 6.0, 7.6, t=0.34, r=0.42, bevel=0.13, mat=engraved_mat('panel', 6.0, 7.6, 0.03)); placed_ui.append(p)
    camera_for(6.0, 7.6, tilt=14, pad=0.2, ppu=130)
    render_to('panel.png')

# ---------------------------------------------------------------- Spiel-Tafeln
GAMES = [
    ('game_1001', [('HA', -0.86, 0.4, 5), ('H10', 0.0, 0.44, -3), ('SK', 0.86, 0.38, 4)]),
    ('game_romme', [('C7', -0.86, 0.4, 2), ('C8', 0.0, 0.42, -2), ('C9', 0.86, 0.4, 3)]),
    ('game_skat', [('CJ', -0.86, 0.4, -4), ('SJ', 0.0, 0.44, 2), ('HJ', 0.86, 0.38, -3)]),
    ('game_bridge', [('SA', -0.86, 0.4, 3), ('HA', 0.0, 0.44, -2), ('DA', 0.86, 0.38, 4)]),
]
for fn, tiles in GAMES:
    if ONLY and ONLY not in fn: continue
    clear()
    w, h, t = 3.4, 2.7, 0.3
    p = plaque(fn, w, h, t=t, r=0.3, bevel=0.1, mat=engraved_mat(fn, w, h, 0.04)); placed_ui.append(p)
    for c, x, y, r in tiles:
        tile(c, x, y, z=t, s=0.86, rot=r, face=True)
    camera_for(w, h, tilt=22, pad=0.16, ppu=190)
    render_to(fn + '.png')

# ---------------------------------------------------------------- Logo „Card Master“
if not ONLY or 'logo' in ONLY:
    clear()
    w, h, t = 7.6, 1.9, 0.32
    p = plaque('logo', w, h, t=t, r=0.42, bevel=0.12); placed_ui.append(p)
    # Schriftzug als eingelegte, glänzende Steinmasse (wie die Steine), leicht erhaben, weiche Kanten
    cu = bpy.data.curves.new('LogoText', 'FONT'); cu.body = 'Card Master'; cu.font = FONTS['ExtraBold']; cu.size = 1.0
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.extrude = 0.03; cu.bevel_depth = 0.0; cu.offset = 0.0
    cu.space_character = 0.97; cu.resolution_u = 8
    txt = bpy.data.objects.new('LogoText', cu); scene.collection.objects.link(txt); txt.location = (0.78, -0.02, t + 0.03)
    txt.data.materials.append(M_RED); placed_ui.append(txt)
    tile('HA', -3.02, 0.12, z=t, s=0.74, rot=-9); tile('S10', -2.28, -0.08, z=t, s=0.74, rot=6)
    camera_for(w, h, tilt=20, pad=0.32, ppu=180)
    render_to('logo.png')

# ---------------------------------------------------------------- Stecker als Symbole
if not ONLY or 'peg' in ONLY:
    tbl.hide_render = True
    for i, col in enumerate([L['colors']['H'], '#2c2c2c', '#3d7880', '#e07a3c']):
        clear()
        pg = make_peg(f'peg{i}', col); pg.scale = (1, 1, 1); placed_ui.append(pg)
        camera_for(0.5, 0.5, tilt=52, pad=0.08, res=(128, 160))
        scene.camera.data.ortho_scale = 0.78; scene.camera.location = Vector((0, 0, 0.28)) + Vector((0, -math.sin(math.radians(52)), math.cos(math.radians(52)))) * 30
        render_to(f'peg{i}.png')
subprocess.run(['python3', os.path.join(HERE, 'ui_post.py'), OUT], check=True)
print('UI fertig')
